-- Visitas de vários sites na mesma tabela (adlerrochefort.com e viagemgarantida.com).
-- Aplicada em produção a 21 nov. 2026 (Supabase uqjxjymvhuvtwbqtesbr).
-- As linhas existentes e o tracker do adlerrochefort.com (que não envia "site") ficam com o valor por omissão.
alter table public.site_visits
  add column if not exists site text not null default 'adlerrochefort.com';

alter table public.site_visits
  drop constraint if exists site_visits_site_check;
alter table public.site_visits
  add constraint site_visits_site_check check (site in ('adlerrochefort.com', 'viagemgarantida.com'));

create index if not exists site_visits_site_created_at_idx on public.site_visits (site, created_at);
