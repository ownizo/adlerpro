-- CRM3 Block 4.1: policyholder participants. Additive only.
ALTER FUNCTION public.apply_carrier_import_record(uuid, jsonb, jsonb, jsonb, text)
  RENAME TO apply_carrier_import_record_block4;

CREATE TABLE IF NOT EXISTS public.policy_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id text NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  individual_client_id uuid NULL REFERENCES public.individual_clients(id) ON DELETE RESTRICT,
  company_id text NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  role text NOT NULL,
  provider text NULL,
  external_client_id text NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_participants_owner_xor CHECK ((individual_client_id IS NOT NULL) <> (company_id IS NOT NULL)),
  CONSTRAINT policy_participants_role_check CHECK (role IN ('policyholder'))
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_participants_policy_owner_role_uidx ON public.policy_participants (policy_id, role, COALESCE(individual_client_id::text, company_id));
CREATE UNIQUE INDEX IF NOT EXISTS policy_participants_external_identity_uidx ON public.policy_participants (policy_id, role, provider, external_client_id) WHERE provider IS NOT NULL AND external_client_id IS NOT NULL;
ALTER TABLE public.policy_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS policy_participants_admin_select ON public.policy_participants;
DROP POLICY IF EXISTS policy_participants_admin_insert ON public.policy_participants;
DROP POLICY IF EXISTS policy_participants_admin_update ON public.policy_participants;
CREATE POLICY policy_participants_admin_select ON public.policy_participants FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY policy_participants_admin_insert ON public.policy_participants FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY policy_participants_admin_update ON public.policy_participants FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE ON public.policy_participants TO service_role;

