-- =============================================================
-- Migration: sales_opportunities — pipeline comercial (CRM 2, fase 1)
--
-- CONTEXTO
-- Camada comercial BACKOFFICE ONLY sobre o CRM existente. Não altera
-- em nada os portais de cliente (Adler Pro/B2B, Os Meus Seguros/B2C
-- PT, My Cover Vault/B2C EN) — nenhuma tabela de autenticação,
-- nenhuma rota /one/*, nenhum acesso individual_client_id/
-- company_users é tocado por esta migration.
--
-- ÂMBITO "empresa OU particular"
-- Mesmo padrão XOR já auditado em claims/client_notes/client_tasks
-- (ver 20260602_claims_scope_nullable_company_xor.sql): ambas as
-- colunas de dono são nullable e um CHECK XOR garante, ao nível da
-- BD, que EXATAMENTE uma está preenchida — nunca as duas, nunca
-- nenhuma.
--
-- TIPOS DAS FKs (assimétricos, batem certo com as tabelas-alvo):
--   company_id           text -> companies.id            (text)
--   individual_client_id uuid -> individual_clients.id   (uuid)
--   website_lead_id       uuid -> website_leads.id        (uuid)
--
-- WEBSITE_LEAD -> OPPORTUNITY
-- website_lead_id é opcional (uma oportunidade pode ser criada
-- manualmente no admin, sem lead nenhum por trás) e ON DELETE SET
-- NULL: apagar um website_lead não deve levar a oportunidade
-- comercial associada consigo — ela sobrevive, só perde a ligação de
-- origem. Índice único parcial garante que um retry da mesma
-- submissão (mesmo website_lead, porque website_leads.submission_id
-- já é idempotente) nunca cria uma segunda oportunidade — ver
-- createSalesOpportunityForWebsiteLead em src/lib/data.ts.
--
-- CLIENT_TASKS.OPPORTUNITY_ID
-- Reutiliza a tabela client_tasks já existente para follow-ups de
-- oportunidades em vez de criar uma opportunity_tasks paralela (ver
-- pedido explícito). Adiciona opportunity_id nullable + amplia o
-- CHECK de source para incluir 'opportunity', preservando
-- 'manual'/'renewal' exatamente como estavam — tarefas existentes
-- continuam válidas sem qualquer alteração de dados.
--
-- RLS — BACKOFFICE ONLY
-- Sem exceções para clientes: SELECT/INSERT/UPDATE/DELETE dependem
-- só de public.is_admin(), tal como client_notes/client_tasks. Sem
-- policy baseada em individual_client_id, auth.uid() ou uma futura
-- is_company_member() — sales_opportunities nunca deve ficar legível
-- por um cliente autenticado (B2B ou B2C). O service role (usado por
-- src/lib/data.ts) ignora RLS como sempre.
--
-- UPDATED_AT
-- Sem trigger genérico de updated_at neste projeto (confirmado —
-- renewal_alerts_state.updated_at é escrito pela aplicação, não por
-- trigger). Seguido o mesmo padrão aqui: updated_at é escrito pelo
-- data layer (updateSalesOpportunity/updateSalesOpportunityStage),
-- não por trigger de BD.
--
-- PRÉ-CONDIÇÕES
--   Tabela nova, sem dados. client_tasks já existe e já tem dados —
--   o ALTER TABLE abaixo é aditivo (coluna nullable, novo CHECK
--   compatível com os valores já existentes) e não migra nada.
-- =============================================================

-- ── Passo 1: tabela ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_opportunities (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                text        REFERENCES public.companies(id) ON DELETE CASCADE,
  individual_client_id      uuid        REFERENCES public.individual_clients(id) ON DELETE CASCADE,
  website_lead_id           uuid        REFERENCES public.website_leads(id) ON DELETE SET NULL,

  title                     text        NOT NULL,
  market                    text,
  product                   text,

  stage                     text        NOT NULL DEFAULT 'new'
                              CHECK (stage IN ('new', 'contacted', 'needs_analysis', 'quoted', 'negotiation', 'won', 'lost')),

  -- Taxonomia de origem comercial — distinta de market (país) e de UTM
  -- (que fica em website_leads). Ver comentário em
  -- src/lib/sales-opportunity-rules.ts SOURCE_LABELS.
  source                    text        CHECK (source IS NULL OR source IN (
                                'website', 'referral', 'phone', 'email', 'whatsapp',
                                'google', 'meta', 'partner', 'existing_client', 'manual', 'other'
                              )),
  source_detail             text,

  estimated_annual_premium  numeric,
  estimated_revenue         numeric,
  currency                  text        NOT NULL DEFAULT 'EUR',

  -- Texto livre (email do comercial), não uma FK — mesmo padrão de
  -- renewal_alerts_state.assigned_to. Não criar tabela de utilizadores
  -- comerciais nem FK para auth.users nesta fase.
  assigned_to               text,

  expected_close_date       date,
  next_follow_up_at         timestamptz,

  lost_reason               text,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  closed_at                 timestamptz,

  CONSTRAINT sales_opportunities_scope_xor CHECK (
    (NULLIF(company_id, '') IS NOT NULL) <> (individual_client_id IS NOT NULL)
  )
);

-- ── Passo 2: índices ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS sales_opportunities_company_id_idx
  ON public.sales_opportunities (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_opportunities_individual_client_id_idx
  ON public.sales_opportunities (individual_client_id, created_at DESC);

-- Kanban/list view agrupam e filtram por stage constantemente.
CREATE INDEX IF NOT EXISTS sales_opportunities_stage_idx
  ON public.sales_opportunities (stage, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_opportunities_assigned_to_idx
  ON public.sales_opportunities (assigned_to) WHERE assigned_to IS NOT NULL;

-- Idempotência: mesmo website_lead nunca gera duas oportunidades
-- (retry da mesma submissão já não passa daqui, mas fica a garantia
-- ao nível da BD também). Parcial porque website_lead_id pode ser
-- NULL (oportunidade criada manualmente, sem lead nenhum por trás).
CREATE UNIQUE INDEX IF NOT EXISTS sales_opportunities_website_lead_id_uidx
  ON public.sales_opportunities (website_lead_id) WHERE website_lead_id IS NOT NULL;

-- ── Passo 3: RLS ligada ──────────────────────────────────────
ALTER TABLE public.sales_opportunities ENABLE ROW LEVEL SECURITY;

-- ── Passo 4: políticas — admin only, sem exceção nenhuma para
-- clientes (nem individual_client_id, nem auth.uid(), nem uma futura
-- is_company_member()). Ver nota RLS no topo do ficheiro. ──────────
DROP POLICY IF EXISTS sales_opportunities_select ON public.sales_opportunities;
CREATE POLICY sales_opportunities_select
  ON public.sales_opportunities
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

DROP POLICY IF EXISTS sales_opportunities_insert ON public.sales_opportunities;
CREATE POLICY sales_opportunities_insert
  ON public.sales_opportunities
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS sales_opportunities_update ON public.sales_opportunities;
CREATE POLICY sales_opportunities_update
  ON public.sales_opportunities
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin() )
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS sales_opportunities_delete ON public.sales_opportunities;
CREATE POLICY sales_opportunities_delete
  ON public.sales_opportunities
  FOR DELETE
  TO authenticated
  USING ( public.is_admin() );

-- ── Passo 5: client_tasks — ligação a oportunidades ─────────────
-- Aditivo: coluna nova nullable, sem valor por omissão diferente de
-- NULL, não migra nem toca em nenhuma linha existente.
ALTER TABLE public.client_tasks
  ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES public.sales_opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS client_tasks_opportunity_id_idx
  ON public.client_tasks (opportunity_id) WHERE opportunity_id IS NOT NULL;

-- Amplia o CHECK de source ('manual','renewal') para incluir
-- 'opportunity', sem quebrar as tarefas existentes (que só usam os
-- dois valores originais). O nome da constraint gerada
-- automaticamente pelo Postgres para um CHECK de coluna inline nunca
-- foi fixado explicitamente em 20260605_client_tasks.sql, por isso
-- este bloco encontra-a por inspeção em vez de assumir um nome —
-- seguro mesmo que o nome real não seja o convencional
-- "client_tasks_source_check".
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT pgc.conname
    FROM pg_constraint pgc
    JOIN pg_class rel ON rel.oid = pgc.conrelid
    WHERE rel.relname = 'client_tasks'
      AND pgc.contype = 'c'
      AND pg_get_constraintdef(pgc.oid) ILIKE '%source%IN%'
  LOOP
    EXECUTE format('ALTER TABLE public.client_tasks DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE public.client_tasks
  ADD CONSTRAINT client_tasks_source_check CHECK (source IN ('manual', 'renewal', 'opportunity'));
