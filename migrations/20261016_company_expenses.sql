-- Company expenses (despesas da empresa): invoice/receipt archive with AI extraction.
-- Each expense keeps the original file (photo or PDF) in the private `expenses`
-- bucket and the extracted/confirmed invoice data in this table.
-- Categories follow the SNC chart of accounts (class 62 FSE + 43 equipment).
BEGIN;

CREATE TABLE public.company_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'review', 'confirmed', 'failed')),

  -- Invoice data (AI-extracted, then reviewed)
  supplier_name text CHECK (supplier_name IS NULL OR length(supplier_name) <= 300),
  supplier_nif text CHECK (supplier_nif IS NULL OR length(supplier_nif) <= 30),
  buyer_nif text CHECK (buyer_nif IS NULL OR length(buyer_nif) <= 30),
  document_type text CHECK (document_type IS NULL OR length(document_type) <= 60),
  invoice_number text CHECK (invoice_number IS NULL OR length(invoice_number) <= 120),
  atcud text CHECK (atcud IS NULL OR length(atcud) <= 120),
  invoice_date date,
  due_date date,
  reference_month date CHECK (reference_month IS NULL OR extract(day FROM reference_month) = 1),
  category text NOT NULL DEFAULT 'outros',
  description text CHECK (description IS NULL OR length(description) <= 2000),
  currency text NOT NULL DEFAULT 'EUR' CHECK (length(currency) = 3),
  net_amount numeric(12,2),
  vat_amount numeric(12,2),
  total_amount numeric(12,2),
  vat_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_method text CHECK (payment_method IS NULL OR length(payment_method) <= 60),
  notes text CHECK (notes IS NULL OR length(notes) <= 4000),

  -- Original document
  file_path text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  file_mime text NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 20971520),

  -- AI audit trail
  ai_extracted jsonb,
  ai_model text,
  ai_error text,
  extracted_at timestamptz,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE INDEX company_expenses_reference_month_idx ON public.company_expenses(reference_month DESC);
CREATE INDEX company_expenses_category_idx ON public.company_expenses(category);
CREATE INDEX company_expenses_created_by_idx ON public.company_expenses(created_by);

-- Server-side only (admin middleware with the service role). No browser access.
ALTER TABLE public.company_expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_expenses FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_expenses TO service_role;

-- Private bucket for the original invoices. Uploads use server-issued signed
-- upload URLs; reads use short-lived signed URLs. No storage policies are
-- granted to anon/authenticated.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('expenses', 'expenses', false, 20971520,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.company_expenses IS 'Company expense invoices (despesas). Original file in storage bucket "expenses".';
COMMENT ON COLUMN public.company_expenses.reference_month IS 'First day of the accounting month the expense belongs to';
COMMENT ON COLUMN public.company_expenses.category IS 'Expense category key (see src/lib/expense-categories.ts), mapped to SNC accounts';
COMMENT ON COLUMN public.company_expenses.vat_lines IS 'VAT breakdown: [{rate, base, vat}]';
COMMIT;
