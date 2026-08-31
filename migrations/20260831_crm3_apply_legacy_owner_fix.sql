-- CRM3 Block 4 additive hotfix: treat legacy blank company_id as NULL
-- for owner comparison only. Existing policy/customer data is untouched.
CREATE OR REPLACE FUNCTION public.apply_carrier_import_record(
  p_record_id uuid,
  p_new_individual jsonb DEFAULT NULL,
  p_new_company jsonb DEFAULT NULL,
  p_new_policy jsonb DEFAULT NULL,
  p_external_policy_number_normalized text DEFAULT NULL
)
RETURNS TABLE (result_status text, individual_client_id uuid, company_id text, policy_id text, external_client_identity_created boolean, external_policy_identity_created boolean, error_message text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_record public.carrier_import_records%ROWTYPE;
  v_policy public.policies%ROWTYPE;
  v_existing_client_identity public.external_client_identities%ROWTYPE;
  v_existing_policy_identity public.external_policy_identities%ROWTYPE;
  v_individual_id uuid;
  v_company_id text;
  v_policy_id text;
  v_full_name text;
  v_company_name text;
  v_company_nif text;
  v_insurer text;
  v_policy_number text;
  v_start_date date;
  v_end_date date;
  v_client_identity_created boolean := false;
  v_policy_identity_created boolean := false;
BEGIN
  IF p_record_id IS NULL THEN
    RAISE EXCEPTION 'apply_carrier_import_record: record id vazio';
  END IF;

  SELECT * INTO v_record FROM public.carrier_import_records WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_carrier_import_record: carrier_import_record % não existe', p_record_id;
  END IF;
  IF v_record.apply_status = 'applied' THEN
    RETURN QUERY SELECT 'already_applied'::text, v_record.selected_individual_client_id, v_record.selected_company_id, v_record.selected_policy_id, false, false, NULL::text;
    RETURN;
  END IF;
  IF v_record.decision_status <> 'accepted' THEN
    RAISE EXCEPTION 'apply_carrier_import_record: record % is not accepted (decision_status=%)', p_record_id, v_record.decision_status;
  END IF;
  IF v_record.customer_apply_action IS NULL OR v_record.policy_apply_action IS NULL THEN
    RAISE EXCEPTION 'apply_carrier_import_record: record % is missing an explicit apply action', p_record_id;
  END IF;

  CASE v_record.customer_apply_action
    WHEN 'no_customer_change' THEN
      v_individual_id := v_record.selected_individual_client_id;
      v_company_id := v_record.selected_company_id;
    WHEN 'link_existing_individual' THEN
      IF v_record.selected_individual_client_id IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: link_existing_individual requires selected_individual_client_id'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.individual_clients WHERE id = v_record.selected_individual_client_id) THEN RAISE EXCEPTION 'apply_carrier_import_record: selected individual_client % does not exist', v_record.selected_individual_client_id; END IF;
      v_individual_id := v_record.selected_individual_client_id;
    WHEN 'link_existing_company' THEN
      IF v_record.selected_company_id IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: link_existing_company requires selected_company_id'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_record.selected_company_id) THEN RAISE EXCEPTION 'apply_carrier_import_record: selected company % does not exist', v_record.selected_company_id; END IF;
      v_company_id := v_record.selected_company_id;
    WHEN 'create_individual' THEN
      v_full_name := NULLIF(btrim(COALESCE(p_new_individual->>'fullName', '')), '');
      IF v_full_name IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: create_individual requires a full name'; END IF;
      INSERT INTO public.individual_clients (id, full_name, nif, email, phone, address, status, created_at)
      VALUES (gen_random_uuid(), v_full_name, NULLIF(p_new_individual->>'nif', ''), NULLIF(p_new_individual->>'email', ''), NULLIF(p_new_individual->>'phone', ''), NULLIF(p_new_individual->>'address', ''), 'active', now())
      RETURNING id INTO v_individual_id;
    WHEN 'create_company' THEN
      v_company_name := NULLIF(btrim(COALESCE(p_new_company->>'name', '')), '');
      v_company_nif := NULLIF(btrim(COALESCE(p_new_company->>'nif', '')), '');
      IF v_company_name IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: create_company requires a name'; END IF;
      IF v_company_nif IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: create_company requires a NIF'; END IF;
      v_company_id := 'comp_' || replace(gen_random_uuid()::text, '-', '');
      INSERT INTO public.companies (id, name, nif, sector, contact_name, contact_email, contact_phone, address, created_at)
      VALUES (v_company_id, v_company_name, v_company_nif, COALESCE(NULLIF(p_new_company->>'sector', ''), ''), COALESCE(NULLIF(p_new_company->>'contactName', ''), v_company_name), COALESCE(NULLIF(p_new_company->>'contactEmail', ''), ''), COALESCE(NULLIF(p_new_company->>'contactPhone', ''), ''), COALESCE(NULLIF(p_new_company->>'address', ''), ''), now());
    ELSE
      RAISE EXCEPTION 'apply_carrier_import_record: unknown customer_apply_action %', v_record.customer_apply_action;
  END CASE;

  CASE v_record.policy_apply_action
    WHEN 'no_policy_change' THEN
      v_policy_id := v_record.selected_policy_id;
    WHEN 'link_existing_policy', 'update_existing_policy' THEN
      IF v_record.selected_policy_id IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: % requires selected_policy_id', v_record.policy_apply_action; END IF;
      SELECT * INTO v_policy FROM public.policies WHERE id = v_record.selected_policy_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'apply_carrier_import_record: selected policy % does not exist', v_record.selected_policy_id; END IF;
      v_policy_id := v_policy.id;
      -- Both owner dimensions must agree. BTRIM/NULLIF is comparison-only;
      -- no legacy policy row is rewritten.
      IF v_individual_id IS NOT NULL THEN
        IF v_policy.individual_client_id::text IS DISTINCT FROM v_individual_id::text OR NULLIF(BTRIM(v_policy.company_id), '') IS NOT NULL OR v_company_id IS NOT NULL THEN
          RAISE EXCEPTION 'apply_carrier_import_record: owner mismatch — policy % does not belong to the selected customer', v_policy_id;
        END IF;
      ELSIF v_company_id IS NOT NULL THEN
        IF NULLIF(BTRIM(v_policy.company_id), '') IS DISTINCT FROM v_company_id OR v_policy.individual_client_id IS NOT NULL THEN
          RAISE EXCEPTION 'apply_carrier_import_record: owner mismatch — policy % does not belong to the selected customer', v_policy_id;
        END IF;
      ELSE
        IF v_policy.individual_client_id IS NOT NULL OR NULLIF(BTRIM(v_policy.company_id), '') IS NOT NULL THEN
          RAISE EXCEPTION 'apply_carrier_import_record: owner mismatch — policy % does not belong to the selected customer', v_policy_id;
        END IF;
      END IF;
      IF v_record.policy_apply_action = 'update_existing_policy' THEN
        IF v_record.approved_policy_changes IS NULL OR v_record.approved_policy_changes = '{}'::jsonb THEN RAISE EXCEPTION 'apply_carrier_import_record: update_existing_policy requires approved_policy_changes'; END IF;
      END IF;
      IF v_record.approved_policy_changes IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_object_keys(v_record.approved_policy_changes) AS key WHERE key NOT IN ('policyNumber', 'startDate', 'endDate', 'annualPremium', 'status')) THEN
        RAISE EXCEPTION 'apply_carrier_import_record: approved_policy_changes contains an unsupported key';
      END IF;
      IF v_record.approved_policy_changes IS NOT NULL AND v_record.approved_policy_changes <> '{}'::jsonb THEN
        UPDATE public.policies SET policy_number = COALESCE(NULLIF(v_record.approved_policy_changes->>'policyNumber', ''), policy_number), start_date = COALESCE(NULLIF(v_record.approved_policy_changes->>'startDate', '')::date, start_date), end_date = COALESCE(NULLIF(v_record.approved_policy_changes->>'endDate', '')::date, end_date), annual_premium = COALESCE((v_record.approved_policy_changes->>'annualPremium')::numeric, annual_premium), status = COALESCE(NULLIF(v_record.approved_policy_changes->>'status', ''), status) WHERE id = v_policy_id;
      END IF;
    WHEN 'create_policy' THEN
      IF v_individual_id IS NULL AND v_company_id IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: create_policy requires a resolved customer'; END IF;
      v_insurer := NULLIF(btrim(COALESCE(p_new_policy->>'insurer', '')), '');
      v_policy_number := NULLIF(btrim(COALESCE(p_new_policy->>'policyNumber', '')), '');
      v_start_date := NULLIF(p_new_policy->>'startDate', '')::date;
      v_end_date := NULLIF(p_new_policy->>'endDate', '')::date;
      IF v_insurer IS NULL OR v_policy_number IS NULL OR v_start_date IS NULL OR v_end_date IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: create_policy is missing a required field (insurer/policyNumber/startDate/endDate)'; END IF;
      v_policy_id := 'pol_' || replace(gen_random_uuid()::text, '-', '');
      INSERT INTO public.policies (id, company_id, individual_client_id, type, insurer, policy_number, description, start_date, end_date, annual_premium, insured_value, status, created_at)
      VALUES (v_policy_id, v_company_id, v_individual_id, COALESCE(NULLIF(p_new_policy->>'type', ''), 'health'), v_insurer, v_policy_number, COALESCE(NULLIF(p_new_policy->>'description', ''), ''), v_start_date, v_end_date, COALESCE((p_new_policy->>'annualPremium')::numeric, 0), COALESCE((p_new_policy->>'insuredValue')::numeric, 0), 'active', now());
    ELSE
      RAISE EXCEPTION 'apply_carrier_import_record: unknown policy_apply_action %', v_record.policy_apply_action;
  END CASE;

  IF (v_individual_id IS NOT NULL OR v_company_id IS NOT NULL) AND v_record.external_client_id IS NOT NULL AND btrim(v_record.external_client_id) <> '' THEN
    SELECT * INTO v_existing_client_identity FROM public.external_client_identities WHERE provider = v_record.provider AND external_client_id = v_record.external_client_id;
    IF FOUND THEN
      IF NOT ((v_individual_id IS NOT NULL AND v_existing_client_identity.individual_client_id = v_individual_id) OR (v_company_id IS NOT NULL AND v_existing_client_identity.company_id = v_company_id)) THEN RAISE EXCEPTION 'apply_carrier_import_record: external client identity %/% is already linked to a different CRM customer', v_record.provider, v_record.external_client_id; END IF;
    ELSE
      INSERT INTO public.external_client_identities (id, individual_client_id, company_id, provider, external_client_id, first_seen_at, last_seen_at, created_at, updated_at) VALUES (gen_random_uuid(), v_individual_id, v_company_id, v_record.provider, v_record.external_client_id, now(), now(), now(), now());
      v_client_identity_created := true;
    END IF;
  END IF;

  IF v_policy_id IS NOT NULL AND v_record.external_policy_number IS NOT NULL AND btrim(v_record.external_policy_number) <> '' THEN
    IF v_record.external_policy_id IS NOT NULL AND btrim(v_record.external_policy_id) <> '' THEN
      SELECT * INTO v_existing_policy_identity FROM public.external_policy_identities WHERE provider = v_record.provider AND external_policy_id = v_record.external_policy_id;
    ELSIF p_external_policy_number_normalized IS NOT NULL THEN
      SELECT * INTO v_existing_policy_identity FROM public.external_policy_identities WHERE provider = v_record.provider AND policy_id = v_policy_id AND external_policy_number_normalized = p_external_policy_number_normalized;
    ELSE
      v_existing_policy_identity := NULL;
    END IF;
    IF v_existing_policy_identity.id IS NOT NULL THEN
      IF v_existing_policy_identity.policy_id <> v_policy_id THEN RAISE EXCEPTION 'apply_carrier_import_record: external policy identity %/% is already linked to a different CRM policy', v_record.provider, v_record.external_policy_id; END IF;
    ELSE
      INSERT INTO public.external_policy_identities (id, policy_id, provider, external_policy_id, external_policy_number, external_policy_number_normalized, first_seen_at, last_seen_at, created_at, updated_at) VALUES (gen_random_uuid(), v_policy_id, v_record.provider, v_record.external_policy_id, v_record.external_policy_number, p_external_policy_number_normalized, now(), now(), now(), now());
      v_policy_identity_created := true;
    END IF;
  END IF;

  UPDATE public.carrier_import_records SET selected_individual_client_id = v_individual_id, selected_company_id = v_company_id, selected_policy_id = v_policy_id, apply_status = 'applied', apply_error = NULL, applied_at = now(), updated_at = now() WHERE id = p_record_id;
  RETURN QUERY SELECT 'applied'::text, v_individual_id, v_company_id, v_policy_id, v_client_identity_created, v_policy_identity_created, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_carrier_import_record(uuid, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_carrier_import_record(uuid, jsonb, jsonb, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_carrier_import_record(uuid, jsonb, jsonb, jsonb, text) TO service_role;
