-- CRM3 hotfix: record in Git the production fix already applied directly
-- (Supabase migration version 20260901060339,
-- crm3_participant_policy_id_conflict_fix) for a second, narrower
-- PL/pgSQL ambiguity on the Bella/Ilya add_policyholder_to_existing_client
-- path, left over after migrations/20260831_crm3_policy_id_ambiguity_fix.sql.
--
-- ROOT CAUSE
-- That prior fix qualified the policy_participants idempotency INSERT's
-- ON CONFLICT expression with a table alias:
--   INSERT INTO public.policy_participants AS ins_pp (policy_id, individual_client_id, company_id, role, provider, external_client_id, source)
--   VALUES (...)
--   ON CONFLICT (policy_id, role, COALESCE(ins_pp.individual_client_id::text, ins_pp.company_id)) DO NOTHING;
-- The plain `policy_id` name inside that explicit conflict-target list is
-- still parsed as ordinary SQL in the same scope as the rest of the
-- statement, and apply_carrier_import_record's RETURNS TABLE declares an
-- output column also named policy_id (implicitly a PL/pgSQL variable of
-- the same name) — so even with ins_pp-qualified individual_client_id/
-- company_id, the bare `policy_id` in the conflict target still collided
-- with the output variable on the Bella/Ilya participant path and raised
-- "column reference policy_id is ambiguous".
--
-- FIX
-- Drop the explicit conflict target entirely and let Postgres infer it
-- from the existing unique index (policy_participants_policy_owner_role_uidx),
-- exactly as production already runs successfully:
--   ON CONFLICT DO NOTHING;
-- This is the ONLY functional change versus the apply_carrier_import_record
-- body merged in migrations/20260831_crm3_policy_id_ambiguity_fix.sql.
-- Every other line of that function is reproduced byte-for-byte: same
-- signature, same RETURNS TABLE shape, same REVOKE/GRANT posture
-- (service_role EXECUTE only, no SECURITY DEFINER), same single
-- participant-resolution path, same Bella/Ilya owner-preservation
-- (owner_ind/owner_company sourced only from the locked policy row),
-- same selected_policyholder_* retry persistence, same external identity
-- conflict checks, same approved_policy_changes allowlist, same
-- idempotency (apply_status='applied' short-circuit).
--
-- apply_carrier_import_record_block4 is untouched — it never had this
-- ON CONFLICT expression and is not affected by this fix. This migration
-- only CREATE OR REPLACEs apply_carrier_import_record; it adds no
-- column, no table, no constraint, and touches no existing row.
--
-- Additive only. Does not edit or reapply
-- migrations/20260831_crm3_apply_portfolio_import.sql,
-- migrations/20260831_crm3_apply_legacy_owner_fix.sql,
-- migrations/20260831_crm3_policy_participants.sql, or
-- migrations/20260831_crm3_policy_id_ambiguity_fix.sql.

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
    IF r.selected_policyholder_mode NOT IN ('existing_individual', 'existing_company', 'create_individual', 'create_company') THEN
      RAISE EXCEPTION 'apply_carrier_import_record: unsupported policyholder participant mode %', r.selected_policyholder_mode;
    END IF;
    -- NOTE: participant resolution (existing-participant reuse, external
    -- identity reuse, create-only-if-still-unresolved, and the actual
    -- individual_clients/companies INSERT for create_individual/
    -- create_company) happens exactly once, below, in the idempotent
    -- block guarded by `IF r.customer_apply_action =
    -- 'add_policyholder_to_existing_client' THEN` after policy
    -- resolution. This block used to also run a CASE that created a new
    -- individual_client/company for create_individual/create_company
    -- and re-validated existing_individual/existing_company — entirely
    -- redundant with (and racing ahead of) the canonical resolution
    -- below, and on every create_individual/create_company apply it left
    -- behind an orphan individual_clients/companies row never linked to
    -- any policy_participants or external_client_identities row, because
    -- the canonical block resolves and creates the real participant
    -- independently and overwrites participant_ind/participant_company
    -- without ever consulting what this block produced. Removed; keep
    -- only the mode-shape validation above, which the canonical block
    -- does not duplicate.
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

    CASE r.selected_policyholder_mode
      WHEN 'existing_individual' THEN
        IF r.selected_policyholder_individual_client_id IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: existing_individual policyholder requires selected_policyholder_individual_client_id'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.individual_clients WHERE id = r.selected_policyholder_individual_client_id) THEN RAISE EXCEPTION 'apply_carrier_import_record: selected policyholder does not exist'; END IF;
        participant_ind := r.selected_policyholder_individual_client_id;
        participant_company := NULL;
      WHEN 'existing_company' THEN
        IF r.selected_policyholder_company_id IS NULL THEN RAISE EXCEPTION 'apply_carrier_import_record: existing_company policyholder requires selected_policyholder_company_id'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = r.selected_policyholder_company_id) THEN RAISE EXCEPTION 'apply_carrier_import_record: selected policyholder does not exist'; END IF;
        participant_company := r.selected_policyholder_company_id;
        participant_ind := NULL;
      WHEN 'create_individual' THEN
        IF r.selected_policyholder_individual_client_id IS NOT NULL THEN
          IF NOT EXISTS (SELECT 1 FROM public.individual_clients WHERE id = r.selected_policyholder_individual_client_id) THEN RAISE EXCEPTION 'apply_carrier_import_record: selected policyholder does not exist'; END IF;
          participant_ind := r.selected_policyholder_individual_client_id;
        ELSIF normalized_external_client_id IS NOT NULL THEN
          SELECT e.individual_client_id INTO participant_ind
          FROM public.external_client_identities e
          WHERE e.provider = r.provider
            AND NULLIF(BTRIM(e.external_client_id), '') = normalized_external_client_id
            AND e.individual_client_id IS NOT NULL
          ORDER BY e.last_seen_at DESC NULLS LAST
          LIMIT 1;

          IF participant_ind IS NOT NULL THEN
            IF EXISTS (
              SELECT 1 FROM public.external_client_identities e
              WHERE e.provider = r.provider
                AND NULLIF(BTRIM(e.external_client_id), '') = normalized_external_client_id
                AND e.company_id IS NOT NULL
            ) THEN
              RAISE EXCEPTION 'apply_carrier_import_record: external client identity %/% is already linked to a different CRM customer', r.provider, normalized_external_client_id;
            END IF;
          END IF;
        END IF;

        IF participant_ind IS NULL THEN
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
        END IF;

        participant_company := NULL;
        r.selected_policyholder_individual_client_id := participant_ind;
        r.selected_policyholder_company_id := NULL;
      WHEN 'create_company' THEN
        IF r.selected_policyholder_company_id IS NOT NULL THEN
          IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = r.selected_policyholder_company_id) THEN RAISE EXCEPTION 'apply_carrier_import_record: selected policyholder does not exist'; END IF;
          participant_company := r.selected_policyholder_company_id;
        ELSIF normalized_external_client_id IS NOT NULL THEN
          SELECT e.company_id INTO participant_company
          FROM public.external_client_identities e
          WHERE e.provider = r.provider
            AND NULLIF(BTRIM(e.external_client_id), '') = normalized_external_client_id
            AND e.company_id IS NOT NULL
          ORDER BY e.last_seen_at DESC NULLS LAST
          LIMIT 1;

          IF participant_company IS NOT NULL THEN
            IF EXISTS (
              SELECT 1 FROM public.external_client_identities e
              WHERE e.provider = r.provider
                AND NULLIF(BTRIM(e.external_client_id), '') = normalized_external_client_id
                AND e.individual_client_id IS NOT NULL
            ) THEN
              RAISE EXCEPTION 'apply_carrier_import_record: external client identity %/% is already linked to a different CRM customer', r.provider, normalized_external_client_id;
            END IF;
          END IF;
        END IF;

        IF participant_company IS NULL THEN
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
        END IF;

        participant_ind := NULL;
        r.selected_policyholder_company_id := participant_company;
        r.selected_policyholder_individual_client_id := NULL;
      ELSE
        RAISE EXCEPTION 'apply_carrier_import_record: unsupported policyholder participant mode %', r.selected_policyholder_mode;
    END CASE;

    IF normalized_external_client_id IS NOT NULL THEN
      IF participant_ind IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.external_client_identities e
          WHERE e.provider = r.provider
            AND NULLIF(BTRIM(e.external_client_id), '') = normalized_external_client_id
            AND e.individual_client_id IS NOT NULL AND e.individual_client_id IS DISTINCT FROM participant_ind
        ) THEN
          RAISE EXCEPTION 'apply_carrier_import_record: external client identity %/% is already linked to a different CRM customer', r.provider, normalized_external_client_id;
        END IF;
      ELSIF participant_company IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.external_client_identities e
          WHERE e.provider = r.provider
            AND NULLIF(BTRIM(e.external_client_id), '') = normalized_external_client_id
            AND e.company_id IS NOT NULL AND e.company_id IS DISTINCT FROM participant_company
        ) THEN
          RAISE EXCEPTION 'apply_carrier_import_record: external client identity %/% is already linked to a different CRM customer', r.provider, normalized_external_client_id;
        END IF;
      END IF;
    END IF;

    IF normalized_external_client_id IS NOT NULL THEN
      IF participant_ind IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.policy_participants pp
          WHERE pp.policy_id = pid
            AND pp.role = 'policyholder'
            AND pp.provider = r.provider
            AND NULLIF(BTRIM(pp.external_client_id), '') = normalized_external_client_id
            AND pp.individual_client_id IS NOT NULL
            AND pp.individual_client_id IS DISTINCT FROM participant_ind
        ) THEN
          RAISE EXCEPTION 'apply_carrier_import_record: external participant relation %/% is already linked to a different CRM customer', r.provider, normalized_external_client_id;
        END IF;
      ELSIF participant_company IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.policy_participants pp
          WHERE pp.policy_id = pid
            AND pp.role = 'policyholder'
            AND pp.provider = r.provider
            AND NULLIF(BTRIM(pp.external_client_id), '') = normalized_external_client_id
            AND pp.company_id IS NOT NULL
            AND pp.company_id IS DISTINCT FROM participant_company
        ) THEN
          RAISE EXCEPTION 'apply_carrier_import_record: external participant relation %/% is already linked to a different CRM customer', r.provider, normalized_external_client_id;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.policy_participants AS ins_pp (policy_id, individual_client_id, company_id, role, provider, external_client_id, source)
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
      selected_policyholder_individual_client_id = CASE
        WHEN r.selected_policyholder_mode IN ('existing_individual', 'create_individual') THEN participant_ind
        ELSE r.selected_policyholder_individual_client_id
      END,
      selected_policyholder_company_id = CASE
        WHEN r.selected_policyholder_mode IN ('existing_company', 'create_company') THEN participant_company
        ELSE r.selected_policyholder_company_id
      END,
      apply_status = 'applied',
      apply_error = NULL,
      applied_at = now(),
      updated_at = now()
  WHERE id = p_record_id;

  RETURN QUERY SELECT 'applied'::text, owner_ind, owner_company, pid, false, false, NULL::text;
END; $$;
REVOKE ALL ON FUNCTION public.apply_carrier_import_record(uuid,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_carrier_import_record(uuid,jsonb,jsonb,jsonb,text) TO service_role;
