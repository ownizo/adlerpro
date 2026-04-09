-- Migração: padronizar paths de storage no Supabase
-- Objetivo: introduzir campos canônicos sem quebrar dados legados

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS storage_path text;

ALTER TABLE public.policies
  ADD COLUMN IF NOT EXISTS storage_path text;

-- Backfill idempotente a partir dos campos legados
UPDATE public.documents
SET storage_path = blob_key
WHERE storage_path IS NULL
  AND blob_key IS NOT NULL;

UPDATE public.policies
SET storage_path = document_key
WHERE storage_path IS NULL
  AND document_key IS NOT NULL;

-- Índices para lookup de download e navegação
CREATE INDEX IF NOT EXISTS idx_documents_storage_path
  ON public.documents (storage_path);

CREATE INDEX IF NOT EXISTS idx_policies_storage_path
  ON public.policies (storage_path);
