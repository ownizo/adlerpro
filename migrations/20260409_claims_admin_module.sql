-- Adler Pro Admin Claims Module
-- Add admin-only claim management persistence structures

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS assigned_to text;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS claim_id text REFERENCES claims(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS claim_internal_notes (
  id text PRIMARY KEY,
  claim_id text NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_claim_internal_notes_claim_id
  ON claim_internal_notes (claim_id, created_at DESC);

CREATE TABLE IF NOT EXISTS claim_timeline_events (
  id text PRIMARY KEY,
  claim_id text NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  details text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb
);

CREATE INDEX IF NOT EXISTS idx_claim_timeline_events_claim_id
  ON claim_timeline_events (claim_id, created_at DESC);
