-- Insurance premium attempts for Stripe-hosted Checkout (not invoices/revenue).
-- A reservation exists before Stripe creation, so early webhooks and retries can
-- reconcile the same attempt. Nullable Stripe identifiers are filled afterwards.
-- Execute in the target Supabase database before enabling this feature.
BEGIN;

CREATE TABLE public.premium_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL UNIQUE,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  checkout_url text,
  customer_name text NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 200),
  customer_email text NOT NULL CHECK (length(customer_email) BETWEEN 1 AND 254),
  amount_cents integer NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 99999999),
  currency text NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
  insurer text NOT NULL CHECK (length(insurer) BETWEEN 1 AND 500),
  policy_reference text NOT NULL CHECK (length(policy_reference) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'pending', 'paid', 'failed', 'expired')),
  livemode boolean NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  CONSTRAINT premium_payments_paid_timestamp CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

CREATE INDEX premium_payments_created_by_idx ON public.premium_payments(created_by);

-- All access is server-side: existing admin middleware or a verified Stripe
-- webhook. No direct browser access, even with a valid authenticated JWT.
ALTER TABLE public.premium_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.premium_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.premium_payments TO service_role;

COMMENT ON COLUMN public.premium_payments.version IS 'Compare-and-swap version for concurrent webhook and admin status refreshes';
COMMENT ON COLUMN public.premium_payments.paid_at IS 'Time the server first verified settlement with Stripe, not the success redirect time';
COMMIT;
