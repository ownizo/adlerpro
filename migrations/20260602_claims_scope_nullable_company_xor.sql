-- =============================================================
-- Migration: claims — âmbito B2C (company_id nullable + XOR)
--
-- CONTEXTO
-- claims.company_id era NOT NULL sem default. O fluxo B2C
-- (submitIndividualClaim -> getOrCreateClaimByPolicy ->
-- createClaim) constrói o sinistro com individual_client_id e
-- SEM company_id, pelo que o INSERT violava o NOT NULL e
-- falhava silenciosamente (createClaim engolia o erro). Como
-- consequência, a criação de sinistros de clientes particulares
-- nunca chegou a gravar.
--
-- ALTERAÇÃO
--   1. company_id deixa de ser NOT NULL (passa a aceitar B2C).
--   2. CHECK claims_scope_xor garante, ao nível da BD, que
--      EXATAMENTE um de {company_id, individual_client_id} está
--      preenchido. NULLIF(company_id,'') trata '' como ausente
--      (blindagem contra o sentinela '' usado noutros pontos).
--
-- PRÉ-CONDIÇÕES (verificadas em 2026-06-02, read-only)
--   total de claims: 1
--   linhas que falhariam o XOR: 0
--     (both_present=0, neither_present=0, company_empty=0,
--      company_null=0)
--   A constraint valida os dados atuais sem falhar; sem backfill.
--
-- IMPACTO
--   * Sinistro B2B existente (company_id real, individual NULL)
--     continua válido.
--   * Sem FKs de outras tabelas para claims.id na BD viva
--     (claim_messages/documents não têm FK), logo sem efeitos
--     em cascata.
--   * Trigger claims_prevent_duplicate_active_by_policy só usa
--     policy_id/status — não é afetado.
--   * O service_role (app) passa a poder inserir sinistros B2C.
-- =============================================================

ALTER TABLE public.claims
  ALTER COLUMN company_id DROP NOT NULL;

ALTER TABLE public.claims
  ADD CONSTRAINT claims_scope_xor CHECK (
    (NULLIF(company_id, '') IS NOT NULL) <> (individual_client_id IS NOT NULL)
  );
