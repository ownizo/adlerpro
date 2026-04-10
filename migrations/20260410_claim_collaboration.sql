-- Claim collaboration: continuous edit, files, and bidirectional ticket messages

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS claim_id text REFERENCES claims(id),
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS uploaded_by_type text;

CREATE INDEX IF NOT EXISTS documents_claim_id_idx
  ON documents (claim_id);

CREATE TABLE IF NOT EXISTS claim_messages (
  id uuid PRIMARY KEY,
  claim_id text NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('admin', 'client')),
  sender_name text NOT NULL,
  sender_user_id text,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS claim_messages_claim_id_idx
  ON claim_messages (claim_id, created_at ASC);

CREATE INDEX IF NOT EXISTS claim_messages_company_id_idx
  ON claim_messages (company_id);

CREATE INDEX IF NOT EXISTS claim_messages_unread_admin_idx
  ON claim_messages (claim_id, company_id)
  WHERE sender_type = 'admin' AND read_at IS NULL;
