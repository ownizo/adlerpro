-- =============================================================
-- Migration: website_leads — histórico de pedidos vindos do site
-- público (adlerrochefort.com) para clientes particulares.
--
-- CONTEXTO
-- Primeira peça da integração "Netlify Forms → CRM": cada submissão
-- de um formulário de PESSOA SINGULAR em adlerrochefort.com passa a
-- gerar uma linha aqui, associada a um individual_clients já
-- existente ou recém-criado. Tabela nova — não altera nem migra
-- dados existentes.
--
-- REGRA CENTRAL (ver src/lib/data.ts: findOrCreateIndividualClientByEmail)
--   1 pessoa (email normalizado)  = 1 individual_client
--   N submissões dessa pessoa     = N website_leads
-- Nunca é criado um segundo individual_client só porque a mesma
-- pessoa pediu outro seguro — ver a função find_or_create abaixo.
--
-- PRIVACIDADE
-- Esta tabela NÃO é um despejo do formulário. O intake endpoint
-- (netlify/api-functions/lead-intake.mts, no repo adlerpro) só
-- persiste os campos identificados na allowlist do payload — nome,
-- email, telefone, form/market/product/source/UTM e um `metadata`
-- opcional e deliberadamente minúsculo. Dados de saúde, datas de
-- nascimento, documentos de identificação, moradas, etc. nunca
-- chegam a este endpoint (são filtrados no repo adlerrochefort,
-- antes do pedido HTTP) e portanto nunca chegam a esta tabela.
--
-- ÂMBITO: só PESSOAS SINGULARES
-- Diferente de client_notes/client_tasks (que servem companies OU
-- individual_clients), website_leads serve exclusivamente
-- individual_clients — leads de formulários empresariais/condomínio
-- não passam pelo intake endpoint (ver classificação em
-- adlerrochefort/netlify/functions/lib/lead-classification.mjs) e
-- portanto nunca geram linha aqui. Por isso individual_client_id é
-- NOT NULL e não há XOR como nas outras tabelas.
--
-- IDEMPOTÊNCIA (submission_id)
-- Netlify Forms atribui um id UUID a cada submissão, disponível no
-- payload do evento `submission-created` como `payload.id`. Usamo-lo
-- como chave de idempotência: um índice único parcial (ignorando
-- NULL) garante que reprocessar a mesma submissão nunca duplica a
-- linha, mesmo com retries futuros. Ver comentário em
-- submission-created.mjs (repo adlerrochefort) sobre o fallback para
-- quando, por algum motivo, um id não estiver disponível.
--
-- FOREIGN KEY / ON DELETE
-- individual_client_id -> individual_clients.id ON DELETE CASCADE,
-- pelo mesmo motivo de client_notes/client_tasks: eliminar um cliente
-- particular no admin é uma ação explícita e deliberada (ver
-- deleteIndividualClientRelations em src/lib/data.ts); o histórico de
-- pedidos desse cliente deixa de fazer sentido sozinho e CASCADE
-- evita ficar órfão.
--
-- CONCORRÊNCIA EM individual_clients.email
-- Não existe (ainda) uma constraint UNIQUE sobre
-- individual_clients.email — a tabela é anterior a esta migration e
-- pode conter duplicados históricos que esta migration não pode
-- assumir como inexistentes (ver migrations/PREFLIGHT_*.sql). A
-- proteção contra duas submissões concorrentes com o mesmo email é
-- feita ao nível da função find_or_create_individual_client_by_email
-- abaixo, via pg_advisory_xact_lock: a função corre inteira numa
-- única transação no Postgres, pelo que o lock é efetivo mesmo
-- chamando-a via PostgREST/RPC (ao contrário de um lock de sessão,
-- que não sobreviveria a chamadas HTTP separadas). Isto substitui,
-- por agora, uma UNIQUE constraint — ver
-- migrations/20260829_individual_clients_email_unique_OPTIONAL_run_after_preflight.sql
-- para o passo seguinte, condicional ao preflight.
--
-- ACESSO / RLS
-- Segue client_notes/client_tasks: SERVICE_ROLE key (usada por
-- src/lib/data.ts e pelo intake endpoint) ignora RLS. As políticas
-- abaixo são DEFENSE-IN-DEPTH guardadas por is_admin(). Não há
-- acesso público direto à tabela — a única porta de entrada pública
-- é o endpoint server-to-server com o seu próprio segredo
-- (LEAD_INTAKE_SECRET), que usa a service role internamente.
-- DEPENDÊNCIA: public.is_admin() já existe na BD.
--
-- PRÉ-CONDIÇÕES
--   Tabela nova, sem dados.
-- =============================================================

