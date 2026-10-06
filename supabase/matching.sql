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

-- Keywords for matching. Words that say nothing about what a thing is are dropped, plurals are
-- folded, accents come off (Pokémon = Pokemon), and every phrase in match_aliases that appears adds
-- its terms: all of them on the HAVE side, only the thing itself on the WANT side (see aliases.sql).
drop function if exists public.match_terms(text);
create or replace function public.match_terms(t text, side text default 'want') returns text[]
language sql stable set search_path = public as $$
  with n as (select public.match_norm(t) as s),
  words as (
    select case when length(w) > 4 and w ~ '[^s]s$' then left(w, -1) else w end as w
    from n, regexp_split_to_table(btrim(n.s), ' ') as w
    where length(w) >= 3 and w !~ '^[0-9]+$' and w not in (
      'the','and','for','with','any','open','offers','offer','trade','trades','swap','swaps','want','wants',
      'wanted','looking','something','stuff','good','great','condition','new','used','mint','one','two',
      'set','lot','item','items','other','others','from','this','that','have','has','will','can','all',
      'some','more','also','just','like','very','not','but','are','was','you','your','our','its','into',
      'only','pick','meet','post','ship','shipping','local','please','thanks','cash','money')
  ),
  named as (
    select unnest(case when side = 'have' then a.terms else a.terms[1:1] end) as w
    from n, public.match_aliases a
    where position(' ' || a.phrase || ' ' in n.s) > 0
  )
  select coalesce(array_agg(distinct w order by w), '{}') from (select w from words union select w from named) u where w <> '';
$$;

alter table public.items
  add column if not exists want_cats      text[]  not null default '{}',
  add column if not exists open_to_offers boolean not null default true,
  add column if not exists have_terms     text[]  not null default '{}',
  add column if not exists want_terms     text[]  not null default '{}';
alter table public.items drop constraint if exists items_want_cats_max;
alter table public.items add constraint items_want_cats_max check (coalesce(array_length(want_cats, 1), 0) <= 8);

-- What a listing is, as keywords, beyond its words: an NFT is an nft and is on a chain, so
-- "any NFT" or "something on Base" finds it; a thing is physical, so "anything physical" or "IRL"
-- finds every thing. (Tokens, the old ERC-20 listings, are neither.)
create or replace function public.asset_terms(kind text, chain bigint) returns text[]
language sql immutable as $$
  select case
    when kind is null then '{physical}'::text[]
    when kind in ('erc721', 'erc1155') then array_remove(array['nft', case chain
      when 1 then 'ethereum' when 8453 then 'basechain' when 42161 then 'arbitrum' when 10 then 'optimism'
      when 137 then 'polygon' when 56 then 'bnb' when 43114 then 'avalanche' when 7777777 then 'zora' end], null)
    else '{}'::text[] end
$$;

create or replace function public.items_terms() returns trigger
language plpgsql as $$
begin
  new.have_terms := array(select distinct w from unnest(
    public.match_terms(coalesce(new.title, '') || ' ' || coalesce(new.descr, ''), 'have') || public.asset_terms(new.asset_kind, new.asset_chain)) w order by w);
  new.want_terms := public.match_terms(new.want, 'want');
  -- An NFT always files under NFTs, so the category and the "I'd take NFTs" chip mean one thing.
  if new.asset_kind in ('erc721', 'erc1155') then new.cat := 'NFTs'; end if;
  return new;
end $$;
drop trigger if exists items_terms on public.items;
create trigger items_terms before insert or update of title, descr, want, cat, asset_kind, asset_chain on public.items
  for each row execute function public.items_terms();
-- Re-read every listing and saved search when the way keywords are made changes. Bump the
-- version whenever match_terms, asset_terms or the alias list changes meaningfully.
do $$
begin
  if coalesce((select value from public.app_config where key = 'match_terms_version'), '') <> '3' then
    update public.items set title = title;  -- runs items_terms on every listing
    insert into public.app_config (key, value) values ('match_terms_version', '3')
      on conflict (key) do update set value = excluded.value;
  end if;
end $$;

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
  new.terms := public.match_terms(new.label, 'want');
  if cardinality(new.terms) = 0 and cardinality(new.cats) = 0 then raise exception 'say what you are looking for'; end if;
  if tg_op = 'INSERT' and (select count(*) from public.saved_wants where user_id = new.user_id) >= 20 then
    raise exception 'twenty saved searches is the limit — remove one first';
  end if;
  return new;
end $$;
drop trigger if exists saved_wants_prepare on public.saved_wants;
create trigger saved_wants_prepare before insert or update on public.saved_wants
  for each row execute function public.saved_wants_prepare();
update public.saved_wants set terms = public.match_terms(label, 'want')
 where terms is distinct from public.match_terms(label, 'want');

-- ---------------------------------------------------------------- the matching rules, in one place

create or replace function public.wants_item(w_cats text[], w_terms text[], x public.items) returns boolean
language sql immutable as $$ select x.cat = any(w_cats) or x.have_terms && w_terms $$;

create or replace function public.search_fits(w public.saved_wants, x public.items) returns boolean
language sql immutable as $$
  select (cardinality(w.cats) = 0 or x.cat = any(w.cats)) and (cardinality(w.terms) = 0 or x.have_terms && w.terms)
$$;

-- Every open listing of someone else's that wants one of mine, or that one of mine wants — the
-- matches strip — best first. Listings are public, so this runs as the caller.
--
-- How a pair scores:
--   both ways (mutual)                        +100
--   they named my category / I named theirs   +40 / +30
--   shared keywords, each way (up to 3)       +12 / +10 each
--   within about 50 km of me                  +15
--   their listing carries Proof of item        +5
--   they're open to other offers               +5
drop function if exists public.my_matches();
create function public.my_matches()
returns table (my_item uuid, their_item uuid, they_want_mine boolean, i_want_theirs boolean, score integer, nearby boolean)
language sql stable set search_path = public as $$
  with me as (select lat, lng from public.profiles where id = auth.uid())
  select x.id, y.id, f.tw, f.iw,
    ( case when f.tw and f.iw then 100 else 0 end
    + case when x.cat = any (y.want_cats) then 40 else 0 end
    + case when y.cat = any (x.want_cats) then 30 else 0 end
    + 12 * least(3, cardinality(array(select unnest(x.have_terms) intersect select unnest(y.want_terms))))
    + 10 * least(3, cardinality(array(select unnest(y.have_terms) intersect select unnest(x.want_terms))))
    + case when g.near then 15 else 0 end
    + case when exists (select 1 from public.verification_badges b where b.item_id = y.id) then 5 else 0 end
    + case when y.open_to_offers then 5 else 0 end )::int as score,
    g.near
  from public.items x
  join public.items y on y.owner_id <> x.owner_id and y.status = 'open'
  cross join lateral (select public.wants_item(y.want_cats, y.want_terms, x) as tw, public.wants_item(x.want_cats, x.want_terms, y) as iw) f
  left join public.profiles py on py.id = y.owner_id
  left join me on true
  cross join lateral (select coalesce(me.lat is not null and py.lat is not null
    and 111 * sqrt(power(py.lat - me.lat, 2) + power((py.lng - me.lng) * cos(radians(me.lat)), 2)) <= 50, false) as near) g
  where x.owner_id = auth.uid() and x.status = 'open' and (f.tw or f.iw)
  order by score desc, y.created_at desc
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