-- Extend the existing action allowlist without changing any stored rows.
ALTER TABLE public.carrier_import_records DROP CONSTRAINT IF EXISTS carrier_import_records_customer_apply_action_check;
ALTER TABLE public.carrier_import_records ADD CONSTRAINT carrier_import_records_customer_apply_action_check CHECK (customer_apply_action IS NULL OR customer_apply_action IN ('link_existing_individual', 'link_existing_company', 'create_individual', 'create_company', 'add_policyholder_to_existing_client', 'no_customer_change));
ALTER TABLE public.carrier_import_records ADD COLUMN IF NOT EXISTS selected_policyholder_mode text NULL;
ALTER TABLE public.carrier_import_records ADD COLUMN IF NOT EXISTS selected_policyholder_individual_client_id uuid NULL REFERENCES public.individual_clients(id) ON DELETE SET NULL;
ALTER TABLE public.carrier_import_records ADD COLUMN IF NOT EXISTS selected_policyholder_company_id text NULL REFERENCES public.companies(id) ON DELETE SET NULL;
ALTER TABLE public.carrier_import_records DROP CONSTRAINT IF EXISTS carrier_import_records_policyholder_mode_check;
ALTER TABLE public.carrier_import_records ADD CONSTRAINT carrier_import_records_policyholder_mode_check CHECK (
  selected_policyholder_mode IS NULL OR selected_policyholder_mode IN ('existing_individual', 'existing_company', 'create_individual', 'create_company')
);
ALTER TABLE public.carrier_import_records DROP CONSTRAINT IF EXISTS carrier_import_records_selected_policyholder_owner_check;
ALTER TABLE public.carrier_import_records ADD CONSTRAINT carrier_import_records_selected_policyholder_owner_check CHECK (
  selected_policyholder_individual_client_id IS NULL OR selected_policyholder_company_id IS NULL
);

-- Same signature as Block 4. The complete replacement keeps all row locking,
-- explicit action, owner, approved-field, identity, and applied-row safeguards.
CREATE OR REPLACE FUNCTION public.apply_carrier_import_record(
  p_record_id uuid, p_new_individual jsonb DEFAULT NULL, p_new_company jsonb DEFAULT NULL,
  p_new_policy jsonb DEFAULT NULL, p_external_policy_number_normalized text DEFAULT NULL
) RETURNS TABLE (result_status text, individual_client_id uuid, company_id text, policy_id text,
  external_client_identity_created boolean, external_policy_identity_created boolean, error_message text)
LANGUAGE plpgsql AS $$
DECLARE
  r public.carrier_import_records%ROWTYPE; p public.policies%ROWTYPE;
  owner_ind uuid; owner_company text; participant_ind uuid; participant_company text; pid text;
  normalized_external_client_id text;
  new_ind boolean := false; new_company boolean := false; new_policy boolean := false;
BEGIN
  SELECT * INTO r FROM public.carrier_import_records WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'apply_carrier_import_record: carrier_import_record % não existe', p_record_id; END IF;
  IF r.apply_status = 'applied' THEN
    RETURN QUERY SELECT 'already_applied'::text, r.selected_individual_client_id, r.selected_company_id, r.selected_policy_id, false, false, NULL::text; RETURN;
  END IF;
  IF r.decision_status <> 'accepted' THEN RAISE EXCEPTION 'apply_carrier_import_record: record % is not accepted (decision_status=%)', p_record_id, r.decision_status; END IF;
  IF r.customer_apply_action IS NULL OR r.policy_apply_action IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: record % is missing an explicit apply action', p_record_id; END IF;

  IF r.customer_apply_action <> 'add_policyholder_to_existing_client' THEN
    RETURN QUERY SELECT * FROM public.apply_carrier_import_record_block4(
      p_record_id, p_new_individual, p_new_company, p_new_policy,
      p_external_policy_number_normalized
    );
    RETURN;
  END IF;

  IF r.customer_apply_action = 'add_policyholder_to_existing_client' THEN
    pid := r.selected_policy_id;
    IF pid IS NULL OR r.policy_apply_action NOT IN ('link_existing_policy','update_existing_policy') THEN RAISE EXCEPTION 'apply_carrier_import_record: add_policyholder_to_existing_client requires an existing policy'; END IF;
    IF r.selected_policyholder_mode IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: add_policyholder_to_existing_client requires an explicit selected_policyholder_mode'; END IF;

    CASE r.selected_policyholder_mode
      WHEN 'existing_individual' THEN
        IF r.selected_policyholder_individual_client_id IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: existing_individual policyholder requires selected_policyholder_individual_client_id'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.individual_clients WHERE id = r.selected_policyholder_individual_client_id) THEN RAISE EXCEPTION 'apply_carrier_import_record: selected policyholder does not exist'; END IF;
        participant_ind := r.selected_policyholder_individual_client_id;
      WHEN 'existing_company' THEN
        IF r.selected_policyholder_company_id IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: existing_company policyholder requires selected_policyholder_company_id'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = r.selected_policyholder_company_id) THEN RAISE EXCEPTION 'apply_carrier_import_record: selected policyholder does not exist'; END IF;
        participant_company := r.selected_policyholder_company_id;
      WHEN 'create_individual' THEN
        IF NULLIF(btrim(COALESCE(p_new_individual->>'fullName','')), '') IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: create_individual requires a full name'; END IF;
        INSERT INTO public.individual_clients (id, full_name, nif, email, phone, address, status, created_at)
        VALUES (
          gen_random_uuid(),
          NULLIF(btrim(COALESCE(p_new_individual->>'fullName', '')), ''),
          NULLIF(btrim(COALESCE(p_new_individual->>'nif', '')), ''),
          NULLIF(btrim(COALESCE(p_new_individual->>'email', '')), ''),
          NULLIF(btrim(COALESCE(p_new_individual->>'phone', '')), ''),
          NULLIF(btrim(COALESCE(p_new_individual->>'address', '')), ''),
          'active', now()
        )
        RETURNING id INTO participant_ind;
      WHEN 'create_company' THEN
        IF NULLIF(btrim(COALESCE(p_new_company->>'name', '')), '') IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: create_company requires a name'; END IF;
        IF NULLIF(btrim(COALESCE(p_new_company->>'nif', '')), '') IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: create_company requires a NIF'; END IF;
        participant_company := 'comp_' || replace(gen_random_uuid()::text, '-', '');
        INSERT INTO public.companies (id, name, nif, sector, contact_name, contact_email, contact_phone, address, created_at)
        VALUES (
          participant_company,
          NULLIF(btrim(COALESCE(p_new_company->>'name', '')), ''),
          NULLIF(btrim(COALESCE(p_new_company->>'nif', '')), ''),
          COALESCE(NULLIF(p_new_company->>'sector', ''), ''),
          COALESCE(NULLIF(p_new_company->>'contactName', ''), NULLIF(btrim(COALESCE(p_new_company->>'name', '')), '')),
          COALESCE(NULLIF(p_new_company->>'contactEmail', ''), ''),
          COALESCE(NULLIF(p_new_company->>'contactPhone', ''), ''),
          COALESCE(NULLIF(p_new_company->>'address', ''), ''),
          now()
        );
      ELSE
        RAISE EXCEPTION 'apply_carrier_import_record: unsupported policyholder participant mode %', r.selected_policyholder_mode;
    END CASE;
  END IF;

  IF r.policy_apply_action = 'create_policy' THEN
    RAISE EXCEPTION 'apply_carrier_import_record: participant action requires an existing policy';
  ELSIF r.policy_apply_action IN ('link_existing_policy','update_existing_policy') THEN
    SELECT * INTO p FROM public.policies WHERE id = pid OR (r.customer_apply_action <> 'add_policyholder_to_existing_client' AND id = r.selected_policy_id) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'apply_carrier_import_record: selected policy % does not exist', r.selected_policy_id; END IF;
    pid := p.id;
    IF r.customer_apply_action <> 'add_policyholder_to_existing_client' THEN
      IF owner_ind IS NOT NULL THEN
        IF p.individual_client_id::text IS DISTINCT FROM owner_ind::text OR NULLIF(BTRIM(p.company_id),'') IS NOT NULL OR owner_company IS NOT NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: owner mismatch — policy % does not belong to the selected customer', pid; END IF;
      ELSIF owner_company IS NOT NULL THEN
        IF NULLIF(BTRIM(p.company_id),'') IS DISTINCT FROM owner_company OR p.individual_client_id IS NOT NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: owner mismatch — policy % does not belong to the selected customer', pid; END IF;
      ELSIF p.individual_client_id IS NOT NULL OR NULLIF(BTRIM(p.company_id),'') IS NOT NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: owner mismatch — policy % does not belong to the selected customer', pid; END IF;
    ELSE
      owner_ind := p.individual_client_id;
      owner_company := NULLIF(BTRIM(p.company_id), '');
    END IF;
    IF r.policy_apply_action = 'update_existing_policy' THEN
      IF r.approved_policy_changes IS NULL OR r.approved_policy_changes = '{}'::jsonb THEN RAISE EXCEPTION 'apply_carrier_import_record: update_existing_policy requires approved_policy_changes'; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(r.approved_policy_changes) k WHERE k NOT IN ('policyNumber','startDate','endDate','annualPremium','status')) THEN RAISE EXCEPTION 'apply_carrier_import_record: approved_policy_changes contains an unsupported key'; END IF;
      UPDATE public.policies SET policy_number=COALESCE(NULLIF(r.approved_policy_changes->>'policyNumber',''),policy_number), start_date=COALESCE(NULLIF(r.approved_policy_changes->>'startDate','')::date,start_date), end_date=COALESCE(NULLIF(r.approved_policy_changes->>'endDate','')::date,end_date), annual_premium=COALESCE((r.approved_policy_changes->>'annualPremium')::numeric,annual_premium), status=COALESCE(NULLIF(r.approved_policy_changes->>'status',''),status) WHERE id=pid;
    END IF;
  ELSIF r.policy_apply_action = 'no_policy_change' THEN pid := r.selected_policy_id;
    SELECT * INTO p FROM public.policies WHERE id = pid FOR UPDATE;
    owner_ind := p.individual_client_id;
    owner_company := NULLIF(BTRIM(p.company_id), '');
  ELSE RAISE EXCEPTION 'apply_carrier_import_record: unknown policy_apply_action %', r.policy_apply_action;
  END IF;

  IF r.customer_apply_action = 'add_policyholder_to_existing_client' THEN
    normalized_external_client_id := NULLIF(BTRIM(r.external_client_id), '');
    IF normalized_external_client_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.external_client_identities e
        WHERE e.provider = r.provider AND NULLIF(BTRIM(e.external_client_id), '') = normalized_external_client_id
          AND NOT ((participant_ind IS NOT NULL AND e.individual_client_id = participant_ind) OR (participant_company IS NOT NULL AND e.company_id = participant_company))
      ) THEN
        RAISE EXCEPTION 'apply_carrier_import_record: external client identity %/% is already linked to a different CRM customer', r.provider, normalized_external_client_id;
      END IF;
    END IF;

    INSERT INTO public.policy_participants (policy_id, individual_client_id, company_id, role, provider, external_client_id, source)
    VALUES (pid, participant_ind, participant_company, 'policyholder', r.provider, normalized_external_client_id, 'carrier_import')
    ON CONFLICT DO NOTHING;

    IF normalized_external_client_id IS NOT NULL THEN
      INSERT INTO public.external_client_identities (id, individual_client_id, company_id, provider, external_client_id, first_seen_at, last_seen_at, created_at, updated_at)
      VALUES (gen_random_uuid(), participant_ind, participant_company, r.provider, normalized_external_client_id, now(), now(), now(), now())
      ON CONFLICT (provider, external_client_id) DO UPDATE SET last_seen_at = now(), updated_at = now()
      WHERE (public.external_client_identities.individual_client_id = EXCLUDED.individual_client_id OR public.external_client_identities.company_id = EXCLUDED.company_id);
    END IF;
  END IF;

  UPDATE public.carrier_import_records
  SET selected_individual_client_id = COALESCE(owner_ind, selected_individual_client_id),
      selected_company_id = COALESCE(owner_company, selected_company_id),
      selected_policy_id = pid,
      selected_policyholder_mode = r.selected_policyholder_mode,
      selected_policyholder_individual_client_id = r.selected_policyholder_individual_client_id,
      selected_policyholder_company_id = r.selected_policyholder_company_id,
      apply_status = 'applied',
      apply_error = NULL,
      applied_at = now(),
      updated_at = now()
  WHERE id = p_record_id;

  RETURN QUERY SELECT 'applied'::text, owner_ind, owner_company, pid, false, false, NULL::text;
END; $$;
REVOKE ALL ON FUNCTION public.apply_carrier_import_record(uuid,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_carrier_import_record(uuid,jsonb,jsonb,jsonb,text) TO service_role;
