-- =============================================================
-- Migration: CRM3 identity & reconciliation foundation (Block 1)
--
-- CONTEXT
-- Foundation tables for carrier reconciliation (CRM3), designed off the
-- read-only production audit (2026-08-30): individual_clients.id is uuid,
-- companies.id/policies.id/policies.policy_number/policies.insurer are all
-- text, there is no unique constraint on policy_number today, and 0
-- duplicate non-empty NIF / policy_number groups were found in production
-- at audit time. That zero count is NOT relied on here — no uniqueness is
-- added on raw NIF or on policies.policy_number by this migration.
--
-- This migration ONLY adds new, empty, admin-only staging/linking tables.
-- It does not alter individual_clients, companies, policies, or any other
-- existing table, and does not write any data.
--
-- SCOPE
--   1. external_client_identities  — links a carrier's customer record to
--      an existing individual_client OR company (never both), keyed by
--      (provider, external_client_id).
--   2. external_policy_identities  — links a carrier's policy record to an
--      existing internal policy, keyed by (provider, external_policy_id)
--      when present; policy number alone is never made unique.
--   3. carrier_sync_runs           — one row per carrier import/dry-run
--      attempt, aggregate counts only, no credentials/secrets.
--   4. carrier_import_records      — one row per incoming carrier
--      record within a sync run, its raw payload, and the reconciliation
--      decision made about it. Nothing here mutates individual_clients/
--      companies/policies; matched_*_id columns only ever point AT an
--      existing row (ON DELETE SET NULL), never create or replace one.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No UNIQUE constraint on any raw/stored NIF column.
--   * No UNIQUE constraint on policies.policy_number (raw or normalized).
--   * No GLOBAL UNIQUE constraint on external_policy_identities
--     (provider, external_policy_number_normalized) — the plain, partial,
--     non-unique lookup index on that pair stays exactly as it was (two
--     different internal policies, or two different providers, may
--     legitimately share the same normalized number). The one scoped
--     uniqueness added below (policy_id, provider,
--     external_policy_number_normalized) is narrower still: it only
--     stops the SAME internal policy from accumulating duplicate
--     fallback-identity rows for the SAME provider+number, never a
--     cross-policy or cross-provider identity claim.
--   * No merge/import/write code, no admin UI, no carrier API calls or
--     credentials — this is schema only.
--
-- AMENDMENT (same day, still pending — never applied to production)
-- A pre-production review found two integrity gaps:
--   * carrier_import_records had no constraint stopping a staging record
--     from claiming BOTH a matched individual_client AND a matched
--     company at once — added carrier_import_records_matched_owner_check
--     (at most one, matching "AT MOST ONE customer candidate owner";
--     unlike the XOR checks elsewhere, NEITHER is still valid here, since
--     unmatched/new/error records have no owner yet).
--   * external_policy_identities had no protection against the fallback
--     (no external_policy_id) linking path creating duplicate rows for
--     the same policy/provider/number on a race or a repeated deliberate
--     link — added the scoped partial unique index described above.
--     The corresponding data-layer function
--     (createExternalPolicyIdentity in src/lib/data.ts) now derives
--     external_policy_number_normalized itself via normalizePolicyNumber
--     server-side rather than trusting a caller-supplied value, and
--     treats a race against this index as "already_linked" (re-queries
--     rather than assuming a conflict).
-- =============================================================

-- ── 1. external_client_identities ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.external_client_identities (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  individual_client_id     uuid        NULL REFERENCES public.individual_clients(id) ON DELETE CASCADE,
  company_id               text        NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  provider                 text        NOT NULL,
  external_client_id       text        NOT NULL,
  external_client_number   text        NULL,

  tax_country              text        NULL,
  tax_id_type              text        NULL,
  tax_id_raw               text        NULL,
  tax_id_normalized        text        NULL,

  metadata                 jsonb       NOT NULL DEFAULT '{}'::jsonb,

  first_seen_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at             timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT external_client_identities_scope_check CHECK (
    (individual_client_id IS NOT NULL AND company_id IS NULL)
    OR
    (individual_client_id IS NULL AND company_id IS NOT NULL)
  ),

  CONSTRAINT external_client_identities_provider_external_id_uidx UNIQUE (provider, external_client_id)
);

CREATE INDEX IF NOT EXISTS external_client_identities_individual_idx
  ON public.external_client_identities (individual_client_id);

CREATE INDEX IF NOT EXISTS external_client_identities_company_idx
  ON public.external_client_identities (company_id);

CREATE INDEX IF NOT EXISTS external_client_identities_provider_idx
  ON public.external_client_identities (provider);

