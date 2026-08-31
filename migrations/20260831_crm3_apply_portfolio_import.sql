-- =============================================================
-- Migration: CRM3 Block 4 — Confirm & Apply Portfolio Import
--
-- CONTEXT
-- Blocks 1–3 (already live) built manual Excel import in
-- preview/dry-run mode only: Excel -> carrier_sync_runs ->
-- carrier_import_records -> reconciliation -> Admin
-- Accept/Reject/Ignore. "Accepted" has never meant "may mutate the
-- CRM" — it only means "the Admin accepts this reconciliation
-- record for further processing". This migration adds the explicit,
-- persisted APPLY ACTIONS an Admin must resolve on every accepted
-- row before anything can be created or updated, plus the apply
-- status bookkeeping needed for an idempotent, retry-safe,
-- per-row-transactional apply operation.
--
-- This migration is purely ADDITIVE. It does not modify
-- 20260830_crm3_identity_reconciliation.sql or
-- 20260831_carrier_sync_runs_import_fingerprint.sql — both already
-- live in production — and it does not touch external_client_identities
-- or external_policy_identities' shape, only inserts into them (via the
-- new RPC below) using their existing columns exactly as Block 2 defined
-- them.
--
-- WHY selected_* COLUMNS ARE KEPT SEPARATE FROM matched_*
-- carrier_import_records already has matched_individual_client_id/
-- matched_company_id/matched_policy_id — the reconciliation ENGINE's
-- own suggestion, computed automatically and never touched again
-- after staging (see stageCarrierImportRecords). The new selected_*
-- columns are a different concept: the ADMIN's explicit, final
-- choice, which may differ from matched_* (e.g. an ambiguous customer
-- match where the Admin picks one candidate among several, or a
-- probable/new match the Admin overrides). Reusing matched_* for this
-- would destroy the audit trail of "what did the engine suggest vs.
-- what did the Admin actually decide to apply" — and this migration's
-- own audit requirement ("preserve carrier_import_record... decision,
-- apply actions, apply result") depends on keeping both. selected_*
-- also does double duty as the RESULT of a create action (see
-- apply_carrier_import_record below): once a row applies successfully,
-- selected_individual_client_id/selected_company_id/selected_policy_id
-- always hold the id that now actually exists in the CRM — whether it
-- was linked (unchanged) or newly created (filled in by the RPC) —
-- giving the UI one place to look to "view the resulting CRM
-- client/policy", without a second set of created_* columns.
--
-- WHY apply_status LIVES ON BOTH TABLES
-- carrier_import_records.apply_status tracks each ROW's own outcome
-- (pending/applied/skipped/failed) so a partially-failed run can be
-- represented precisely and a double-click is a safe no-op per row.
-- carrier_sync_runs.apply_status tracks the RUN as a whole
-- (not_applied/applying/applied/partially_failed) so the UI can show
-- one final state and disable "Confirm & Apply" once nothing more can
-- usefully be applied, and so "Cancel import" can be blocked the
-- moment ANY row has apply_status = applied (see the trigger at the
-- bottom of this file) without having to recompute that from records
-- every time.
-- =============================================================

-- ── Part 1: carrier_import_records — explicit, resolved apply actions ──

ALTER TABLE public.carrier_import_records
  ADD COLUMN IF NOT EXISTS customer_apply_action text NULL,
  ADD COLUMN IF NOT EXISTS policy_apply_action   text NULL,
  ADD COLUMN IF NOT EXISTS selected_individual_client_id uuid NULL
    REFERENCES public.individual_clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS selected_company_id           text NULL
    REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS selected_policy_id            text NULL
    REFERENCES public.policies(id) ON DELETE SET NULL,
  -- Only the explicitly approved CRM-policy field changes an Admin has
  -- signed off on — never applied just because a policy matched. Shape:
  -- a subset of { policyNumber, startDate, endDate, annualPremium,
  -- status } (camelCase — mirrors the Policy TS type field names 1:1 so
  -- no key-name translation is needed on either side of the RPC
  -- boundary). Absence of a key means "leave that field alone", not
  -- "clear it" — see apply_carrier_import_record's COALESCE-based
  -- UPDATE below.
  ADD COLUMN IF NOT EXISTS approved_policy_changes jsonb NULL,
  ADD COLUMN IF NOT EXISTS apply_status  text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS apply_error   text NULL,
  ADD COLUMN IF NOT EXISTS applied_at    timestamptz NULL;

ALTER TABLE public.carrier_import_records
  DROP CONSTRAINT IF EXISTS carrier_import_records_customer_apply_action_check;
ALTER TABLE public.carrier_import_records
  ADD CONSTRAINT carrier_import_records_customer_apply_action_check CHECK (
    customer_apply_action IS NULL OR customer_apply_action IN (
      'link_existing_individual', 'link_existing_company',
      'create_individual', 'create_company', 'no_customer_change'
    )
  );

ALTER TABLE public.carrier_import_records
  DROP CONSTRAINT IF EXISTS carrier_import_records_policy_apply_action_check;
ALTER TABLE public.carrier_import_records
  ADD CONSTRAINT carrier_import_records_policy_apply_action_check CHECK (
    policy_apply_action IS NULL OR policy_apply_action IN (
      'link_existing_policy', 'create_policy', 'update_existing_policy', 'no_policy_change'
    )
  );

ALTER TABLE public.carrier_import_records
  DROP CONSTRAINT IF EXISTS carrier_import_records_apply_status_check;
ALTER TABLE public.carrier_import_records
  ADD CONSTRAINT carrier_import_records_apply_status_check CHECK (
    apply_status IN ('pending', 'applied', 'skipped', 'failed')
  );

-- Same XOR shape as matched_individual_client_id/matched_company_id —
-- a selected customer is at most one of a person or a company, never
-- both (create_individual/create_company/link_existing_* only ever
-- resolve one side; no_customer_change may leave both null).
ALTER TABLE public.carrier_import_records
  DROP CONSTRAINT IF EXISTS carrier_import_records_selected_owner_check;
ALTER TABLE public.carrier_import_records
  ADD CONSTRAINT carrier_import_records_selected_owner_check CHECK (
    selected_individual_client_id IS NULL OR selected_company_id IS NULL
  );

CREATE INDEX IF NOT EXISTS carrier_import_records_apply_status_idx
  ON public.carrier_import_records (sync_run_id, apply_status);

-- ── Part 2: carrier_sync_runs — run-level apply state ───────────────

ALTER TABLE public.carrier_sync_runs
  ADD COLUMN IF NOT EXISTS apply_status     text NOT NULL DEFAULT 'not_applied',
  ADD COLUMN IF NOT EXISTS apply_started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS applied_at       timestamptz NULL,
  -- Nullable + ON DELETE SET NULL, same convention as marketing_campaigns
  -- .created_by (20260610_marketing.sql) — losing the auth user later must
  -- never cascade away the apply audit trail.
  ADD COLUMN IF NOT EXISTS applied_by       uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.carrier_sync_runs
  DROP CONSTRAINT IF EXISTS carrier_sync_runs_apply_status_check;
ALTER TABLE public.carrier_sync_runs
  ADD CONSTRAINT carrier_sync_runs_apply_status_check CHECK (
    apply_status IN ('not_applied', 'applying', 'applied', 'partially_failed')
  );

-- ── Part 3: block Cancel import / delete once ANY row has been applied ──
--
-- "Once ANY row has been applied, cancel import / delete run must be
-- disabled or rejected server-side." adminCancelCarrierSyncRun calls
-- deleteCarrierSyncRun, which is a plain DELETE on carrier_sync_runs
-- (ON DELETE CASCADE removes its carrier_import_records). Blocking this
-- in the database itself — not just in TypeScript — means it is
-- rejected even if some future code path forgets the application-level
-- check.
CREATE OR REPLACE FUNCTION public.prevent_delete_of_applied_carrier_sync_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.carrier_import_records
    WHERE sync_run_id = OLD.id AND apply_status = 'applied'
  ) THEN
    RAISE EXCEPTION 'carrier_sync_runs %: cannot delete a run that has applied records — the import run is now an audit trail', OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS carrier_sync_runs_block_delete_if_applied ON public.carrier_sync_runs;
