-- The capture link is now delivered by email / QR code instead of WhatsApp.
ALTER TABLE public.expense_capture_links
  ADD COLUMN sent_to text CHECK (sent_to IS NULL OR length(sent_to) <= 254);
COMMENT ON COLUMN public.expense_capture_links.sent_to IS 'Email address the link was sent to (the link itself is never stored)';
