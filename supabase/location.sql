-- Dot Trading Post — a rough location on profiles, for "near me" and the map.
--
-- Run this in the Supabase SQL editor after schema.sql. Order relative to the others does not matter.
--
-- Coordinates are stored rounded to two decimals (about a kilometre). The board rounds before it
-- sends, but the promise can't depend on the browser behaving: the trigger below rounds whatever
-- arrives, so a modified client can't publish a precise location either. Profiles are public, so this is the right
-- grain: enough to say "12 miles away", not enough to find a front door.

alter table public.profiles
  add column if not exists lat double precision,
  add column if not exists lng double precision;

alter table public.profiles drop constraint if exists profiles_latlng_range;
alter table public.profiles add constraint profiles_latlng_range
  check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180));

create or replace function public.profiles_round_location() returns trigger
language plpgsql as $$
begin
  if new.lat is not null then new.lat := round(new.lat::numeric, 2)::double precision; end if;
  if new.lng is not null then new.lng := round(new.lng::numeric, 2)::double precision; end if;
  return new;
end $$;
drop trigger if exists profiles_round_location on public.profiles;
create trigger profiles_round_location before insert or update of lat, lng on public.profiles
  for each row execute function public.profiles_round_location();

-- Anything stored before this existed.
update public.profiles set lat = round(lat::numeric, 2)::double precision, lng = round(lng::numeric, 2)::double precision
 where lat is not null and (lat <> round(lat::numeric, 2)::double precision or lng <> round(lng::numeric, 2)::double precision);

-- Local pickup only: the lister will hand it over in person and won't post it. A trade on such a
-- listing is a meet-up, so neither side can mark it "posted" (see mark_sent in trades.sql).
alter table public.items add column if not exists local_only boolean not null default false;
