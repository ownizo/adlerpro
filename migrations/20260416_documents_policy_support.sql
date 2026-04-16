-- Add missing columns to documents table for policy/claim association
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS policy_id uuid REFERENCES policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claim_id uuid REFERENCES claims(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS uploaded_by_type text DEFAULT 'admin';

CREATE INDEX IF NOT EXISTS documents_policy_id_idx ON documents (policy_id);
CREATE INDEX IF NOT EXISTS documents_claim_id_idx ON documents (claim_id);
