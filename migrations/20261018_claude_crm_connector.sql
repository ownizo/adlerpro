-- Claude ↔ CRM connector (October 2026)
-- General tasks (no client) + new task sources/priority
alter table public.client_tasks add constraint client_tasks_scope_at_most_one check (not (nullif(company_id,'') is not null and individual_client_id is not null));
alter table public.client_tasks drop constraint if exists client_tasks_scope_xor;
alter table public.client_tasks drop constraint if exists client_tasks_source_check;
alter table public.client_tasks add constraint client_tasks_source_check_v2 check (source = any (array['manual','renewal','opportunity','claude','email','lead','accounting']));
alter table public.client_tasks add column if not exists priority smallint not null default 2;
alter table public.client_tasks add column if not exists created_by text;

-- Email history (metadata + short snippet only)
create table if not exists public.crm_emails (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null unique,
  gmail_thread_id text,
  direction text not null check (direction in ('in','out')),
  from_address text,
  to_addresses text[] not null default '{}',
  subject text,
  snippet text check (snippet is null or length(snippet) <= 600),
  sent_at timestamptz not null,
  category text check (category is null or category in ('client','lead','insurer','accounting','other')),
  needs_reply boolean not null default false,
  replied_at timestamptz,
  individual_client_id uuid references public.individual_clients(id) on delete set null,
  company_id text references public.companies(id) on delete set null,
  opportunity_id uuid references public.sales_opportunities(id) on delete set null,
  policy_id text references public.policies(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists crm_emails_client_idx on public.crm_emails(individual_client_id, sent_at desc);
create index if not exists crm_emails_company_idx on public.crm_emails(company_id, sent_at desc);
create index if not exists crm_emails_reply_idx on public.crm_emails(needs_reply) where needs_reply;
alter table public.crm_emails enable row level security;
create policy crm_emails_admin_read on public.crm_emails for select using (public.is_admin());

-- Audit log of connector actions
create table if not exists public.crm_activity (
  id bigserial primary key,
  actor text not null,
  action text not null,
  entity text,
  entity_id text,
  summary text,
  created_at timestamptz not null default now()
);
create index if not exists crm_activity_created_idx on public.crm_activity(created_at desc);
alter table public.crm_activity enable row level security;
create policy crm_activity_admin_read on public.crm_activity for select using (public.is_admin());

-- OAuth for the connector (service role only; RLS on, no policies)
create table if not exists public.mcp_oauth_clients (client_id text primary key, client_name text, redirect_uris text[] not null, created_at timestamptz not null default now());
create table if not exists public.mcp_oauth_codes (code_hash text primary key, client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade, redirect_uri text not null, code_challenge text not null, scope text, user_id uuid, expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.mcp_oauth_tokens (token_hash text primary key, kind text not null check (kind in ('access','refresh')), client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade, user_id uuid, family uuid not null, expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now());
create index if not exists mcp_oauth_tokens_family_idx on public.mcp_oauth_tokens(family);
alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;
