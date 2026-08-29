-- =============================================================
-- PREFLIGHT (read-only) — corre isto ANTES de aplicar
-- 20260829_individual_clients_email_unique_OPTIONAL_run_after_preflight.sql
--
-- NÃO faz parte da sequência normal de migrations (sem prefixo de
-- data de propósito) e não altera dados. Serve só para responder:
-- "há emails duplicados em individual_clients hoje?"
--
-- Como usar:
--   1. Corre a query abaixo no Supabase SQL Editor.
--   2. Se devolver 0 linhas -> seguro aplicar a migration OPTIONAL
--      que adiciona o índice único parcial case-insensitive.
--   3. Se devolver linhas -> NÃO apliques a migration OPTIONAL ainda.
--      Resolve os duplicados manualmente (nunca automaticamente —
--      ver requisito "não fazer merge automático de clientes
--      existentes") e volta a correr este preflight até dar 0 linhas.
-- =============================================================

SELECT
  lower(btrim(email))                    AS normalized_email,
  count(*)                               AS duplicate_count,
  array_agg(id ORDER BY created_at ASC)  AS client_ids,
  array_agg(full_name ORDER BY created_at ASC) AS full_names
FROM public.individual_clients
WHERE email IS NOT NULL AND btrim(email) <> ''
GROUP BY lower(btrim(email))
HAVING count(*) > 1
ORDER BY duplicate_count DESC;
