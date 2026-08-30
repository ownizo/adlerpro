-- =============================================================
-- Migration: fix adminPromoteToCompany data loss
--
-- CONTEXT
-- A read-only audit (CRM3 — Identity & Reconciliation, 2026-08-30)
-- found that promoting an individual_clients row to a companies row
-- (adminPromoteToCompany in src/lib/server-fns.ts) re-parented
-- policies and (partially) documents, then deleted the source
-- individual_clients row directly. Several child tables have
-- ON DELETE CASCADE to individual_clients(id):
--   claims, client_notes, client_tasks, sales_opportunities,
--   website_leads
-- None of those were re-parented first, so every claim (and its
-- claim_messages, which are reached only via claim_id — see
-- 20260602_claim_messages_rls_hardening.sql, which documents that
-- the live claim_messages table has no direct company_id/
-- individual_client_id columns of its own), note, task, opportunity
-- and website lead for that client was silently destroyed the
-- moment the DELETE succeeded. Separately, documents ended up with
-- BOTH company_id and individual_client_id populated after
-- promotion (individual_client_id was never cleared), leaving
-- ownership ambiguous.
--
-- WHAT THIS MIGRATION DOES
--   1. Extends website_leads to support company ownership (it
--      currently only supports individual_client_id NOT NULL, no
--      company_id column at all — see 20260829_website_leads.sql),
--      using the same nullable + XOR CHECK pattern already used by
--      client_notes/client_tasks/sales_opportunities. This is the
--      "preferred" option from the fix requirements: it lets a
--      promoted client's website-lead history follow the resulting
--      company instead of being deleted or orphaned.
--   2. Adds a dedicated, atomic re-parenting function,
--      promote_individual_client_to_company_relations(), that moves
--      every child record from an individual_client_id to a
--      company_id and only then deletes the individual_clients row —
--      all inside the single implicit transaction of one function
--      call, so a failure partway through rolls back everything
--      (no partial promotion). This REPLACES the ad-hoc
--      update/update/delete sequence that used to live directly in
--      the adminPromoteToCompany server function.
--
-- TYPE-AMBIGUITY NOTE (individual_client_id columns)
-- individual_clients.id is confirmed uuid (see
-- find_or_create_individual_client_by_email in
-- 20260829_website_leads.sql: RETURNS TABLE(client_id uuid, ...),
-- gen_random_uuid() default). client_notes/client_tasks/
-- sales_opportunities/website_leads all declare individual_client_id
-- as uuid explicitly. policies/claims/documents predate this
-- migrations/ folder and have NO enforced FK on individual_client_id
-- (confirmed in the same audit — "no FK constraint found at all" for
-- policies; same absence for claims/documents), so their exact
-- column type cannot be confirmed from migration history alone, and
-- this migration cannot get live schema access to verify it either.
-- Every WHERE clause below therefore compares
-- individual_client_id::text = p_client_id (p_client_id is text) —
-- valid and correct regardless of whether the underlying column is
-- uuid or text, at the cost of not using a plain index on that
-- column for this one admin-triggered, low-frequency operation.
-- company_id columns are NOT cast: companies.id is confirmed text
-- everywhere it's declared (client_notes, client_tasks,
-- sales_opportunities, and adminCreateCompany's `comp_${Date.now()}`
-- id format in src/lib/server-fns.ts).
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * Does NOT add a company_id/individual_client_id XOR CHECK to
--     documents. Unlike client_notes/client_tasks/
--     sales_opportunities/website_leads (all new tables introduced
--     with the XOR pattern from day one), documents is an older,
--     more broadly-used table and its live data has never been
--     preflighted for XOR compatibility (contrast with
--     PREFLIGHT_individual_clients_email_duplicates.sql, run before
--     that unique index was even proposed). Adding an unverified
--     CHECK constraint to a live table without that preflight step
--     risks breaking on rows this migration cannot see. The
--     re-parenting function still fixes the reported symptom (both
--     columns populated after promotion) by explicitly clearing
--     individual_client_id when company_id is set.
--   * Does NOT touch claim_messages. Per
--     20260602_claim_messages_rls_hardening.sql's own documentation,
--     the live claim_messages table has no company_id/
--     individual_client_id columns of its own — access and
--     ownership are derived entirely through claim_messages.claim_id
--     -> claims. Re-parenting the parent claim (this migration does)
--     is sufficient; there is nothing further to re-parent here.
--   * Does NOT change how a destination company is resolved
--     (existing-company-by-NIF lookup, exact match only) — that
--     logic stays in src/lib/server-fns.ts, unchanged. This
--     migration only replaces the unsafe "re-parent some things,
--     then delete" tail end of that operation.
--   * Does NOT add fuzzy matching, carrier integration, or any CRM3
--     reconciliation concept — out of scope for this bugfix.
-- =============================================================

-- ── Part 1: website_leads — support company ownership ──────────
ALTER TABLE public.website_leads
  ALTER COLUMN individual_client_id DROP NOT NULL;

ALTER TABLE public.website_leads
  ADD COLUMN IF NOT EXISTS company_id text REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.website_leads
  DROP CONSTRAINT IF EXISTS website_leads_scope_xor;

