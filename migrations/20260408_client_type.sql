-- Add client_type column to individual_clients
-- Allows classifying clients as 'individual' or 'company'
ALTER TABLE individual_clients ADD COLUMN IF NOT EXISTS client_type text DEFAULT 'individual';
