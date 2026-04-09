-- Renewal alerts state storage in Supabase
-- Ensures alert status is persisted in Postgres instead of Netlify Blobs

CREATE TABLE IF NOT EXISTS renewal_alerts_state (
  alert_key text,
  policy_id text REFERENCES policies(id),
  status text NOT NULL DEFAULT 'pendente',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE renewal_alerts_state
  ADD COLUMN IF NOT EXISTS alert_key text,
  ADD COLUMN IF NOT EXISTS policy_id text REFERENCES policies(id),
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE renewal_alerts_state
  ALTER COLUMN status SET DEFAULT 'pendente',
  ALTER COLUMN updated_at SET DEFAULT now();

UPDATE renewal_alerts_state
SET status = 'pendente'
WHERE status IS NULL;

UPDATE renewal_alerts_state
SET updated_at = now()
WHERE updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS renewal_alerts_state_alert_key_uniq_idx
  ON renewal_alerts_state (alert_key)
  WHERE alert_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS renewal_alerts_state_policy_id_idx
  ON renewal_alerts_state (policy_id);