ALTER TABLE public.website_leads
  ADD CONSTRAINT website_leads_scope_xor CHECK (
    (NULLIF(company_id, '') IS NOT NULL) <> (individual_client_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS website_leads_company_id_idx
  ON public.website_leads (company_id, received_at DESC);

-- ── Part 2: atomic re-parenting + delete ────────────────────────
-- One function call = one implicit Postgres transaction: if any
-- statement below raises, every change made earlier in the same
-- call is rolled back automatically. There is no explicit
-- BEGIN/COMMIT because a single top-level function invocation
-- already gets exactly that guarantee.
--
-- Ownership rows are re-parented in a single UPDATE per table
-- (company_id set AND individual_client_id cleared together), so
-- the XOR CHECK constraints on client_notes/client_tasks/
-- sales_opportunities/website_leads only ever see the final,
-- consistent row state — never an intermediate one where both or
-- neither owner column is set.
-- Returns TABLE (one row), not a bare scalar jsonb/int, to match the
-- calling convention already proven to work through PostgREST/supabase-js
-- .rpc(...).single() in this codebase — see
-- find_or_create_individual_client_by_email above, which returns TABLE for
-- exactly the same reason.
CREATE OR REPLACE FUNCTION public.promote_individual_client_to_company_relations(
  p_client_id  text,
  p_company_id text
)
RETURNS TABLE (
  policies             integer,
  claims               integer,
  documents            integer,
  client_notes         integer,
  client_tasks         integer,
  sales_opportunities  integer,
  website_leads        integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_policies_count      integer;
  v_claims_count        integer;
  v_documents_count     integer;
  v_notes_count         integer;
  v_tasks_count         integer;
  v_opportunities_count integer;
  v_website_leads_count integer;
BEGIN
  IF p_client_id IS NULL OR btrim(p_client_id) = '' THEN
    RAISE EXCEPTION 'promote_individual_client_to_company_relations: client id vazio';
  END IF;
  IF p_company_id IS NULL OR btrim(p_company_id) = '' THEN
    RAISE EXCEPTION 'promote_individual_client_to_company_relations: company id vazio';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'promote_individual_client_to_company_relations: company % não existe', p_company_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.individual_clients WHERE id::text = p_client_id) THEN
    RAISE EXCEPTION 'promote_individual_client_to_company_relations: individual_client % não existe', p_client_id;
  END IF;

  -- Policies
  WITH moved AS (
    UPDATE public.policies
    SET company_id = p_company_id, individual_client_id = NULL
    WHERE individual_client_id::text = p_client_id
    RETURNING 1
  )
  SELECT count(*) INTO v_policies_count FROM moved;

  -- Claims (claim_messages follow automatically via claim_id -> claims;
  -- see note above — the live claim_messages table has no ownership
  -- columns of its own to re-parent)
  WITH moved AS (
    UPDATE public.claims
    SET company_id = p_company_id, individual_client_id = NULL
    WHERE individual_client_id::text = p_client_id
    RETURNING 1
  )
  SELECT count(*) INTO v_claims_count FROM moved;

  -- Documents — also fixes the "both company_id and
  -- individual_client_id populated" bug by explicitly clearing
  -- individual_client_id here (policy_id/claim_id associations on
  -- each document row are untouched, so they keep pointing at the
  -- same, now-re-parented, policy/claim).
  WITH moved AS (
    UPDATE public.documents
    SET company_id = p_company_id, individual_client_id = NULL
    WHERE individual_client_id::text = p_client_id
    RETURNING 1
  )
  SELECT count(*) INTO v_documents_count FROM moved;

  -- Client notes
  WITH moved AS (
    UPDATE public.client_notes
    SET company_id = p_company_id, individual_client_id = NULL
    WHERE individual_client_id::text = p_client_id
    RETURNING 1
  )
  SELECT count(*) INTO v_notes_count FROM moved;

  -- Client tasks (policy_id / opportunity_id columns are untouched —
  -- they already point at ids that are re-parented, not deleted, so
  -- they keep resolving correctly)
  WITH moved AS (
    UPDATE public.client_tasks
    SET company_id = p_company_id, individual_client_id = NULL
    WHERE individual_client_id::text = p_client_id
    RETURNING 1
  )
  SELECT count(*) INTO v_tasks_count FROM moved;

  -- Sales opportunities (website_lead_id column is untouched — the
  -- referenced website_leads row is re-parented below, not deleted)
  WITH moved AS (
    UPDATE public.sales_opportunities
    SET company_id = p_company_id, individual_client_id = NULL
    WHERE individual_client_id::text = p_client_id
    RETURNING 1
  )
  SELECT count(*) INTO v_opportunities_count FROM moved;

  -- Website leads
  WITH moved AS (
    UPDATE public.website_leads
    SET company_id = p_company_id, individual_client_id = NULL
    WHERE individual_client_id::text = p_client_id
    RETURNING 1
  )
  SELECT count(*) INTO v_website_leads_count FROM moved;

  -- Only after every child record above has been safely re-parented
  -- do we delete the source individual_clients row. If this DELETE
  -- (or any UPDATE above) raises, the whole function call rolls
  -- back and the individual_clients row is never touched — no
  -- partial promotion.
  DELETE FROM public.individual_clients WHERE id::text = p_client_id;

  RETURN QUERY SELECT
    v_policies_count,
    v_claims_count,
    v_documents_count,
    v_notes_count,
    v_tasks_count,
    v_opportunities_count,
    v_website_leads_count;
END;
$$;

-- Only the service role (used exclusively by src/lib/data.ts /
-- server-fns.ts) may call this — it deletes an individual_clients
-- row and must never be reachable by an authenticated B2B/B2C
-- session. Same grant pattern as
-- find_or_create_individual_client_by_email in
-- 20260829_website_leads.sql. No SECURITY DEFINER: the function runs
-- as its invoker, and the only invoker allowed to call it (service
-- role) already bypasses RLS on its own, so there is no RLS-bypass
-- exposure to control here.
REVOKE ALL ON FUNCTION public.promote_individual_client_to_company_relations(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_individual_client_to_company_relations(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_individual_client_to_company_relations(text, text) TO service_role;
