# Migração: Netlify Blobs -> Supabase Storage

Este plano foi desenhado para migrar sem perda de dados e com compatibilidade de links/chaves legadas.

## 1) Inventário e congelamento curto de escrita

1. Confirmar buckets de destino no Supabase: `documents` e `avatars`.
2. Levantar referências atuais no banco:
   - `policies.document_key`
   - `documents.blob_key`
3. Definir janela curta de cutover para reduzir risco de divergência entre stores.

## 2) Backfill dos objetos legados

1. Exportar objetos existentes do store `portal-files` (ambiente de produção).
2. Reenviar objetos para Supabase Storage mantendo a chave lógica:
   - Se a chave começar por `documents/`, gravar no bucket `documents` sem o prefixo.
   - Se a chave começar por `avatars/`, gravar no bucket `avatars` sem o prefixo.
   - Caso contrário, gravar no bucket `documents` com a key original.
3. Preservar `content-type` e nome original quando disponível.

## 3) Compatibilidade em runtime (já aplicada)

1. Endpoint `/api/download-document` passa a resolver no Supabase com múltiplos formatos de key.
2. Chaves antigas com prefixo (`documents/...`) continuam válidas.
3. URL completa em `key` continua suportada por redirecionamento.

## 4) Migração dos fluxos de autenticação (já aplicada)

1. `identity-signup` deixa de ler `company-users` em Blobs e passa a usar `company_users` no Supabase.
2. `identity-login` deixa de escrever em Blobs e passa a:
   - atualizar `company_users` (`last_login_at`, `identity_status`, `updated_at`);
   - inserir evento em `user_metric_events`.

## 5) Validação pós-cutover

1. Amostragem de documentos antigos e recentes para confirmar download.
2. Testar signup/login de utilizador com e sem associação a empresa.
3. Confirmar criação de eventos `login` em `user_metric_events`.

## 6) Rollback controlado

1. Manter backup/export dos objetos legados até finalizar validação.
2. Caso haja falha pontual de objeto, reexecutar backfill apenas para as keys em falta.
3. Só remover artefactos legados após validação completa.