-- Deliberately NOT unique — tax_id_normalized is a lookup aid for the
-- reconciliation engine, not an identity guarantee (see "WHAT THIS
-- MIGRATION DELIBERATELY DOES NOT DO" above).
CREATE INDEX IF NOT EXISTS external_client_identities_tax_normalized_idx
  ON public.external_client_identities (tax_id_normalized)
  WHERE tax_id_normalized IS NOT NULL;

ALTER TABLE public.external_client_identities ENABLE ROW LEVEL SECURITY;

-- Admin-only, same convention as client_notes/client_tasks/
-- sales_opportunities/website_leads: RLS enabled, no anon/public policies,
-- every policy gated by is_admin(). service_role (used exclusively by
-- src/lib/data.ts / src/lib/server-fns.ts) bypasses RLS entirely, as
-- always in this codebase.
DROP POLICY IF EXISTS external_client_identities_select ON public.external_client_identities;
CREATE POLICY external_client_identities_select
  ON public.external_client_identities
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

DROP POLICY IF EXISTS external_client_identities_insert ON public.external_client_identities;
CREATE POLICY external_client_identities_insert
  ON public.external_client_identities
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS external_client_identities_update ON public.external_client_identities;
CREATE POLICY external_client_identities_update
  ON public.external_client_identities
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin() )
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS external_client_identities_delete ON public.external_client_identities;
CREATE POLICY external_client_identities_delete
  ON public.external_client_identities
  FOR DELETE
  TO authenticated
  USING ( public.is_admin() );

-- ── 2. external_policy_identities ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.external_policy_identities (
  id                                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  policy_id                            text        NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,

  provider                             text        NOT NULL,

  external_policy_id                   text        NULL,
  external_policy_number               text        NOT NULL,
  external_policy_number_normalized    text        NULL,

  metadata                             jsonb       NOT NULL DEFAULT '{}'::jsonb,

  first_seen_at                        timestamptz NOT NULL DEFAULT now(),
  last_seen_at                         timestamptz NOT NULL DEFAULT now(),
  created_at                           timestamptz NOT NULL DEFAULT now(),
  updated_at                           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS external_policy_identities_policy_idx
  ON public.external_policy_identities (policy_id);

CREATE INDEX IF NOT EXISTS external_policy_identities_provider_idx
  ON public.external_policy_identities (provider);

-- Lookup aid only — deliberately NOT unique (see migration header). Global
-- across providers/policies on purpose: it is a reconciliation-evidence
-- index, never an identity guarantee. Different internal policies, and
-- different providers, may legitimately share the same normalized number.
CREATE INDEX IF NOT EXISTS external_policy_identities_number_idx
  ON public.external_policy_identities (provider, external_policy_number_normalized)
  WHERE external_policy_number_normalized IS NOT NULL;

-- The one authoritative uniqueness in this table: a given carrier's own
-- policy id can only ever be linked to one internal policy. Partial
-- because external_policy_id itself is optional (some carrier feeds may
-- not expose a stable id, only a policy number).
CREATE UNIQUE INDEX IF NOT EXISTS external_policy_identities_provider_external_id_uidx
  ON public.external_policy_identities (provider, external_policy_id)
  WHERE external_policy_id IS NOT NULL;

-- Fallback-link idempotency (only relevant when external_policy_id is
-- absent): prevents linking the SAME internal policy to the SAME provider
-- with the SAME normalized number more than once. Scoped to policy_id —
-- NOT a global (provider, external_policy_number_normalized) uniqueness.
-- Two different internal policies, or the same number under a different
-- provider, are explicitly allowed to coexist; policy_number is
-- reconciliation evidence for ONE already-known policy here, never a
-- cross-policy identity claim (see "WHAT THIS MIGRATION DELIBERATELY DOES
-- NOT DO" at the top of this file).
CREATE UNIQUE INDEX IF NOT EXISTS external_policy_identities_policy_provider_number_uidx
  ON public.external_policy_identities (policy_id, provider, external_policy_number_normalized)
  WHERE external_policy_id IS NULL AND external_policy_number_normalized IS NOT NULL;

ALTER TABLE public.external_policy_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS external_policy_identities_select ON public.external_policy_identities;
CREATE POLICY external_policy_identities_select
  ON public.external_policy_identities
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

DROP POLICY IF EXISTS external_policy_identities_insert ON public.external_policy_identities;
CREATE POLICY external_policy_identities_insert
  ON public.external_policy_identities
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS external_policy_identities_update ON public.external_policy_identities;
CREATE POLICY external_policy_identities_update
  ON public.external_policy_identities
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin() )
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS external_policy_identities_delete ON public.external_policy_identities;
CREATE POLICY external_policy_identities_delete
  ON public.external_policy_identities
  FOR DELETE
  TO authenticated
  USING ( public.is_admin() );

-- ── 3. carrier_sync_runs ─────────────────────────────────────────
-- One row per carrier import/dry-run attempt. Aggregate counters only —
-- no customer data, no credentials, no secrets.
CREATE TABLE IF NOT EXISTS public.carrier_sync_runs (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  provider               text        NOT NULL,

  mode                   text        NOT NULL CHECK (mode IN ('dry_run', 'import')),
  status                 text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'processing', 'completed', 'failed')),

  started_at             timestamptz NULL,
  completed_at           timestamptz NULL,

  records_received       integer     NOT NULL DEFAULT 0,
  records_exact_match    integer     NOT NULL DEFAULT 0,
  records_review         integer     NOT NULL DEFAULT 0,
  records_new            integer     NOT NULL DEFAULT 0,
  records_error          integer     NOT NULL DEFAULT 0,

  summary                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error_message          text        NULL,

  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS carrier_sync_runs_provider_created_at_idx
  ON public.carrier_sync_runs (provider, created_at DESC);