CREATE TRIGGER carrier_sync_runs_block_delete_if_applied
  BEFORE DELETE ON public.carrier_sync_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_delete_of_applied_carrier_sync_run();

-- ── Part 4: apply_carrier_import_record — one row, one transaction ─────
--
-- Deliberately a "dumb SQL, smart TypeScript" split: every business
-- decision (which apply actions are valid for this row's state,
-- required-field validation for a *_apply_action, mapping the imported
-- Excel fields into Policy/IndividualClient/Company shapes, owner-
-- consistency pre-checks surfaced to the Admin before this is ever
-- called) happens in TypeScript BEFORE customer_apply_action/
-- policy_apply_action/selected_*/approved_policy_changes are persisted
-- onto the row (a separate "resolve apply action" step — see
-- src/lib/data.ts setCarrierImportRecordApplyActions). This function
-- then re-reads those already-persisted, already-validated columns
-- itself (never trusts a duplicate copy passed in as a parameter — the
-- only per-call inputs are the record id and the field VALUES needed
-- to create a genuinely new individual/company/policy, which cannot be
-- derived from anything already stored on the row). It performs the
-- raw INSERT/UPDATE statements directly rather than calling
-- createCompany/createPolicy/createIndividualClient/
-- createExternalClientIdentity/createExternalPolicyIdentity from
-- src/lib/data.ts, for two reasons:
--   1. createCompany (src/lib/data.ts) swallows its own error
--      (console.error, no throw) — unsafe inside code that needs a
--      reliable rollback signal.
--   2. External identity creation must happen in the SAME transaction
--      as customer/policy creation to guarantee "no half-created
--      customer without a policy link" — only achievable if it is also
--      raw SQL in this same function body; calling the existing
--      TypeScript helpers afterward would run in a separate
--      transaction/request entirely.
-- This does duplicate some conflict-detection logic already present in
-- createExternalClientIdentity/createExternalPolicyIdentity — a
-- deliberate, reasoned tradeoff for true atomicity, with the same
-- conflict semantics preserved (existing identity, same owner ->
-- idempotent no-op; existing identity, different owner -> abort the
-- whole row).
--
-- One function call = one implicit Postgres transaction. Any
-- RAISE EXCEPTION anywhere below rolls back every statement made
-- earlier in the SAME call — no half-created customer, no orphan
-- policy, no dangling external identity. The calling TypeScript code
-- (src/lib/data.ts applyCarrierImportRecord) catches the resulting
-- error, records apply_status='failed'/apply_error on that one record
-- in a SEPARATE statement, and moves on to the next accepted row — the
-- whole RUN is not one giant transaction, exactly as specified.
--
-- IDEMPOTENCY: the first thing this function does after locking the
-- row is check apply_status. A second call for an already-applied row
-- returns result_status='already_applied' immediately, mutating
-- nothing — a double "Confirm & Apply" click, or two concurrent apply
-- passes over the same run, can never duplicate a customer/policy/
-- external identity. FOR UPDATE on the carrier_import_records row (and
-- on the policies row, when linking one) serializes concurrent callers
-- so this check-then-act is race-safe, not just single-request-safe.
--
-- p_new_individual / p_new_company / p_new_policy: jsonb bundles
-- (rather than a long flat parameter list) of the fields needed ONLY
-- when the corresponding *_apply_action requires creating a new row —
-- ignored otherwise. Keys are camelCase, matching the TS field names
-- verbatim (fullName/nif/email/phone/address;
-- name/nif/contactName/contactEmail/contactPhone/address;
-- insurer/policyNumber/startDate/endDate/annualPremium/type/
-- description/insuredValue) so src/lib/data.ts can pass its already-
-- mapped ParsedImportRow-derived object straight through with no
-- reshaping.
--
-- p_external_policy_number_normalized: precomputed by the caller via
-- the EXISTING normalizePolicyNumber (src/lib/identity-normalization.ts)
-- — deliberately NOT reimplemented in SQL, so the fallback matching key
-- used here can never drift from the one createExternalPolicyIdentity
-- already uses.
CREATE OR REPLACE FUNCTION public.apply_carrier_import_record(
  p_record_id uuid,
  p_new_individual jsonb DEFAULT NULL,
  p_new_company jsonb DEFAULT NULL,
  p_new_policy jsonb DEFAULT NULL,
  p_external_policy_number_normalized text DEFAULT NULL
)
RETURNS TABLE (
  result_status                    text,
  individual_client_id             uuid,
  company_id                       text,
  policy_id                        text,
  external_client_identity_created boolean,
  external_policy_identity_created boolean,
  error_message                    text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_record                    public.carrier_import_records%ROWTYPE;
  v_policy                    public.policies%ROWTYPE;
  v_existing_client_identity  public.external_client_identities%ROWTYPE;
  v_existing_policy_identity  public.external_policy_identities%ROWTYPE;

  v_individual_id             uuid;
  v_company_id                text;
  v_policy_id                 text;
  v_full_name                 text;
  v_company_name               text;
  v_company_nif                 text;
  v_insurer                   text;
  v_policy_number              text;
  v_start_date                 date;
  v_end_date                   date;

  v_client_identity_created   boolean := false;
  v_policy_identity_created   boolean := false;
BEGIN
  IF p_record_id IS NULL THEN
    RAISE EXCEPTION 'apply_carrier_import_record: record id vazio';
  END IF;

  -- Lock the row first, before anything else — see IDEMPOTENCY above.
  SELECT * INTO v_record FROM public.carrier_import_records WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_carrier_import_record: carrier_import_record % não existe', p_record_id;
  END IF;

  IF v_record.apply_status = 'applied' THEN
    RETURN QUERY SELECT
      'already_applied'::text, v_record.selected_individual_client_id, v_record.selected_company_id,
      v_record.selected_policy_id, false, false, NULL::text;
    RETURN;
  END IF;

  IF v_record.decision_status <> 'accepted' THEN
    RAISE EXCEPTION 'apply_carrier_import_record: record % is not accepted (decision_status=%)', p_record_id, v_record.decision_status;
  END IF;

  IF v_record.customer_apply_action IS NULL OR v_record.policy_apply_action IS NULL THEN
    RAISE EXCEPTION 'apply_carrier_import_record: record % is missing an explicit apply action', p_record_id;
  END IF;

  -- ── CUSTOMER RESOLUTION ────────────────────────────────────────────
  CASE v_record.customer_apply_action
    WHEN 'no_customer_change' THEN
      v_individual_id := v_record.selected_individual_client_id;
      v_company_id    := v_record.selected_company_id;

    WHEN 'link_existing_individual' THEN
      IF v_record.selected_individual_client_id IS NULL THEN
        RAISE EXCEPTION 'apply_carrier_import_record: link_existing_individual requires selected_individual_client_id';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.individual_clients WHERE id = v_record.selected_individual_client_id) THEN
        RAISE EXCEPTION 'apply_carrier_import_record: selected individual_client % does not exist', v_record.selected_individual_client_id;
      END IF;
      v_individual_id := v_record.selected_individual_client_id;

    WHEN 'link_existing_company' THEN
      IF v_record.selected_company_id IS NULL THEN
        RAISE EXCEPTION 'apply_carrier_import_record: link_existing_company requires selected_company_id';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_record.selected_company_id) THEN
        RAISE EXCEPTION 'apply_carrier_import_record: selected company % does not exist', v_record.selected_company_id;
      END IF;
      v_company_id := v_record.selected_company_id;

    WHEN 'create_individual' THEN
      v_full_name := NULLIF(btrim(COALESCE(p_new_individual->>'fullName', '')), '');
      IF v_full_name IS NULL THEN
        RAISE EXCEPTION 'apply_carrier_import_record: create_individual requires a full name';
      END IF;
      INSERT INTO public.individual_clients (id, full_name, nif, email, phone, address, status, created_at)
      VALUES (
        gen_random_uuid(), v_full_name,
        NULLIF(p_new_individual->>'nif', ''), NULLIF(p_new_individual->>'email', ''),
        NULLIF(p_new_individual->>'phone', ''), NULLIF(p_new_individual->>'address', ''),
        'active', now()
      )
      RETURNING id INTO v_individual_id;

    WHEN 'create_company' THEN
      v_company_name := NULLIF(btrim(COALESCE(p_new_company->>'name', '')), '');
      v_company_nif  := NULLIF(btrim(COALESCE(p_new_company->>'nif', '')), '');
      IF v_company_name IS NULL THEN
        RAISE EXCEPTION 'apply_carrier_import_record: create_company requires a name';
      END IF;
      IF v_company_nif IS NULL THEN
        RAISE EXCEPTION 'apply_carrier_import_record: create_company requires a NIF';
      END IF;
      v_company_id := 'comp_' || (floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint::text;
      INSERT INTO public.companies (id, name, nif, sector, contact_name, contact_email, contact_phone, address, created_at)
      VALUES (
        v_company_id, v_company_name, v_company_nif,
        COALESCE(NULLIF(p_new_company->>'sector', ''), ''),
        COALESCE(NULLIF(p_new_company->>'contactName', ''), v_company_name),
        COALESCE(NULLIF(p_new_company->>'contactEmail', ''), ''),
        COALESCE(NULLIF(p_new_company->>'contactPhone', ''), ''),
        COALESCE(NULLIF(p_new_company->>'address', ''), ''),
        now()
      );

    ELSE
      RAISE EXCEPTION 'apply_carrier_import_record: unknown customer_apply_action %', v_record.customer_apply_action;
  END CASE;

  -- ── POLICY RESOLUTION ────────────────────────────────────────────
  CASE v_record.policy_apply_action
    WHEN 'no_policy_change' THEN
      v_policy_id := v_record.selected_policy_id;

    WHEN 'link_existing_policy', 'update_existing_policy' THEN
      IF v_record.selected_policy_id IS NULL THEN
        RAISE EXCEPTION 'apply_carrier_import_record: % requires selected_policy_id', v_record.policy_apply_action;
      END IF;

      SELECT * INTO v_policy FROM public.policies WHERE id = v_record.selected_policy_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'apply_carrier_import_record: selected policy % does not exist', v_record.selected_policy_id;
      END IF;
      v_policy_id := v_policy.id;

      -- OWNER CONSISTENCY — a resolved customer this row must match the
      -- selected policy's actual current owner. Reparenting is out of
      -- scope for Block 4 (see migration header of
      -- 20260830_crm3_identity_reconciliation.sql and the Block 4 spec's
      -- "Owner Consistency" requirement) — mismatch always blocks.
      -- individual_client_id on policies predates this migrations/
      -- folder with no confirmed type (see TYPE-AMBIGUITY NOTE in
      -- 20260830_fix_promote_client_to_company.sql) — cast to text on
      -- both sides, exactly like that migration does.
      IF v_individual_id IS NOT NULL OR v_company_id IS NOT NULL THEN
        IF NOT (
          (v_individual_id IS NOT NULL AND v_policy.individual_client_id::text = v_individual_id::text)
          OR (v_company_id IS NOT NULL AND v_policy.company_id = v_company_id)
        ) THEN
          RAISE EXCEPTION 'apply_carrier_import_record: owner mismatch — policy % does not belong to the selected customer', v_policy_id;
        END IF;
      END IF;

      IF v_record.policy_apply_action = 'update_existing_policy' THEN
        IF v_record.approved_policy_changes IS NULL OR v_record.approved_policy_changes = '{}'::jsonb THEN
          RAISE EXCEPTION 'apply_carrier_import_record: update_existing_policy requires approved_policy_changes';
        END IF;
      END IF;

      -- Only explicitly approved fields are ever written — presence of a
      -- key means "apply this change", absence means "leave it alone".
      -- Matched/probable/exact never implies an overwrite by itself.
      IF v_record.approved_policy_changes IS NOT NULL AND v_record.approved_policy_changes <> '{}'::jsonb THEN
        UPDATE public.policies SET
          policy_number  = COALESCE(NULLIF(v_record.approved_policy_changes->>'policyNumber', ''), policy_number),
          start_date     = COALESCE(NULLIF(v_record.approved_policy_changes->>'startDate', '')::date, start_date),
          end_date       = COALESCE(NULLIF(v_record.approved_policy_changes->>'endDate', '')::date, end_date),
          annual_premium = COALESCE((v_record.approved_policy_changes->>'annualPremium')::numeric, annual_premium),
          status         = COALESCE(NULLIF(v_record.approved_policy_changes->>'status', ''), status)
        WHERE id = v_policy_id;
      END IF;

    WHEN 'create_policy' THEN
      IF v_individual_id IS NULL AND v_company_id IS NULL THEN
        RAISE EXCEPTION 'apply_carrier_import_record: create_policy requires a resolved customer';
      END IF;

      v_insurer      := NULLIF(btrim(COALESCE(p_new_policy->>'insurer', '')), '');
      v_policy_number := NULLIF(btrim(COALESCE(p_new_policy->>'policyNumber', '')), '');
      v_start_date    := NULLIF(p_new_policy->>'startDate', '')::date;
      v_end_date      := NULLIF(p_new_policy->>'endDate', '')::date;

      IF v_insurer IS NULL OR v_policy_number IS NULL OR v_start_date IS NULL OR v_end_date IS NULL THEN
        RAISE EXCEPTION 'apply_carrier_import_record: create_policy is missing a required field (insurer/policyNumber/startDate/endDate)';
      END IF;

      -- Same id convention as adminCreatePolicy (src/lib/server-fns.ts):
      -- 'pol_' || epoch-millis.
      v_policy_id := 'pol_' || (floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint::text;
      INSERT INTO public.policies (
        id, company_id, individual_client_id, type, insurer, policy_number, description,
        start_date, end_date, annual_premium, insured_value, status, created_at
      ) VALUES (
        v_policy_id,
        -- companies.id is text and Policy.companyId is a required string
        -- using '' as the "no company" sentinel — same convention
        -- adminCreatePolicy already uses (data.companyId || '').
        COALESCE(v_company_id, ''),
        v_individual_id,
        COALESCE(NULLIF(p_new_policy->>'type', ''), 'health'),
        v_insurer, v_policy_number,
        COALESCE(NULLIF(p_new_policy->>'description', ''), ''),
        v_start_date, v_end_date,
        -- Never overwrite with null/empty — for a NEW row there is
        -- nothing to overwrite, but a missing premium/insuredValue
        -- still needs a concrete value: 0, not null, matching Policy's
        -- required `annualPremium`/`insuredValue: number` (insuredValue
        -- structurally has no source field in a health-insurance
        -- portfolio feed).
        COALESCE((p_new_policy->>'annualPremium')::numeric, 0),
        COALESCE((p_new_policy->>'insuredValue')::numeric, 0),
        'active', now()
      );

    ELSE
      RAISE EXCEPTION 'apply_carrier_import_record: unknown policy_apply_action %', v_record.policy_apply_action;
  END CASE;

  -- ── EXTERNAL CLIENT IDENTITY ─────────────────────────────────────
  IF (v_individual_id IS NOT NULL OR v_company_id IS NOT NULL)
     AND v_record.external_client_id IS NOT NULL AND btrim(v_record.external_client_id) <> '' THEN
    SELECT * INTO v_existing_client_identity
    FROM public.external_client_identities
    WHERE provider = v_record.provider AND external_client_id = v_record.external_client_id;

    IF FOUND THEN
      IF NOT (
        (v_individual_id IS NOT NULL AND v_existing_client_identity.individual_client_id = v_individual_id)
        OR (v_company_id IS NOT NULL AND v_existing_client_identity.company_id = v_company_id)
      ) THEN
        RAISE EXCEPTION 'apply_carrier_import_record: external client identity %/% is already linked to a different CRM customer', v_record.provider, v_record.external_client_id;
      END IF;
      -- Same owner already linked — idempotent no-op.
    ELSE
      INSERT INTO public.external_client_identities (
        id, individual_client_id, company_id, provider, external_client_id,
        first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_individual_id, v_company_id, v_record.provider, v_record.external_client_id,
        now(), now(), now(), now()
      );
      v_client_identity_created := true;
    END IF;
  END IF;

  -- ── EXTERNAL POLICY IDENTITY ──────────────────────────────────────
  IF v_policy_id IS NOT NULL
     AND v_record.external_policy_number IS NOT NULL AND btrim(v_record.external_policy_number) <> '' THEN
    IF v_record.external_policy_id IS NOT NULL AND btrim(v_record.external_policy_id) <> '' THEN
      SELECT * INTO v_existing_policy_identity
      FROM public.external_policy_identities
      WHERE provider = v_record.provider AND external_policy_id = v_record.external_policy_id;
    ELSIF p_external_policy_number_normalized IS NOT NULL THEN
      SELECT * INTO v_existing_policy_identity
      FROM public.external_policy_identities
      WHERE provider = v_record.provider AND policy_id = v_policy_id
        AND external_policy_number_normalized = p_external_policy_number_normalized;
    ELSE
      v_existing_policy_identity := NULL;
    END IF;

    IF v_existing_policy_identity.id IS NOT NULL THEN
      IF v_existing_policy_identity.policy_id <> v_policy_id THEN
        RAISE EXCEPTION 'apply_carrier_import_record: external policy identity %/% is already linked to a different CRM policy', v_record.provider, v_record.external_policy_id;
      END IF;
      -- Already linked to this same policy — idempotent no-op.
    ELSE
      INSERT INTO public.external_policy_identities (
        id, policy_id, provider, external_policy_id, external_policy_number,
        external_policy_number_normalized, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_policy_id, v_record.provider, v_record.external_policy_id, v_record.external_policy_number,
        p_external_policy_number_normalized, now(), now(), now(), now()
      );
      v_policy_identity_created := true;
    END IF;
  END IF;

  -- ── FINALIZE ────────────────────────────────────────────────────
  UPDATE public.carrier_import_records SET
    selected_individual_client_id = v_individual_id,
    selected_company_id           = v_company_id,
    selected_policy_id            = v_policy_id,
    apply_status = 'applied',
    apply_error  = NULL,
    applied_at   = now(),
    updated_at   = now()
  WHERE id = p_record_id;

  RETURN QUERY SELECT
    'applied'::text, v_individual_id, v_company_id, v_policy_id,
    v_client_identity_created, v_policy_identity_created, NULL::text;
END;
$$;

-- No SECURITY DEFINER — same posture as every prior CRM3 RPC (see
-- promote_individual_client_to_company): the function runs as whatever
-- role calls it, and only service_role (src/lib/data.ts, bypasses RLS
-- entirely already) is ever granted EXECUTE. No browser/anon/
-- authenticated caller can invoke this directly.
REVOKE ALL ON FUNCTION public.apply_carrier_import_record(uuid, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_carrier_import_record(uuid, jsonb, jsonb, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_carrier_import_record(uuid, jsonb, jsonb, jsonb, text) TO service_role;

-- =============================================================
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * Does not reparent an existing policy's owner. Owner mismatch
--     between a selected customer and a selected existing policy is
--     always a blocking conflict in Block 4 — there is no "reassign
--     owner" action, matching the spec's explicit "no automatic
--     reparenting" requirement.
--   * Does not auto-merge two customer records, ever.
--   * Does not overwrite existing customer contact fields (name/
--     email/phone/address) from carrier data — only NEW individual/
--     company rows are populated from imported data; an existing,
--     linked customer's own row is never UPDATEd by this function.
--   * Does not persist nib/iban anywhere — they were never part of
--     ParsedImportRow (see carrier-import-mappers.ts) and are not
--     accepted as parameters here either.
--   * Does not run as SECURITY DEFINER and does not grant EXECUTE to
--     anon/authenticated — service_role only, exactly like
--     promote_individual_client_to_company.
--   * Does not delete or alter existing carrier_import_records rows'
--     decision_status/decision_note/matched_*/raw_payload — only the
--     new apply-related columns are ever written by this function.
-- =============================================================
