-- Migration: user_terms_acceptance
-- Regista a aceitação dos Termos & Condições por cada utilizador no momento do registo.
-- Executar no Supabase SQL Editor ou via CLI: supabase db push

CREATE TABLE IF NOT EXISTS public.user_terms_acceptance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version   TEXT NOT NULL,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address      TEXT,
  user_agent      TEXT
);

-- Índice para pesquisas por utilizador
CREATE INDEX IF NOT EXISTS idx_user_terms_acceptance_user_id
  ON public.user_terms_acceptance (user_id);

-- RLS: utilizadores só lêem os seus próprios registos; escrita apenas via service_role
ALTER TABLE public.user_terms_acceptance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Utilizador lê os seus próprios registos de aceitação"
  ON public.user_terms_acceptance
  FOR SELECT
  USING (auth.uid() = user_id);

-- Sem política de INSERT para o anon/authenticated role:
-- a inserção é feita exclusivamente pelo service_role (Netlify function).

COMMENT ON TABLE public.user_terms_acceptance IS
  'Auditoria de aceitação de Termos & Condições: um registo por versão aceite por utilizador.';
COMMENT ON COLUMN public.user_terms_acceptance.terms_version IS
  'Versão dos Termos aceite, ex: "2025-01". Actualizar TERMS_VERSION no código ao publicar novos termos.';
COMMENT ON COLUMN public.user_terms_acceptance.accepted_at IS
  'Timestamp UTC exacto da aceitação.';
