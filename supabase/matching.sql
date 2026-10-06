-- Dot Trading Post — matching: finding the other half of a trade.
--
-- Run after schema.sql (setup.sql runs everything in order).
--
-- Barter has a double-coincidence problem: I have X and want Y; you have Y and want X. A board of
-- free-text listings leaves people to find each other by luck. This makes wants structured enough
-- to match on, without making anyone fill in a form:
--
--   · a listing can name the CATEGORIES its owner would take, beside the free-text want;
--   · keywords are pulled from what a listing HAS (title, details) and what it WANTS, by a trigger;
--   · anyone can save a "looking for" search — words, categories, or both.
--
-- A listing wants mine when my category is one it named, or my keywords overlap its want
-- keywords. A match is MUTUAL when that holds both ways. Saved searches are stricter (every part
-- given must fit), because they drive alerts and an alert should be right.

-- Words that say nothing about what a thing is.
create or replace function public.match_terms(t text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct w order by w), '{}') from (
    select case when length(w) > 4 and w ~ '[^s]s$' then left(w, -1) else w end as w
    from regexp_split_to_table(lower(coalesce(t, '')), '[^a-z0-9]+') as w
    where length(w) >= 3 and w !~ '^[0-9]+$' and w not in (
      'the','and','for','with','any','open','offers','offer','trade','trades','swap','swaps','want','wants',
      'wanted','looking','something','stuff','good','great','condition','new','used','mint','one','two',
      'set','lot','item','items','other','others','from','this','that','have','has','will','can','all',
      'some','more','also','just','like','very','not','but','are','was','you','your','our','its','into',
      'only','just','pick','meet','post','ship','shipping','local','please','thanks','cash','money')
  ) s where w <> '';
$$;

alter table public.items
  add column if not exists want_cats      text[]  not null default '{}',
  add column if not exists open_to_offers boolean not null default true,
  add column if not exists have_terms     text[]  not null default '{}',
  add column if not exists want_terms     text[]  not null default '{}';
alter table public.items drop constraint if exists items_want_cats_max;
alter table public.items add constraint items_want_cats_max check (coalesce(array_length(want_cats, 1), 0) <= 8);

create or replace function public.items_terms() returns trigger
language plpgsql as $$
begin
  new.have_terms := public.match_terms(coalesce(new.title, '') || ' ' || coalesce(new.descr, ''));
  new.want_terms := public.match_terms(new.want);
  return new;
end $$;
drop trigger if exists items_terms on public.items;
create trigger items_terms before insert or update of title, descr, want on public.items
  for each row execute function public.items_terms();
-- Listings that existed before matching did.
update public.items set have_terms = public.match_terms(coalesce(title, '') || ' ' || coalesce(descr, '')),
                        want_terms = public.match_terms(want)
 where have_terms = '{}' and want_terms = '{}';

create index if not exists items_have_terms_idx on public.items using gin (have_terms);
create index if not exists items_want_terms_idx on public.items using gin (want_terms);
create index if not exists items_want_cats_idx  on public.items using gin (want_cats);

-- ---------------------------------------------------------------- saved searches

create table if not exists public.saved_wants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  label       text not null default '' check (char_length(label) <= 80),
  cats        text[] not null default '{}' check (coalesce(array_length(cats, 1), 0) <= 8),
  terms       text[] not null default '{}',
  created_at  timestamptz not null default now(),
  check (cardinality(cats) > 0 or char_length(btrim(label)) > 0)
);
create index if not exists saved_wants_user_idx on public.saved_wants (user_id);
create index if not exists saved_wants_terms_idx on public.saved_wants using gin (terms);
alter table public.saved_wants enable row level security;
drop policy if exists "saved wants are their owner's" on public.saved_wants;
create policy "saved wants are their owner's" on public.saved_wants for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.saved_wants_prepare() returns trigger
language plpgsql as $$
begin
  new.terms := public.match_terms(new.label);
  if cardinality(new.terms) = 0 and cardinality(new.cats) = 0 then raise exception 'say what you are looking for'; end if;
  if tg_op = 'INSERT' and (select count(*) from public.saved_wants where user_id = new.user_id) >= 20 then
    raise exception 'twenty saved searches is the limit — remove one first';
  end if;
  return new;
end $$;
drop trigger if exists saved_wants_prepare on public.saved_wants;
create trigger saved_wants_prepare before insert or update on public.saved_wants
  for each row execute function public.saved_wants_prepare();

-- ---------------------------------------------------------------- the matching rules, in one place

create or replace function public.wants_item(w_cats text[], w_terms text[], x public.items) returns boolean
language sql immutable as $$ select x.cat = any(w_cats) or x.have_terms && w_terms $$;

create or replace function public.search_fits(w public.saved_wants, x public.items) returns boolean
language sql immutable as $$
  select (cardinality(w.cats) = 0 or x.cat = any(w.cats)) and (cardinality(w.terms) = 0 or x.have_terms && w.terms)
$$;

-- Every open listing of someone else's that wants one of mine, or that one of mine wants: the
-- matches strip. Listings are public, so this runs as the caller.
create or replace function public.my_matches()
returns table (my_item uuid, their_item uuid, they_want_mine boolean, i_want_theirs boolean)
language sql stable set search_path = public as $$
  select x.id, y.id, public.wants_item(y.want_cats, y.want_terms, x), public.wants_item(x.want_cats, x.want_terms, y)
  from public.items x
  join public.items y on y.owner_id <> x.owner_id and y.status = 'open'
  where x.owner_id = auth.uid() and x.status = 'open'
    and (public.wants_item(y.want_cats, y.want_terms, x) or public.wants_item(x.want_cats, x.want_terms, y))
  order by (public.wants_item(y.want_cats, y.want_terms, x) and public.wants_item(x.want_cats, x.want_terms, y)) desc, y.created_at desc
  limit 100;
$$;

-- How many people want each of these listings: other people's open listings whose wants fit, and
-- other people's saved searches that fit. Counts only — a saved search is private, so this runs
-- as the database owner and returns numbers, never who.
create or replace function public.wanted_counts(p_items uuid[])
returns table (item_id uuid, listings integer, searches integer)
language sql stable security definer set search_path = public as $$
  select x.id,
    (select count(*) from public.items y where y.status = 'open' and y.owner_id <> x.owner_id and public.wants_item(y.want_cats, y.want_terms, x))::int,
    (select count(distinct w.user_id) from public.saved_wants w where w.user_id <> x.owner_id and public.search_fits(w, x))::int
  from public.items x
  where x.id = any (p_items[1:200]) and x.status = 'open';
$$;
grant execute on function public.wanted_counts(uuid[]) to anon, authenticated;

-- Listings that fit each of my saved searches, newest first. Runs as the caller: the saved_wants
-- policy keeps it to mine.
create or replace function public.my_search_hits()
returns table (want_id uuid, item_id uuid)
language sql stable set search_path = public as $$
  select w.id, x.id
  from public.saved_wants w
  cross join lateral (
    select x.id from public.items x
    where x.status = 'open' and x.owner_id <> w.user_id and public.search_fits(w, x)
    order by x.created_at desc limit 20
  ) x
  where w.user_id = auth.uid();
$$;

-- The open listings that want this one: "see who wants it". Listings are public; runs as the caller.
create or replace function public.listings_wanting(p_item uuid)
returns setof uuid
language sql stable set search_path = public as $$
  select y.id from public.items x
  join public.items y on y.status = 'open' and y.owner_id <> x.owner_id
  where x.id = p_item and public.wants_item(y.want_cats, y.want_terms, x)
  order by y.created_at desc limit 50;
$$;