-- ── Passo 1: tabela ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.website_leads (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  individual_client_id  uuid        NOT NULL REFERENCES public.individual_clients(id) ON DELETE CASCADE,
  submission_id         text,
  form_name             text        NOT NULL,
  market                text,
  product               text,
  source                text,
  source_url            text,
  utm_source            text,
  utm_medium            text,
  utm_campaign          text,
  utm_content           text,
  utm_term              text,
  -- Contexto comercial não sensível e deliberadamente pequeno (ex.: o
  -- ramo escolhido num formulário partilhado, a língua da página).
  -- NUNCA dados de saúde, datas de nascimento ou documentos de
  -- identificação — ver nota de privacidade no topo do ficheiro.
  metadata              jsonb,
  -- received_at: definido pelo intake endpoint como "quando o CRM recebeu
  -- este pedido" (não vem do formulário). created_at: timestamp de inserção
  -- na BD. Coincidem na prática (o endpoint corre perto de real-time), mas
  -- ficam colunas distintas para permitir, mais tarde, passar o
  -- payload.created_at real do Netlify Forms como received_at sem alterar o
  -- schema.
  received_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ── Passo 2: índices ─────────────────────────────────────────
-- Leitura por cliente, cronológica — usado na ficha do cliente
-- ("Pedidos do Website" no admin).
CREATE INDEX IF NOT EXISTS website_leads_individual_client_id_idx
  ON public.website_leads (individual_client_id, received_at DESC);

-- Idempotência: mesma submissão nunca gera duas linhas. Parcial
-- porque submission_id pode ser NULL (ver nota "IDEMPOTÊNCIA" acima).
CREATE UNIQUE INDEX IF NOT EXISTS website_leads_submission_id_uidx
  ON public.website_leads (submission_id) WHERE submission_id IS NOT NULL;

-- ── Passo 3: RLS ligada ──────────────────────────────────────
ALTER TABLE public.website_leads ENABLE ROW LEVEL SECURITY;

-- ── Passo 4: políticas (só admin; sem INSERT/UPDATE/DELETE por
-- utilizador autenticado — a escrita é exclusivamente via service
-- role, a partir do intake endpoint e da app admin) ─────────────
DROP POLICY IF EXISTS website_leads_select ON public.website_leads;
CREATE POLICY website_leads_select
  ON public.website_leads
  FOR SELECT
  TO authenticated
  USING ( public.is_admin() );

-- ── Passo 5: find-or-create de individual_client por email ──────
-- Race-safe mesmo sem UNIQUE constraint em individual_clients.email:
-- toda a função corre numa única transação, pelo que
-- pg_advisory_xact_lock serializa efetivamente chamadas concorrentes
-- com o mesmo email normalizado. O lock liberta-se sozinho no fim da
-- transação (xact-level).
--
-- Recebe o email JÁ NORMALIZADO (trim + lowercase — ver
-- src/lib/email.ts normalizeEmail) para que a única fonte da regra de
-- normalização seja o código TypeScript; a função ainda normaliza
-- defensivamente antes de comparar/gravar.
--
-- Comportamento (ver requisito "1 pessoa = 1 individual_client"):
--   existe individual_client com esse email  -> devolve-o, created=false
--   não existe                                -> cria-o, created=true
-- Nunca atualiza dados de um cliente existente (nome/telefone) —
-- evita que um intake automático sobreponha edições manuais no CRM.
-- Se já existirem duplicados históricos para o mesmo email, escolhe
-- deterministicamente o mais antigo (created_at ASC) em vez de um
-- registo aleatório; nunca faz merge automático.
CREATE OR REPLACE FUNCTION public.find_or_create_individual_client_by_email(
  p_email     text,
  p_full_name text,
  p_phone     text DEFAULT NULL
)
RETURNS TABLE (client_id uuid, created boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_id    uuid;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'find_or_create_individual_client_by_email: email vazio';
  END IF;
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'find_or_create_individual_client_by_email: nome vazio';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_email, 0));

  SELECT id INTO v_id
  FROM public.individual_clients
  WHERE lower(btrim(email)) = v_email
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, false;
    RETURN;
  END IF;

  INSERT INTO public.individual_clients (id, full_name, email, phone, status)
  VALUES (gen_random_uuid(), btrim(p_full_name), v_email, NULLIF(btrim(COALESCE(p_phone, '')), ''), 'active')
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, true;
END;
$$;

-- Só o service role pode chamar esta função — cria individual_clients
-- e não deve ficar acessível a anon/authenticated via RPC.
REVOKE ALL ON FUNCTION public.find_or_create_individual_client_by_email(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_or_create_individual_client_by_email(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_individual_client_by_email(text, text, text) TO service_role;
