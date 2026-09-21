-- Transactional outbox: settlement persistence and notification intent commit together.
-- No historical backfill: only status transitions after this migration enqueue mail.
BEGIN;
CREATE TABLE IF NOT EXISTS public.premium_payment_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.premium_payments(id),
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  audience text NOT NULL CHECK (audience IN ('customer', 'internal')),
  payment_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  first_attempt_at timestamptz,
  delivery_payload jsonb,
  sent_at timestamptz,
  provider_id text,
  skipped_at timestamptz,
  UNIQUE (payment_id, status, audience),
  CHECK (status <> 'expired' OR audience = 'internal'),
  CHECK ((first_attempt_at IS NULL) = (delivery_payload IS NULL)),
  CHECK ((sent_at IS NULL) = (provider_id IS NULL))
);
ALTER TABLE public.premium_payment_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.premium_payment_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.premium_payment_notifications TO service_role;

CREATE OR REPLACE FUNCTION public.queue_premium_payment_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.premium_payment_notifications (payment_id, status, audience, payment_snapshot)
  SELECT NEW.id, NEW.status, audience, to_jsonb(NEW)
  FROM (VALUES ('customer'), ('internal')) AS recipients(audience)
  WHERE NEW.status <> 'expired' OR audience = 'internal'
  ON CONFLICT (payment_id, status, audience) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_premium_payment_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_premium_payment_notifications() TO service_role;
DROP TRIGGER IF EXISTS premium_payment_notifications_enqueue ON public.premium_payments;
CREATE TRIGGER premium_payment_notifications_enqueue
AFTER UPDATE OF status ON public.premium_payments
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status <> 'created')
EXECUTE FUNCTION public.queue_premium_payment_notifications();
COMMIT;
