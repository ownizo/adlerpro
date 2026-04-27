# Migration Log

## Estado pre-migração — 2026-04-27

### Deploys actuais

- `pro.adlerrochefort.com` → Netlify site ID: `ce5dcce9-eba8-4d43-9bf1-42709b556821`
- `admin.adlerrochefort.com` → Netlify site ID: `22367580-aa25-4d63-aede-babe3e988bc2`
- `one.adlerrochefort.com` → Netlify site ID: `e359890d-5a6d-41c7-8fae-75278b765947`

> Os três servem **o mesmo bundle do repo `adlerpro`**. A diferenciação é client-side em `src/routes/index.tsx:51-62` por `window.location.hostname`. O 301 em `netlify.toml` força quem usar `/admin` no domínio `pro.` para `admin.adlerrochefort.com`.

> **Nota:** o repo `adlerrochefort` (site público estático) é um deploy separado com `netlify.toml` próprio — `adlerrochefort.com`. Site ID: `b19030cd-6689-49e0-83f8-58f0f131c91a`.

### Versões críticas

| Item | Versão |
|---|---|
| Node (local) | 24.14.1 |
| Node (Netlify build) | 22 (forçado em `[build.environment]`) |
| npm | 11.11.0 |
| pnpm | não instalado — projecto usa npm |
| `.nvmrc` | inexistente |
| React | `^19.2.0` |
| TanStack Router | `^1.163.3` |
| TanStack Start | `^1.166.1` (`@tanstack/react-start`) |
| TanStack Router Plugin | `^1.164.0` |
| TanStack Store | `^0.9.1` |
| Vite | `^7.1.7` |
| Tailwind CSS | `^4.0.6` (com `@tailwindcss/vite`) |
| TypeScript | `^5.7.2` |
| `@netlify/vite-plugin-tanstack-start` | `^1.2.14` |
| `@netlify/functions` | `^5.1.5` |
| `@netlify/blobs` | `^10.7.4` |
| `@supabase/ssr` | `^0.10.0` |
| `@supabase/supabase-js` | `^2.101.1` |

### Variáveis de ambiente em uso

**Cliente (expostas ao bundle — `import.meta.env`):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ANTHROPIC_API_KEY` — ⚠️ em `quotes-comparison.tsx:285`, chave Anthropic exposta no bundle

**Servidor (`process.env`, em Netlify Functions e server-fns):**
- `VITE_SUPABASE_URL` (re-lida server-side)
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `OPENWEATHERMAP_API_KEY`
- `RESEND_API_KEY`
- `REGCHECK_USERNAME` (com fallback hard-coded)
- `ADMIN_SECRET` (com fallback `'adler-admin-2025'`)
- `INVOICEXPRESS_ACCOUNT`
- `INVOICEXPRESS_API_KEY`

**Configurado no `netlify.toml` (`SECRETS_SCAN_OMIT_KEYS`):**
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Routes que existem hoje

**Raiz (`src/routes/`):**

```
__root.tsx              layout + providers
index.tsx               landing + host-based redirect
login.tsx               auth
dashboard.tsx           broker dashboard
policies.tsx            apólices (broker)
quotes-comparison.tsx   comparador de cotações
partner-risk.tsx        análise de risco de parceiros
license-plates.tsx      verificação de matrículas
weather-alerts.tsx      alertas meteorológicos
claims.tsx              sinistros (broker)
alerts.tsx              alertas
profile.tsx             perfil
contact.tsx             contacto
admin.tsx               painel admin (182 KB, 9 sub-tabs)
billing.tsx             faturação (1054 linhas, integra InvoiceExpress)
privacy-policy.tsx
terms-and-conditions.tsx
```

**Sub-app cliente (`src/routes/one/`):**

```
__root.tsx
index.tsx
login.tsx
dashboard.tsx
policies.tsx
claims.tsx
documents.tsx
profile.tsx
```

### Netlify Functions (`netlify/api-functions/`)

```
analyze-partner.mts          compare-quotes.mts
download-document.mts        extract-policy.mts
get-signed-url.mts           identity-login.mts
identity-signup.mts          list-policy-docs.mts
record-terms-acceptance.mts  send-renewal-alerts.mts
upload.mts                   verify-plate.mts
verify-seguro.mts            weather.mts
```

### Migrations Supabase

```
20250405_user_terms_acceptance.sql
20260409_renewal_alerts_state_supabase.sql
20260409_renewal_pipeline_management.sql
20260410_claim_collaboration.sql
20260411_claim_messages_canonical.sql
20260411_claim_policy_consistency.sql
20260416_documents_policy_support.sql
dia2.sql
```

### Itens em falta

(nenhum — todos os site IDs confirmados)
