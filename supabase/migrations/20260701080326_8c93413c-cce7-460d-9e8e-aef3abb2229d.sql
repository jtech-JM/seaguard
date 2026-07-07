
-- Enable pgcrypto so gen_random_bytes is available
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Add per-device shared secret for hardware auth
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS device_secret TEXT NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex');

-- Remove public read policy — hardware auth now goes through service role via signed header
DROP POLICY IF EXISTS "devices public read" ON public.devices;
REVOKE SELECT ON public.devices FROM anon;
