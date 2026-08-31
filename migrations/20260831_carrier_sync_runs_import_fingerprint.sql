-- =============================================================
-- Migration: carrier_sync_runs — deterministic import fingerprint
-- (CRM3 Block 3 — Manual Portfolio Import)
--
-- CONTEXT
-- migrations/20260830_crm3_identity_reconciliation.sql is ALREADY APPLIED
-- to production — this is a NEW, additive migration, not an edit of that
-- file. It adds exactly one nullable column and one partial unique index
-- to the existing carrier_sync_runs table; it does not touch any other
-- table, does not alter individual_clients/companies/policies, and does
-- not write any data.
--
-- WHY
-- The manual Excel portfolio importer (adminPreviewPortfolioImport in
-- src/lib/server-fns.ts) computes a deterministic fingerprint from
-- (provider + sanitized meaningful row content) — see
-- src/lib/carrier-import-fingerprint.ts — before creating a
-- carrier_sync_runs row, specifically so that re-uploading the exact same
-- portfolio file doesn't silently create a duplicate reconciliation run.
-- The fingerprint already encodes the provider (it is one of the hash
-- inputs), so a single global partial unique index is sufficient — no
-- need to additionally scope the index by provider.
--
-- Nullable and partial on purpose: this column only makes sense for runs
-- created by the manual importer. Nothing else that writes to
-- carrier_sync_runs (there is no other writer yet) is required to supply
-- it, and future non-file-based sync mechanisms (a real carrier API,
-- eventually) may have no meaningful "file fingerprint" of their own.
-- =============================================================

ALTER TABLE public.carrier_sync_runs
  ADD COLUMN IF NOT EXISTS import_fingerprint text NULL;

-- Deliberately NOT scoped by provider — the fingerprint itself is derived
-- from (provider + row content), so two different providers uploading
-- coincidentally identical row content would already hash differently.
CREATE UNIQUE INDEX IF NOT EXISTS carrier_sync_runs_import_fingerprint_uidx
  ON public.carrier_sync_runs (import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;
