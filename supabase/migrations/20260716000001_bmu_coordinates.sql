-- Add GPS coordinates to BMUs so the rescue dashboard can calculate
-- the closest BMU to an active SOS alert.

ALTER TABLE public.bmus
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;
