-- Prevent new duplicate active claims for the same policy and speed up policy-based lookup.

CREATE INDEX IF NOT EXISTS claims_policy_id_created_at_idx
  ON claims (policy_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_duplicate_active_claims_for_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.policy_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('paid', 'denied') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM claims
    WHERE policy_id = NEW.policy_id
      AND id <> COALESCE(NEW.id, '')
      AND status NOT IN ('paid', 'denied')
  ) THEN
    RAISE EXCEPTION 'Active claim already exists for policy_id=%', NEW.policy_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS claims_prevent_duplicate_active_by_policy ON claims;

CREATE TRIGGER claims_prevent_duplicate_active_by_policy
BEFORE INSERT OR UPDATE ON claims
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_active_claims_for_policy();
