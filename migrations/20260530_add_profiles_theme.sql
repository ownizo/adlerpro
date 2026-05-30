-- Migration: add theme preference column to profiles
-- Parte do feat(dark-mode) — Fase 0
-- Correr ANTES do primeiro deploy com este código

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'light'
  CHECK (theme IN ('light', 'dark'));

COMMENT ON COLUMN profiles.theme IS 'UI theme preference: light or dark';
