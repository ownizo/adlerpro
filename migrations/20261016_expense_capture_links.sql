-- Phone capture links for company expenses: a secret link (sent by WhatsApp)
-- opens a camera page that uploads invoices without logging in. Only the
-- SHA-256 hash of the token is stored; links can expire and be revoked.
BEGIN;

CREATE TABLE public.expense_capture_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  phone text CHECK (phone IS NULL OR length(phone) <= 30),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  uploads_count integer NOT NULL DEFAULT 0 CHECK (uploads_count >= 0)
);

CREATE INDEX expense_capture_links_created_by_idx ON public.expense_capture_links(created_by);

ALTER TABLE public.expense_capture_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.expense_capture_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_capture_links TO service_role;

ALTER TABLE public.company_expenses
  ADD COLUMN source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'capture')),
  ADD COLUMN capture_link_id uuid REFERENCES public.expense_capture_links(id) ON DELETE SET NULL;

CREATE INDEX company_expenses_capture_link_idx ON public.company_expenses(capture_link_id, created_at DESC);

COMMENT ON TABLE public.expense_capture_links IS 'Secret phone links for photographing expense invoices (token stored hashed)';
COMMIT;
