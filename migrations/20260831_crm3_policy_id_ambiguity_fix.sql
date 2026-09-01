-- CRM3 hotfix: "column reference policy_id is ambiguous" on every MGEN
-- apply.
--
-- ROOT CAUSE
-- Both apply_carrier_import_record_block4 (originally
-- migrations/20260831_crm3_apply_legacy_owner_fix.sql, renamed by
-- migrations/20260831_crm3_policy_participants.sql) and the
-- apply_carrier_import_record wrapper it delegates to declare
-- RETURNS TABLE (..., individual_client_id uuid, company_id text,
-- policy_id text, ...). Each RETURNS TABLE column becomes an
-- implicitly-declared PL/pgSQL variable inside the function body. Two
-- embedded SQL statements had a BARE, unqualified reference to a
-- column of the same name as one of these output columns, inside a
-- FROM-clause scope where a real table also has that column — Postgres
-- (plpgsql.variable_conflict = error, the default, left untouched per
-- this fix's own instruction not to change that setting) cannot tell
-- whether the bare name means the output variable or the table column,
-- and raises "column reference ... is ambiguous":
--
--   1. apply_carrier_import_record_block4 — the external policy
--      identity fallback lookup (used whenever a staged record has no
--      external_policy_id, which is every MGEN row: the MGEN mapper
--      never populates externalPolicyId, only externalPolicyNumber —
--      see carrier-import-mappers.ts):
--        SELECT * INTO v_existing_policy_identity
--        FROM public.external_policy_identities
--        WHERE provider = v_record.provider
--          AND policy_id = v_policy_id                 -- ambiguous
--          AND external_policy_number_normalized = p_external_policy_number_normalized;
--      This exact statement runs for EVERY accepted MGEN row with a
--      resolved policy, regardless of customer_apply_action — which is
--      why production run 56416276-9457-4e00-b3bb-d070ea37b964 failed
--      on all four rows identically, not just the policyholder-
--      participant one.
--
--   2. apply_carrier_import_record (the policyholder-participant
--      wrapper) — the policy_participants idempotency guard's ON
--      CONFLICT target. Plain column names in a conflict target
--      (policy_id, role) resolve directly against the INSERT's target
--      relation and are never at risk, but an EXPRESSION inside a
--      conflict target IS parsed as ordinary SQL and IS subject to the
--      same PL/pgSQL variable substitution as a WHERE clause:
--        INSERT INTO public.policy_participants (policy_id, individual_client_id, company_id, ...)
--        VALUES (...)
--        ON CONFLICT (policy_id, role, COALESCE(individual_client_id::text, company_id)) DO NOTHING; -- ambiguous
--      individual_client_id/company_id here collide with the same two
--      RETURNS TABLE output columns.
--
-- FIX
-- Qualify every at-risk reference with a table alias — nothing else.
-- Not a global `SET plpgsql.variable_conflict`, no database column
-- renamed, no application semantics changed:
--   1. `FROM public.external_policy_identities` gets an alias (epi),
--      and every column read against it (provider/policy_id/
--      external_policy_number_normalized) is qualified with epi..
--   2. The policy_participants INSERT's target gets an alias (ins_pp),
--      used ONLY inside the ON CONFLICT expression
--      (COALESCE(ins_pp.individual_client_id::text, ins_pp.company_id)) —
--      the plain policy_id/role conflict-target names are left exactly
--      as they were (never ambiguous to begin with — see above), and
--      the alias resolves to the exact same table/columns the unique
--      index (policy_participants_policy_owner_role_uidx) was built
--      against, so index-inference matching for ON CONFLICT ... DO
--      NOTHING is unaffected.
--
-- Every other line below is reproduced byte-for-byte from the two
-- functions' current live bodies — same signatures, same RETURNS TABLE
-- shape, same REVOKE/GRANT posture (service_role EXECUTE only, no
-- SECURITY DEFINER — neither function used it before, neither does
-- now), same owner-mismatch checks, same approved_policy_changes
-- allowlist, same idempotency (apply_status='applied' short-circuit),
-- same external identity conflict handling, same policyholder
-- participant creation/linking. This migration only CREATE OR REPLACEs
-- the two functions; it adds no column, no table, no constraint, and
-- touches no existing row.
--
-- Additive only. Does not edit or reapply
-- migrations/20260831_crm3_apply_portfolio_import.sql,
-- migrations/20260831_crm3_apply_legacy_owner_fix.sql, or
-- migrations/20260831_crm3_policy_participants.sql.
--
-- SECOND FIX (found while preparing this hotfix, pre-existing, unrelated
-- to the ambiguity bug above): apply_carrier_import_record's
-- add_policyholder_to_existing_client path used to run TWO
-- `CASE r.selected_policyholder_mode` resolution blocks — an early one,
-- before policy resolution, that already INSERTed a brand new
-- individual_clients/companies row for create_individual/create_company
-- (and redundantly re-validated existing_individual/existing_company),
-- and a later, canonical one, after policy resolution, that
-- independently re-resolves the participant from scratch (existing-
-- selection reuse, external identity reuse, create-only-if-still-
-- unresolved, retry persistence, policy_participants insertion, external
-- identity linking) and overwrites whatever the early block produced.
-- The early block's create-mode INSERT was therefore pure orphan
-- creation: on every create_individual/create_company apply it left
-- behind a person/company row referenced by nothing. Confirmed to affect
-- the real production MGEN row for 75846 / Bella Feigina
-- (add_policyholder_to_existing_client, selected_policyholder_mode =
-- create_individual, against a policy owned by Ilya). Fixed by removing
-- the early block's CASE entirely, keeping only the mode-shape
-- validation that must still run before policy resolution (mode not
-- null, mode is one of the four known values); the later block remains
-- the sole authoritative participant-resolution path.

CREATE OR REPLACE FUNCTION public.apply_carrier_import_record_block4(
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
      SELECT * INTO v_existing_policy_identity FROM public.external_policy_identities epi WHERE epi.provider = v_record.provider AND epi.policy_id = v_policy_id AND epi.external_policy_number_normalized = p_external_policy_number_normalized;
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

REVOKE ALL ON FUNCTION public.apply_carrier_import_record_block4(uuid, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_carrier_import_record_block4(uuid, jsonb, jsonb, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_carrier_import_record_block4(uuid, jsonb, jsonb, jsonb, text) TO service_role;
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
    ON CONFLICT (policy_id, role, COALESCE(ins_pp.individual_client_id::text, ins_pp.company_id)) DO NOTHING;

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