ALTER TABLE public.carrier_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS carrier_sync_runs_select ON public.carrier_sync_runs;
CREATE POLICY carrier_sync_runs_select
  ON public.carrier_sync_runs
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

DROP POLICY IF EXISTS carrier_sync_runs_insert ON public.carrier_sync_runs;
CREATE POLICY carrier_sync_runs_insert
  ON public.carrier_sync_runs
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS carrier_sync_runs_update ON public.carrier_sync_runs;
CREATE POLICY carrier_sync_runs_update
  ON public.carrier_sync_runs
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin() )
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS carrier_sync_runs_delete ON public.carrier_sync_runs;
CREATE POLICY carrier_sync_runs_delete
  ON public.carrier_sync_runs
  FOR DELETE
  TO authenticated
  USING ( public.is_admin() );

-- ── 4. carrier_import_records ───────────────────────────────────
-- One row per incoming carrier record within a sync run: its raw payload
-- plus the reconciliation engine's decision about it. matched_*_id columns
-- only ever reference an EXISTING individual_client/company/policy — this
-- table never creates, updates, or deletes one (ON DELETE SET NULL: if the
-- matched row is later legitimately removed, the staging record survives
-- with the link cleared, it is not cascaded away).
CREATE TABLE IF NOT EXISTS public.carrier_import_records (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  sync_run_id                   uuid        NOT NULL REFERENCES public.carrier_sync_runs(id) ON DELETE CASCADE,

  provider                      text        NOT NULL,

  external_record_id            text        NULL,
  external_client_id            text        NULL,
  external_policy_id            text        NULL,
  external_policy_number        text        NULL,

  market                        text        NULL,

  raw_payload                   jsonb       NOT NULL DEFAULT '{}'::jsonb,

  customer_match_status         text        NOT NULL DEFAULT 'unmatched'
    CHECK (customer_match_status IN ('unmatched', 'exact', 'probable', 'ambiguous', 'new', 'linked', 'ignored', 'error')),
  policy_match_status            text       NOT NULL DEFAULT 'unmatched'
    CHECK (policy_match_status IN ('unmatched', 'exact', 'probable', 'ambiguous', 'new', 'linked', 'ignored', 'error')),

  matched_individual_client_id  uuid        NULL REFERENCES public.individual_clients(id) ON DELETE SET NULL,
  matched_company_id            text        NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  matched_policy_id             text        NULL REFERENCES public.policies(id) ON DELETE SET NULL,

  customer_match_reason         text        NULL,
  policy_match_reason           text        NULL,

  decision_status                text       NOT NULL DEFAULT 'pending'
    CHECK (decision_status IN ('pending', 'accepted', 'rejected', 'ignored')),

  decision_note                 text        NULL,
  decided_at                    timestamptz NULL,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  -- AT MOST one customer candidate owner — never both. Unlike
  -- companies/individual_clients' own XOR checks elsewhere (which require
  -- EXACTLY one), this is deliberately weaker: unmatched/new/error records
  -- legitimately have NEITHER a matched individual client nor a matched
  -- company yet.
  CONSTRAINT carrier_import_records_matched_owner_check CHECK (
    matched_individual_client_id IS NULL
    OR matched_company_id IS NULL
  )
);

CREATE INDEX IF NOT EXISTS carrier_import_records_run_idx
  ON public.carrier_import_records (sync_run_id);

CREATE INDEX IF NOT EXISTS carrier_import_records_provider_idx
  ON public.carrier_import_records (provider);

CREATE INDEX IF NOT EXISTS carrier_import_records_external_client_idx
  ON public.carrier_import_records (external_client_id);

CREATE INDEX IF NOT EXISTS carrier_import_records_external_policy_idx
  ON public.carrier_import_records (external_policy_id);

CREATE INDEX IF NOT EXISTS carrier_import_records_external_number_idx
  ON public.carrier_import_records (external_policy_number);

ALTER TABLE public.carrier_import_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS carrier_import_records_select ON public.carrier_import_records;
CREATE POLICY carrier_import_records_select
  ON public.carrier_import_records
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

DROP POLICY IF EXISTS carrier_import_records_insert ON public.carrier_import_records;
CREATE POLICY carrier_import_records_insert
  ON public.carrier_import_records
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS carrier_import_records_update ON public.carrier_import_records;
CREATE POLICY carrier_import_records_update
  ON public.carrier_import_records
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin() )
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS carrier_import_records_delete ON public.carrier_import_records;
CREATE POLICY carrier_import_records_delete
  ON public.carrier_import_records
  FOR DELETE
  TO authenticated
  USING ( public.is_admin() );
