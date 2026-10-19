-- Visibilidade em IA (October 2026): tracked prompts and per-engine results.
create table if not exists public.ai_vis_prompts (
  id uuid primary key default gen_random_uuid(),
  prompt text not null unique check (length(prompt) between 5 and 500),
  language text, market text, topic text,
  active boolean not null default true,
  source text not null default 'manual' check (source in ('manual','hubspot')),
  hubspot_prompt_id bigint unique,
  created_at timestamptz not null default now()
);
create table if not exists public.ai_vis_results (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.ai_vis_prompts(id) on delete cascade,
  engine text not null check (engine in ('CLAUDE','CHATGPT','GEMINI','PERPLEXITY','GOOGLE_AI_MODE','GOOGLE_AI_OVERVIEWS')),
  run_day date not null,
  run_at timestamptz not null default now(),
  source text not null default 'native' check (source in ('native','hubspot')),
  mentioned boolean not null default false,
  cited boolean not null default false,
  in_sources boolean not null default false,
  position smallint,
  competitors text[] not null default '{}',
  cited_urls text[] not null default '{}',
  answer_excerpt text check (answer_excerpt is null or length(answer_excerpt) <= 4000),
  model text, error text,
  unique (prompt_id, engine, run_day)
);
create index if not exists ai_vis_results_day_idx on public.ai_vis_results(run_day desc);
alter table public.ai_vis_prompts enable row level security;
alter table public.ai_vis_results enable row level security;
create policy ai_vis_prompts_admin_read on public.ai_vis_prompts for select using (public.is_admin());
create policy ai_vis_results_admin_read on public.ai_vis_results for select using (public.is_admin());
-- (25 initial prompts — the 18 tracked in HubSpot AEO plus 7 international-health prompts — were inserted on 2026-10-19.)
