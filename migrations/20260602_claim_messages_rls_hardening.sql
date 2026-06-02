-- =============================================================
-- Migration: claim_messages — endurecimento de RLS
--
-- CONTEXTO
-- A auditoria encontrou políticas RLS perigosas em
-- claim_messages:
--   * allow_all_select_claim_messages  (USING true)
--   * allow_all_insert_claim_messages  (WITH CHECK true)
--   * debug_select_claim_messages      (USING true, resíduo)
-- dirigidas ao role `public` (anon + authenticated). Na
-- prática, qualquer requester com a chave publishable/anon
-- (que vai no bundle do browser) podia ler TODAS as mensagens
-- de TODOS os clientes e inserir mensagens forjadas em
-- qualquer sinistro.
--
-- Existiam ainda duas políticas client_* que comparavam
-- claims.company_id com auth.uid()::text — logicamente
-- incorretas (company_id tem o formato 'comp_<ts>', nunca um
-- UUID de utilizador), pelo que concediam zero linhas. Falsa
-- sensação de segurança. Confirmado em dados: 0 de N claims
-- com company_id em formato UUID ou igual a auth.users.
--
-- CAMINHO DE ACESSO (inalterado por esta migração)
-- Todo o acesso da aplicação a claim_messages passa por
-- src/lib/data.ts com a SERVICE_ROLE key. RLS NÃO é forçada
-- (rls_forced = false), logo o service_role ignora as
-- políticas. Tanto o portal B2B (Pro) como o B2C (One) leem e
-- escrevem mensagens via server functions (service_role) — NÃO
-- consultam claim_messages diretamente pelo browser. Estas
-- políticas são, portanto, DEFENSE-IN-DEPTH: fecham o acesso
-- direto via anon/authenticated sem alterar o caminho de
-- nenhum portal. Nenhum acesso legítimo é quebrado.
--
-- ESTRUTURA / CADEIA DE ÂMBITO
-- A tabela viva claim_messages NÃO tem company_id nem
-- individual_client_id (diverge de migrações anteriores). O
-- âmbito (b2b/b2c) só é alcançável através do sinistro-pai:
--   claim_messages.claim_id (text) -> claims.id (text)
--   claims.company_id           -> is_company_member()  (B2B)
--   claims.individual_client_id -> individual_clients     (B2C)
--   admin                       -> is_admin()
-- can_access_claim() centraliza esta verificação. É
-- SECURITY DEFINER (tal como is_admin/is_company_member), pelo
-- que avalia a cadeia sem recursão de RLS sobre claims.
--
-- DECISÕES
--   * Roles restringidos a `authenticated` (anon perde acesso).
--   * Sem políticas de UPDATE/DELETE: marcar-como-lido e
--     limpezas continuam apenas por service_role.
--   * INSERT verifica o remetente: não pode forjar autor
--     (sender_user_id = auth.uid()) nem o papel (sender_type
--     coerente com is_admin()).
--   * Sem referências a 'broker' (alinhado com o enum
--     user_role = {admin, client}).
-- =============================================================

-- ── Passo 1: helper de acesso ao sinistro-pai ────────────────
-- Verdadeiro se o utilizador autenticado pode aceder ao
-- sinistro indicado: admin, OU membro da empresa dona, OU
-- cliente particular dono.
CREATE OR REPLACE FUNCTION public.can_access_claim(target_claim_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.claims c
    WHERE c.id = target_claim_id
      AND (
        public.is_admin()
        OR public.is_company_member(c.company_id)
        OR c.individual_client_id IN (
             SELECT ic.id
             FROM public.individual_clients ic
             WHERE ic.auth_user_id = auth.uid()
           )
      )
  );
$$;

-- ── Passo 2: garantir RLS ligada ─────────────────────────────
-- Já estava ligada; reafirmado para reprodutibilidade.
ALTER TABLE public.claim_messages ENABLE ROW LEVEL SECURITY;

-- ── Passo 3: remover as 5 políticas antigas ──────────────────
DROP POLICY IF EXISTS allow_all_select_claim_messages    ON public.claim_messages;
DROP POLICY IF EXISTS allow_all_insert_claim_messages    ON public.claim_messages;
DROP POLICY IF EXISTS debug_select_claim_messages        ON public.claim_messages;
DROP POLICY IF EXISTS client_can_view_own_claim_messages ON public.claim_messages;
DROP POLICY IF EXISTS client_can_insert_claim_messages   ON public.claim_messages;

-- ── Passo 4: SELECT mínimo ───────────────────────────────────
-- Lê apenas quem pode aceder ao sinistro-pai.
DROP POLICY IF EXISTS claim_messages_select ON public.claim_messages;
CREATE POLICY claim_messages_select
  ON public.claim_messages
  FOR SELECT
  TO authenticated
  USING ( public.can_access_claim(claim_id) );

-- ── Passo 5: INSERT mínimo + verificação do remetente ────────
-- Insere apenas quem pode aceder ao sinistro-pai, não pode
-- forjar o autor (sender_user_id = auth.uid()) nem o papel
-- (sender_type coerente com is_admin()).
DROP POLICY IF EXISTS claim_messages_insert ON public.claim_messages;
CREATE POLICY claim_messages_insert
  ON public.claim_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_access_claim(claim_id)
    AND sender_user_id = auth.uid()::text
    AND (
      (sender_type = 'admin'  AND public.is_admin())
      OR
      (sender_type = 'client' AND NOT public.is_admin())
    )
  );
