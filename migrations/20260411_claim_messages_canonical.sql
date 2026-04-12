-- Promote claim_messages to the canonical store for visible claim messages
-- across Admin, Pro and One.

ALTER TABLE claim_messages
  ALTER COLUMN company_id DROP NOT NULL;

ALTER TABLE claim_messages
  ADD COLUMN IF NOT EXISTS individual_client_id text REFERENCES individual_clients(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS claim_messages_individual_client_id_idx
  ON claim_messages (individual_client_id);

ALTER TABLE claim_messages
  DROP CONSTRAINT IF EXISTS claim_messages_scope_check;

ALTER TABLE claim_messages
  ADD CONSTRAINT claim_messages_scope_check
  CHECK (
    company_id IS NOT NULL
    OR individual_client_id IS NOT NULL
  );
