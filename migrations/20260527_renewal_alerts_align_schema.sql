-- =============================================================
-- Migration: renewal_alerts — remoção de trigger não
-- documentado + alinhamento de schema
--
-- CONTEXTO
-- O trigger trg_log_renewal_history foi criado directamente
-- na BD (via Supabase Dashboard) sem migration versionada.
-- Disparava AFTER UPDATE em renewal_alerts_state e inseria
-- em renewal_alerts_history — mas tinha dois problemas:
--   1. Só cobria UPDATE, não INSERT (primeiro registo de um
--      alerta não gerava entrada no histórico via trigger)
--   2. Não incluía alert_key na linha de histórico
-- O código TypeScript (adminUpdateRenewalAlertStatus) já
-- implementa a mesma lógica de forma mais completa: cobre
-- INSERT e UPDATE, inclui alert_key, e é testável e
-- versionado. O trigger é portanto redundante e parcialmente
-- incorreto.
-- Decisão: Opção Y — código como única fonte de verdade
-- para o histórico. Trigger e função removidos.
--
-- NOTAS SOBRE O QUE FOI APLICADO EM PRODUÇÃO
--   status_check já existia em inglês na BD — não recriado.
--   Removidos 2 constraints UNIQUE(policy_id) duplicados
--   (renewal_alerts_state_policy_id_key e unique_policy_id)
--   que impediam múltiplos ciclos de renovação por apólice.
--
-- TABELAS AFECTADAS
--   renewal_alerts_state  — ADD alert_key, uuid→text, UNIQUE
--   renewal_alerts_history — ADD alert_key, uuid→text
--
-- PRÉ-CONDIÇÕES
--   Ambas as tabelas estavam vazias no momento da análise.
--   Sem backfill de dados necessário.
-- =============================================================

-- ── Passo 1: remover trigger e função não versionados ────────
-- O trigger dependia da coluna assigned_to (uuid), bloqueando
-- o ALTER COLUMN abaixo. Remove-se primeiro.

DROP TRIGGER IF EXISTS trg_log_renewal_history
  ON renewal_alerts_state;

DROP FUNCTION IF EXISTS log_renewal_history();

-- ── Passo 2: renewal_alerts_state ────────────────────────────
-- alert_key: {policy_id}_{renewalYear}
--   renewalYear = ano do próximo renewalDate calculado por
--   computeUpcomingRenewalDate(policy.startDate, today)
--   NÃO usa policies.end_date (não actualizado na renovação)
--
-- assigned_to: era uuid mas sempre guardou email (texto).
-- A migration de criação da tabela (20260409) já definia
-- assigned_to como text; foi alterado para uuid directamente
-- na BD sem registo.
--
-- Removidos constraints UNIQUE(policy_id) duplicados que
-- existiam na BD sem correspondência nas migrations do repo:
-- permitem agora múltiplos alertas por apólice (ciclos anuais).

ALTER TABLE renewal_alerts_state
  DROP CONSTRAINT IF EXISTS renewal_alerts_state_policy_id_key,
  DROP CONSTRAINT IF EXISTS unique_policy_id,
  DROP CONSTRAINT IF EXISTS renewal_alerts_state_unique_per_cycle;

DROP INDEX IF EXISTS renewal_alerts_state_alert_key_uniq_idx;

ALTER TABLE renewal_alerts_state
  ADD COLUMN alert_key text NOT NULL,
  ALTER COLUMN assigned_to TYPE text USING assigned_to::text,
  ADD CONSTRAINT renewal_alerts_state_unique_per_cycle
    UNIQUE (policy_id, alert_key);

-- ── Passo 3: renewal_alerts_history ──────────────────────────
-- alert_key: liga cada entrada do histórico ao ciclo de
-- renovação concreto, permitindo lookup eficiente.
--
-- old_assigned_to / new_assigned_to: eram uuid pelo mesmo
-- motivo acima; migram para text.

ALTER TABLE renewal_alerts_history
  ADD COLUMN alert_key text NOT NULL,
  ALTER COLUMN old_assigned_to TYPE text USING old_assigned_to::text,
  ALTER COLUMN new_assigned_to TYPE text USING new_assigned_to::text;

CREATE INDEX IF NOT EXISTS renewal_alerts_history_alert_key_idx
  ON renewal_alerts_history (alert_key);
