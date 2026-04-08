-- Adler Pro · Dia 2 migrations
-- Correr no Supabase SQL Editor

ALTER TABLE policies ADD COLUMN IF NOT EXISTS renewal_date       date;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS payment_frequency  text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS visible_portal     boolean DEFAULT true;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS notes_internal     text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS emergency_contacts text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS commission_percentage numeric;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS commission_value      numeric;

ALTER TABLE individual_clients ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS policy_id text REFERENCES policies(id);
