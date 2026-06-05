-- =============================================================
-- Migration: client_tasks — tarefas/follow-ups ao nível do cliente (CRM)
--
-- CONTEXTO
-- Segunda peça da "ficha de cliente unificada" no admin. Permite
-- registar tarefas com prazo associadas a um cliente, que pode ser
-- uma EMPRESA (companies) OU um CLIENTE PARTICULAR (individual_clients).
-- Tabela nova — não altera nem migra dados existentes.
--
-- ÂMBITO "empresa OU particular"
-- Segue o padrão de client_notes (ver 20260604_client_notes.sql):
-- ambas as colunas de dono são nullable e um CHECK XOR garante, ao
-- nível da BD, que EXATAMENTE uma está preenchida.
--
-- TIPOS DAS FKs (assimétricos, batem certo com as tabelas-alvo):
--   company_id           text -> companies.id            (text)
--   individual_client_id uuid -> individual_clients.id   (uuid)
-- O XOR usa NULLIF(company_id,'') para tratar '' como ausente em
-- text; individual_client_id (uuid) basta IS NOT NULL.
--
-- CAMPO "ATRASADA"
-- Não existe coluna extra: deriva-se em runtime por
--   due_date < CURRENT_DATE AND status = 'pending'
--
-- ORIGEM (source / policy_id)
-- Campos presentes mas sem lógica ativa. Preparação para a fatia 4
-- (renovações automáticas de apólices): source='renewal' e
-- policy_id preenchido. Hoje só se usa source='manual'.
--
-- ACESSO / RLS
-- Segue client_notes: SERVICE_ROLE key ignora RLS; políticas são
-- DEFENSE-IN-DEPTH guardadas por is_admin(). Utilizador único = admin.
-- DEPENDÊNCIA: public.is_admin() já existe na BD.
--
-- PRÉ-CONDIÇÕES
--   Tabela nova, sem dados — o CHECK XOR não pode falhar backfill.
-- =============================================================

-- ── Passo 1: tabela ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_tasks (
  id                   uuid PRIMARY KEY,
  company_id           text REFERENCES public.companies(id) ON DELETE CASCADE,
  individual_client_id uuid REFERENCES public.individual_clients(id) ON DELETE CASCADE,
  title                text NOT NULL,
  description          text,
  due_date             date NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'done')),
  done_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  source               text NOT NULL DEFAULT 'manual'
                         CHECK (source IN ('manual', 'renewal')),
  policy_id            text REFERENCES public.policies(id) ON DELETE SET NULL,
  CONSTRAINT client_tasks_scope_xor CHECK (
    (NULLIF(company_id, '') IS NOT NULL) <> (individual_client_id IS NOT NULL)
  )
);

-- ── Passo 2: índices ─────────────────────────────────────────
-- Por dono, ordenados por prazo (uso principal: ficha de cliente)
CREATE INDEX IF NOT EXISTS client_tasks_company_id_idx
  ON public.client_tasks (company_id, due_date ASC);

CREATE INDEX IF NOT EXISTS client_tasks_individual_client_id_idx
  ON public.client_tasks (individual_client_id, due_date ASC);

-- Para o painel central: todas as tarefas por prazo, filtráveis por status
CREATE INDEX IF NOT EXISTS client_tasks_due_date_status_idx
  ON public.client_tasks (due_date ASC, status);

-- Para a fatia 4: tarefas geradas por uma apólice
CREATE INDEX IF NOT EXISTS client_tasks_policy_id_idx
  ON public.client_tasks (policy_id);

-- ── Passo 3: RLS ligada ──────────────────────────────────────
ALTER TABLE public.client_tasks ENABLE ROW LEVEL SECURITY;

-- ── Passo 4: políticas (só admin) ────────────────────────────
DROP POLICY IF EXISTS client_tasks_select ON public.client_tasks;
CREATE POLICY client_tasks_select
  ON public.client_tasks
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

DROP POLICY IF EXISTS client_tasks_insert ON public.client_tasks;
CREATE POLICY client_tasks_insert
  ON public.client_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS client_tasks_update ON public.client_tasks;
CREATE POLICY client_tasks_update
  ON public.client_tasks
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin() )
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS client_tasks_delete ON public.client_tasks;
CREATE POLICY client_tasks_delete
  ON public.client_tasks
  FOR DELETE
  TO authenticated
  USING ( public.is_admin() );
