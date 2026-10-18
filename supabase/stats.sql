-- Dot Trading Post — the two numbers at the foot of every page: visits since launch, and members.
--
-- Run after scale.sql (setup.sql runs everything in order).
--
-- A visit is one browser on one day. It is recognised by a hash of its network address and browser
-- name mixed with a secret that is made fresh each day and thrown away the next, so a day's visits
-- can't be linked to another day's, or back to anyone. No address, cookie or name is stored. When
-- the address isn't visible, the page's own random id stands in for it. Crawlers aren't counted.
-- Members are the accounts on the board.
--
-- Where visitors come from: a link with ?ref=… (a sticker's QR code, a trader's invite link, a post
-- somewhere) is remembered by the browser, sent with each visit, and kept on the profile if they
-- sign up. site_funnel then counts, for each source, visitors → sign-ups → posted → offered →
-- traded. Read it in the SQL editor:  select * from site_funnel;

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

-- One row per source, per browser, per day: how many people each link brought.
create table if not exists public.site_refs (
  day date not null,
  ref text not null,
  who text not null,
  primary key (day, ref, who)
);
alter table public.site_refs enable row level security;

-- The link that brought each member, set once by the board from the browser's first ?ref=.
alter table public.profiles add column if not exists ref text;
alter table public.profiles drop constraint if exists profiles_ref_shape;
alter table public.profiles add constraint profiles_ref_shape check (ref is null or ref ~ '^[a-z0-9_-]{1,40}$');

-- The old one-argument version is dropped so the API has one note_visit to call.
drop function if exists public.note_visit(text);
create or replace function public.note_visit(p_client text default null, p_ref text default null)
returns table (visits bigint, members bigint)
language plpgsql volatile security definer set search_path = public as $$
declare
  h json;
  ip text; ua text; salt text; src text; who_ text; r text;
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
    who_ := md5(salt || '|' || src || '|' || ua);
    insert into public.site_visits (day, who) values (current_date, who_) on conflict do nothing;
    r := lower(btrim(coalesce(p_ref, '')));
    if r ~ '^[a-z0-9_-]{1,40}$' then
      insert into public.site_refs (day, ref, who) values (current_date, r, who_) on conflict do nothing;
    end if;
  end if;
  return query select (select count(*) from public.site_visits), (select count(*) from public.profiles);
end $$;
revoke all on function public.note_visit(text, text) from public;
grant execute on function public.note_visit(text, text) to anon, authenticated;

-- For whoever runs the board (nothing grants it to the API): each source's visitors, and how far
-- the people it brought got. "(none)" is everyone who arrived without a ?ref=.
create or replace view public.site_funnel with (security_invoker = true) as
with m as (
  select coalesce(p.ref, '(none)') as ref,
         exists (select 1 from public.items i where i.owner_id = p.id) as posted,
         exists (select 1 from public.offers o where o.owner_id = p.id or o.from_id = p.id) as offered,
         exists (select 1 from public.offers o where (o.owner_id = p.id or o.from_id = p.id) and o.status = 'done') as traded
  from public.profiles p
), v as (
  select ref, count(distinct (day, who)) as visitors from public.site_refs group by ref
  union all
  select '(none)', (select count(*) from public.site_visits) - (select count(distinct (day, who)) from public.site_refs)
)
select coalesce(v.ref, s.ref) as ref, coalesce(v.visitors, 0) as visitors, coalesce(s.signups, 0) as signups,
       coalesce(s.posted, 0) as posted, coalesce(s.offered, 0) as offered, coalesce(s.traded, 0) as traded
from v full join (
  select ref, count(*) as signups, count(*) filter (where posted) as posted, count(*) filter (where offered) as offered, count(*) filter (where traded) as traded
  from m group by ref
) s on s.ref = v.ref
order by visitors desc, signups desc;
revoke all on public.site_funnel from public, anon, authenticated;
