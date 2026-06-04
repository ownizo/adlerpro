-- =============================================================
-- Migration: client_notes — notas ao nível do cliente (CRM)
--
-- CONTEXTO
-- Primeira peça da "ficha de cliente unificada" no admin. Permite
-- registar notas livres associadas a um cliente, que pode ser uma
-- EMPRESA (companies) OU um CLIENTE PARTICULAR (individual_clients).
-- Tabela nova — não altera nem migra dados existentes.
--
-- ÂMBITO "empresa OU particular"
-- Segue o padrão já auditado em claims (ver
-- 20260602_claims_scope_nullable_company_xor.sql): ambas as
-- colunas de dono são nullable e um CHECK XOR garante, ao nível
-- da BD, que EXATAMENTE uma está preenchida. NULLIF(...,'') trata
-- o sentinela '' (usado noutros pontos) como ausente.
--
-- ACESSO / RLS
-- Todo o acesso da app passa por src/lib/data.ts com a
-- SERVICE_ROLE key, que ignora RLS. As políticas abaixo são
-- DEFENSE-IN-DEPTH (a barreira efetiva é requireRoleMiddleware
-- ('admin') nas server functions). Utilizador único = admin, pelo
-- que SELECT/INSERT/UPDATE/DELETE são concedidos só a is_admin().
-- DEPENDÊNCIA: public.is_admin() já existe na BD (usada por
-- 20260602_claim_messages_rls_hardening.sql).
--
-- PRÉ-CONDIÇÕES
--   Tabela nova, sem dados — o CHECK XOR não pode falhar backfill.
-- =============================================================

-- ── Passo 1: tabela ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_notes (
  id                   uuid PRIMARY KEY,
  company_id           text REFERENCES public.companies(id) ON DELETE CASCADE,
  individual_client_id text REFERENCES public.individual_clients(id) ON DELETE CASCADE,
  body                 text NOT NULL,
  category             text,
  author_name          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_notes_scope_xor CHECK (
    (NULLIF(company_id, '') IS NOT NULL) <> (individual_client_id IS NOT NULL)
  )
);

-- ── Passo 2: índices de leitura por dono / cronologia ────────
CREATE INDEX IF NOT EXISTS client_notes_company_id_idx
  ON public.client_notes (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_notes_individual_client_id_idx
  ON public.client_notes (individual_client_id, created_at DESC);

-- ── Passo 3: RLS ligada ──────────────────────────────────────
ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;

-- ── Passo 4: políticas (só admin) ────────────────────────────
DROP POLICY IF EXISTS client_notes_select ON public.client_notes;
CREATE POLICY client_notes_select
  ON public.client_notes
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

DROP POLICY IF EXISTS client_notes_insert ON public.client_notes;
CREATE POLICY client_notes_insert
  ON public.client_notes
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS client_notes_update ON public.client_notes;
CREATE POLICY client_notes_update
  ON public.client_notes
  FOR UPDATE
  TO authenticated
  USING ( public.is_admin() )
  WITH CHECK ( public.is_admin() );

DROP POLICY IF EXISTS client_notes_delete ON public.client_notes;
CREATE POLICY client_notes_delete
  ON public.client_notes
  FOR DELETE
  TO authenticated
  USING ( public.is_admin() );
