-- Clientes particulares sem e-mail (aplicado em produção a 19/10/2026).
-- Várias carteiras de seguradoras (Innovarisk, parte da Hiscox) não trazem
-- e-mail do tomador; apply_carrier_import_record_block4 já grava
-- NULLIF(email, '') mas a coluna era NOT NULL, por isso a criação do
-- cliente falhava ("null value in column email ... violates not-null").
-- O código da app já trata e-mail em falta (marketing filtra nulos, o
-- convite para o portal só aparece com e-mail).
alter table public.individual_clients alter column email drop not null;
