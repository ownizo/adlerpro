-- Slice 5d: suporte a envio de campanha a um único cliente individual
-- Adiciona coluna nullable à tabela marketing_campaigns.
-- Quando NOT NULL, o motor de envio ignora a audience e envia exclusivamente a este email
-- (verificado server-side contra individual_clients).

ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS single_recipient_email text;
