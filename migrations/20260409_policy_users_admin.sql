-- Policy sharing many-to-many between policies and company users

CREATE TABLE IF NOT EXISTS policy_users (
  policy_id text NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES company_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, user_id)
);

CREATE INDEX IF NOT EXISTS policy_users_user_id_idx ON policy_users (user_id);
CREATE INDEX IF NOT EXISTS policy_users_policy_id_idx ON policy_users (policy_id);

-- Ensure direct policy-document relationship exists and is indexed for large lists
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS policy_id text REFERENCES policies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_policy_id_idx ON documents (policy_id);
