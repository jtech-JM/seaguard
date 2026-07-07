-- ============================================================
-- Part 1 of 2: add rescue_officer enum value
-- Must be a standalone migration — Postgres requires the enum
-- ADD VALUE to commit before the new value can be used in DML.
-- ============================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'rescue_officer';
