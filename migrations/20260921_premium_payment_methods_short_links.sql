-- Additive only: preserve table data, constraints, grants, and RLS.
BEGIN;
ALTER TABLE public.premium_payments
  ADD COLUMN IF NOT EXISTS payment_methods text[] NOT NULL
    DEFAULT ARRAY['card', 'mb_way', 'revolut_pay', 'customer_balance', 'sepa_debit']::text[],
  -- Base64url of 12 random UUID bytes: 90 random bits after UUID version/variant bits.
  -- Uses core PostgreSQL functions; no extension or public callable function needed.
  ADD COLUMN IF NOT EXISTS short_code text NOT NULL
    DEFAULT translate(encode(substring(uuid_send(gen_random_uuid()) from 1 for 12), 'base64'), '+/', '-_');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.premium_payments'::regclass AND conname = 'premium_payments_payment_methods_check') THEN
    ALTER TABLE public.premium_payments ADD CONSTRAINT premium_payments_payment_methods_check CHECK (
      cardinality(payment_methods) > 0 AND array_ndims(payment_methods) = 1
      AND array_position(payment_methods, NULL) IS NULL
      AND payment_methods <@ ARRAY['card', 'mb_way', 'revolut_pay', 'customer_balance', 'sepa_debit']::text[]
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.premium_payments'::regclass AND conname = 'premium_payments_short_code_key') THEN
    ALTER TABLE public.premium_payments ADD CONSTRAINT premium_payments_short_code_key UNIQUE (short_code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.premium_payments'::regclass AND conname = 'premium_payments_short_code_check') THEN
    ALTER TABLE public.premium_payments ADD CONSTRAINT premium_payments_short_code_check CHECK (short_code ~ '^[A-Za-z0-9_-]{16}$');
  END IF;
END $$;
COMMIT;
