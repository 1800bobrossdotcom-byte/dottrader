-- Dot Trading Post — a rough location on profiles, for "near me" and the map.
--
-- Run this in the Supabase SQL editor after schema.sql. Order relative to the others does not matter.
--
-- Coordinates are stored rounded to two decimals (about a kilometre) by the board before they are
-- sent, and the board never asks for more than that. Profiles are public, so this is the right
-- grain: enough to say "12 miles away", not enough to find a front door.

alter table public.profiles
  add column if not exists lat double precision,
  add column if not exists lng double precision;

alter table public.profiles drop constraint if exists profiles_latlng_range;
alter table public.profiles add constraint profiles_latlng_range
  check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180));
