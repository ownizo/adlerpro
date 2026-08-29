-- =============================================================
-- OPTIONAL — NÃO APLICAR AUTOMATICAMENTE.
--
-- Adiciona um índice único parcial case-insensitive sobre
-- individual_clients.email, para reforçar ao nível da BD a regra
-- "1 pessoa = 1 individual_client" que hoje só é garantida pela
-- função find_or_create_individual_client_by_email (ver
-- 20260829_website_leads.sql).
--
-- PRÉ-REQUISITO OBRIGATÓRIO
-- Corre primeiro migrations/PREFLIGHT_individual_clients_email_duplicates.sql
-- e confirma que devolve 0 linhas. Se a BD tiver duplicados
-- históricos, este CREATE UNIQUE INDEX falha (e é suposto falhar —
-- não resolve duplicados sozinho, nem deve).
--
-- Depois de aplicado, find_or_create_individual_client_by_email
-- continua a funcionar sem alterações — o advisory lock e este
-- índice tornam-se redundantes-mas-inofensivos em conjunto (defesa
-- em profundidade), não conflituosos.
-- =============================================================

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS individual_clients_email_normalized_uidx
  ON public.individual_clients (lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '';
