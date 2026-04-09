-- Enterprise admin controls: policy roles, soft delete and audit trail

ALTER TABLE policies
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS policies_deleted_at_idx
  ON policies (deleted_at);

ALTER TABLE policy_users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'viewer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'policy_users_role_check'
  ) THEN
    ALTER TABLE policy_users
      ADD CONSTRAINT policy_users_role_check
      CHECK (role IN ('owner', 'editor', 'viewer'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS policy_users_policy_role_idx
  ON policy_users (policy_id, role);

CREATE TABLE IF NOT EXISTS policy_audit_trail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id text NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT policy_audit_trail_action_check
    CHECK (action IN ('create', 'update', 'delete', 'share', 'upload'))
);

CREATE INDEX IF NOT EXISTS policy_audit_trail_policy_id_timestamp_idx
  ON policy_audit_trail (policy_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS policy_audit_trail_action_idx
  ON policy_audit_trail (action);
