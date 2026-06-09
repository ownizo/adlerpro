-- =============================================================
-- Migration: ON DELETE SET NULL nas FKs auth_user_id
--
-- CONTEXTO
-- individual_clients.auth_user_id e company_users.auth_user_id
-- referenciam auth.users(id) SEM cláusula ON DELETE (= NO ACTION),
-- o que BLOQUEIA a eliminação de um utilizador no Supabase Auth
-- enquanto existir uma linha a apontar para ele ("Database error
-- deleting user"). Isto impede revogar acesso e apagar clientes.
--
-- CORREÇÃO
-- Mudar ambas para ON DELETE SET NULL: ao apagar o auth user, o
-- auth_user_id da linha passa automaticamente a NULL (o crachá
-- limpa-se sozinho), preservando a integridade referencial.
--
-- As tabelas internas do Supabase e profiles/user_terms_acceptance
-- já usam ON DELETE CASCADE — não são tocadas.
-- =============================================================

ALTER TABLE public.individual_clients
  DROP CONSTRAINT individual_clients_auth_user_id_fkey;
ALTER TABLE public.individual_clients
  ADD CONSTRAINT individual_clients_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.company_users
  DROP CONSTRAINT company_users_auth_user_id_fkey;
ALTER TABLE public.company_users
  ADD CONSTRAINT company_users_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
