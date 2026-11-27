-- 27 nov. 2026: acrescenta voyelis.com aos sites aceites em site_visits.
-- Aplicada em produção (Supabase uqjxjymvhuvtwbqtesbr).
alter table public.site_visits drop constraint if exists site_visits_site_check;
alter table public.site_visits
  add constraint site_visits_site_check check (site in ('adlerrochefort.com', 'viagemgarantida.com', 'guardemar.com', 'voyelis.com'));
