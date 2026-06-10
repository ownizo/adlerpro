-- =============================================================
-- Migration: marketing — módulo de envio massivo de emails
--
-- CONTEXTO
-- Novo módulo "Marketing" no admin para envio de campanhas de email
-- via Resend a clientes do sistema (empresas e/ou clientes particulares).
--
-- TABELAS NOVAS
--   marketing_campaigns — cabeçalho de cada campanha (rascunho → enviado)
--   marketing_sends     — registo por-destinatário de cada campanha
--
-- ALTERAÇÕES A TABELAS EXISTENTES
--   companies.marketing_opt_out          — opt-out de marketing por empresa
--   individual_clients.marketing_opt_out — opt-out de marketing por cliente particular
--
-- ACESSO / RLS
-- Segue o padrão de client_notes/client_tasks: service_role ignora RLS;
-- políticas são DEFENSE-IN-DEPTH guardadas por is_admin(). Acesso
-- exclusivamente por admin.
-- DEPENDÊNCIA: public.is_admin() já existe na BD.
--
-- FK auth.users
-- created_by usa ON DELETE SET NULL — padrão estabelecido em
-- 20260609_auth_user_fk_set_null.sql: ao apagar um admin user, o
-- carimpo de autor limpa-se sem bloquear nem eliminar a campanha.
-- =============================================================


-- ── Passo 1: tabela marketing_campaigns ──────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text        NOT NULL,
  subject           text        NOT NULL,
  template_key      text        NOT NULL
                                  CHECK (template_key IN ('feedback', 'renewal', 'presentation', 'seasonal')),
  audience          text        NOT NULL
                                  CHECK (audience IN ('companies', 'company_users', 'individual_clients', 'all')),
  template_vars     jsonb,
  status            text        NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'sending', 'sent', 'cancelled')),
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  total_recipients  int,
  total_sent        int,
  total_errors      int
);


-- ── Passo 2: tabela marketing_sends ──────────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_sends (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      uuid        NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  recipient_email  text        NOT NULL,
  recipient_name   text,
  recipient_type   text
                                 CHECK (recipient_type IN ('company', 'company_user', 'individual_client')),
  recipient_ref_id text,
  status           text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'sent', 'error', 'skipped')),
  resend_id        text,
  error_message    text,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Índice principal: listar/agregar sends por campanha
CREATE INDEX IF NOT EXISTS marketing_sends_campaign_id_idx
  ON public.marketing_sends (campaign_id);


-- ── Passo 3: opt-out nas tabelas existentes ───────────────────

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS marketing_opt_out boolean NOT NULL DEFAULT false;

ALTER TABLE public.individual_clients
  ADD COLUMN IF NOT EXISTS marketing_opt_out boolean NOT NULL DEFAULT false;


-- ── Passo 4: RLS em marketing_campaigns ──────────────────────

ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_campaigns_select ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_select
  ON public.marketing_campaigns
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

DROP POLICY IF EXISTS marketing_campaigns_insert ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_insert
  ON public.marketing_campaigns
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS marketing_campaigns_update ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_update
  ON public.marketing_campaigns
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin() )
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS marketing_campaigns_delete ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_delete
  ON public.marketing_campaigns
  FOR DELETE
  TO authenticated
  USING ( public.is_admin() );


-- ── Passo 5: RLS em marketing_sends ──────────────────────────

ALTER TABLE public.marketing_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_sends_select ON public.marketing_sends;
CREATE POLICY marketing_sends_select
  ON public.marketing_sends
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

DROP POLICY IF EXISTS marketing_sends_insert ON public.marketing_sends;
CREATE POLICY marketing_sends_insert
  ON public.marketing_sends
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS marketing_sends_update ON public.marketing_sends;
CREATE POLICY marketing_sends_update
  ON public.marketing_sends
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin() )
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS marketing_sends_delete ON public.marketing_sends;
CREATE POLICY marketing_sends_delete
  ON public.marketing_sends
  FOR DELETE
  TO authenticated
  USING ( public.is_admin() );
