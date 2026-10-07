-- Dot Trading Post — the two numbers at the foot of every page: visits since launch, and members.
--
-- Run after scale.sql (setup.sql runs everything in order).
--
-- A visit is one browser on one day. It is recognised by a hash of its network address and browser
-- name mixed with a secret that is made fresh each day and thrown away the next, so a day's visits
-- can't be linked to another day's, or back to anyone. No address, cookie or name is stored. When
-- the address isn't visible, the page's own random id stands in for it. Crawlers aren't counted.
-- Members are the accounts on the board.

create table if not exists public.site_visits (
  day date not null,
  who text not null,
  primary key (day, who)
);
create table if not exists public.site_salts (
  day  date primary key,
  salt text not null
);
-- Nobody reads or writes these directly; only note_visit() below does.
alter table public.site_visits enable row level security;
alter table public.site_salts enable row level security;

create or replace function public.note_visit(p_client text default null)
returns table (visits bigint, members bigint)
language plpgsql volatile security definer set search_path = public as $$
declare
  h json;
  ip text; ua text; salt text; src text;
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
  ip := btrim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', h->>'x-forwarded-for', ''), ',', 1));
  ua := left(coalesce(h->>'user-agent', ''), 300);
  src := coalesce(nullif(ip, ''), nullif(left(btrim(coalesce(p_client, '')), 64), ''));
  if src is not null and ua !~* '(bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|go-http)' then
    delete from public.site_salts where day < current_date;
    insert into public.site_salts (day, salt) values (current_date, md5(gen_random_uuid()::text || clock_timestamp()::text))
      on conflict (day) do nothing;
    select s.salt into salt from public.site_salts s where s.day = current_date;
    insert into public.site_visits (day, who) values (current_date, md5(salt || '|' || src || '|' || ua))
      on conflict do nothing;
  end if;
  return query select (select count(*) from public.site_visits), (select count(*) from public.profiles);
end $$;
revoke all on function public.note_visit(text) from public;
grant execute on function public.note_visit(text) to anon, authenticated;
