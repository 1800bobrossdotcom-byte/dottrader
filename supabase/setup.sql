-- Dot Trading Post — EVERYTHING, in order, in one paste.
--
-- Supabase → SQL Editor → New query → paste this whole file → Run.
-- Safe to run again at any time: every statement checks before it creates, so re-running on a
-- project that already has some or all of it changes nothing that is already right and adds
-- whatever is missing. When this repository gains a feature that needs the database, this file
-- is updated, and running it again is the whole upgrade.
--
-- Generated from the individual files in this folder; edit those, not this.

-- ============================================================================================
-- schema.sql
-- ============================================================================================

-- Dot Trading Post — database schema.
--
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- The rule it enforces everywhere: a person can only ever write their own rows, and the two
-- transitions that matter — accepting an offer and pressing your dot — go through functions
-- rather than direct writes. That is deliberate. If offers were directly updatable by both
-- parties, the person who made an offer could set the OTHER side's confirmation and close a
-- trade alone, which is exactly the thing the two-sided press exists to prevent. The functions
-- check who is calling and set only that caller's own field.

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text,
  area        text,
  note        text,
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles readable by everyone" on public.profiles;
create policy "profiles readable by everyone" on public.profiles for select using (true);

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update using (auth.uid() = id);

-- Give every new account a profile row so names resolve from the first visit. The name is an
-- anonymous placeholder, never derived from the email: profiles are public, and the part of an
-- address before the @ is often a real name. The board asks people to choose their own.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, 'Trader ' || upper(substr(replace(new.id::text, '-', ''), 1, 4)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- items

create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  descr       text not null default '' check (char_length(descr) <= 600),
  want        text not null default '' check (char_length(want) <= 80),
  cat         text not null default 'Other',
  -- open: on the board · pledged: agreed, awaiting delivery · traded: finished
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);

-- open: on the board · pledged: in an agreed trade · traded: finished · removed: taken down by its
-- owner but kept, because trades that happened on it are part of other people's records.
alter table public.items drop constraint if exists items_status_check;
alter table public.items add constraint items_status_check check (status in ('open', 'pledged', 'traded', 'removed'));

create index if not exists items_created_idx on public.items (created_at desc);
create index if not exists items_owner_idx on public.items (owner_id);

alter table public.items enable row level security;

drop policy if exists "items readable by everyone" on public.items;
create policy "items readable by everyone" on public.items for select using (true);

drop policy if exists "insert own item" on public.items;
create policy "insert own item" on public.items for insert with check (auth.uid() = owner_id);

drop policy if exists "update own item" on public.items;
create policy "update own item" on public.items for update using (auth.uid() = owner_id);

-- No delete policy: deleting an item used to cascade away its offers, which let someone erase a
-- no-show or a finished trade from the record. remove_item() below deletes only an item nobody has
-- traded on, and otherwise takes it off the board while keeping the history.
drop policy if exists "delete own item" on public.items;

-- An item's status is the trade's business, not its owner's: new items start open, and only the
-- trade functions (which run as the database owner) move it after that. An owner editing a title
-- can't quietly reopen something they have promised to someone.
create or replace function public.items_guard() returns trigger
language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then new.status := 'open';
    elsif new.status is distinct from old.status then raise exception 'listing status changes go through the board';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists items_guard on public.items;
create trigger items_guard before insert or update on public.items
  for each row execute function public.items_guard();

create or replace function public.remove_item(p_item uuid)
returns text language plpgsql security definer set search_path = public as $$
declare it public.items;
begin
  select * into it from public.items where id = p_item for update;
  if not found then raise exception 'item not found'; end if;
  if it.owner_id <> auth.uid() then raise exception 'you can only remove your own listing'; end if;
  if it.status = 'pledged' then raise exception 'it is in an agreed trade — finish or cancel that first'; end if;
  -- Offers elsewhere that put this listing in can't be kept any more.
  update public.offers set status = 'declined' where status = 'pending' and p_item = any (give_items);
  if exists (select 1 from public.offers o where o.item_id = p_item and (o.status in ('agreed', 'done', 'cancelled'))) then
    update public.offers set status = 'declined' where item_id = p_item and status = 'pending';
    update public.items set status = 'removed' where id = p_item;
    return 'removed';
  end if;
  delete from public.items where id = p_item;
  return 'deleted';
end $$;

-- ---------------------------------------------------------------- offers

create table if not exists public.offers (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.items on delete cascade,
  owner_id       uuid not null references auth.users on delete cascade,  -- whoever posted the item
  from_id        uuid not null references auth.users on delete cascade,  -- whoever is offering
  give           text not null check (char_length(give) between 1 and 80),
  msg            text not null default '' check (char_length(msg) <= 400),
  status         text not null default 'pending'
                 check (status in ('pending', 'agreed', 'done', 'declined')),
  confirm_owner  boolean not null default false,
  confirm_from   boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Listings of the offerer's own that they are putting into the offer (up to six). They travel with
-- the trade: pledged when it is accepted, traded when it completes, back on the board if it falls
-- through — so one listing can't be promised in two trades at once.
alter table public.offers add column if not exists give_items uuid[] not null default '{}';
-- When the second dot was pressed. Older finished trades have none; their offer date stands in.
alter table public.offers add column if not exists done_at timestamptz;
alter table public.offers drop constraint if exists offers_give_items_max;
alter table public.offers add constraint offers_give_items_max check (coalesce(array_length(give_items, 1), 0) <= 6);

create index if not exists offers_item_idx on public.offers (item_id);
create index if not exists offers_give_items_idx on public.offers using gin (give_items);
create index if not exists offers_people_idx on public.offers (owner_id, from_id);

alter table public.offers enable row level security;

drop policy if exists "offers readable by everyone" on public.offers;
create policy "offers readable by everyone" on public.offers for select using (true);

drop policy if exists "insert own offer" on public.offers;
create policy "insert own offer" on public.offers for insert
  with check (auth.uid() = from_id and auth.uid() <> owner_id);

-- Deliberately NO update or delete policy: every change to an offer goes through the functions
-- below, so neither party can write the other's confirmation.

-- ---------------------------------------------------------------- transitions

create or replace function public.accept_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers; it public.items; v_all uuid[];
begin
  -- Which listings an offer involves never changes after it is made, so read that first, lock
  -- those listings (always in the same order), and only then lock the offer itself. Two accepts
  -- touching the same listings queue on the first lock; the second then finds its offer declined
  -- or something pledged and stops with a reason, rather than deadlocking with the first.
  select * into o from public.offers where id = p_offer;
  if not found then raise exception 'offer not found'; end if;
  v_all := o.item_id || o.give_items;
  perform 1 from public.items where id = any (v_all) order by id for update;
  select * into o from public.offers where id = p_offer for update;
  select * into it from public.items where id = o.item_id;
  if it.owner_id <> auth.uid() or o.owner_id <> it.owner_id then raise exception 'only the person who posted the item can accept'; end if;
  if it.status <> 'open' then raise exception 'this item is already in a trade'; end if;
  if o.status <> 'pending' then raise exception 'this offer is no longer pending'; end if;
  if exists (
    select 1 from unnest(o.give_items) gid left join public.items g on g.id = gid
     where g.id is null or g.owner_id <> o.from_id or g.status <> 'open'
  ) then raise exception 'something in this offer is no longer on the board — ask them to offer again'; end if;

  update public.offers set status = 'agreed' where id = p_offer;
  update public.items  set status = 'pledged' where id = any (v_all);
  -- Every other open offer on any of these listings, or putting any of them in, is now moot.
  update public.offers set status = 'declined'
   where id <> p_offer and status = 'pending' and (item_id = any (v_all) or give_items && v_all);
end $$;

create or replace function public.decline_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  if o.owner_id <> auth.uid() then raise exception 'only the person who posted the item can decline'; end if;
  if o.status <> 'pending' then raise exception 'this offer is no longer pending'; end if;
  update public.offers set status = 'declined' where id = p_offer;
end $$;

-- Pressing your dot confirms YOUR side arrived and earns the other person a dot. The second
-- press closes the trade. The caller can only ever set their own field.
create or replace function public.press_dot(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers; v_both boolean;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  if o.status <> 'agreed' then raise exception 'this trade is not awaiting delivery'; end if;

  if auth.uid() = o.owner_id then
    update public.offers set confirm_owner = true where id = p_offer;
  elsif auth.uid() = o.from_id then
    update public.offers set confirm_from = true where id = p_offer;
  else
    raise exception 'you are not part of this trade';
  end if;

  select confirm_owner and confirm_from into v_both from public.offers where id = p_offer;
  if v_both then
    update public.offers set status = 'done', done_at = now() where id = p_offer;
    update public.items  set status = 'traded' where id = o.item_id or id = any (o.give_items);
  end if;
end $$;

-- The invariant the trade functions maintain, made impossible to break: one item, at most one live
-- or finished trade.
create unique index if not exists offers_one_trade_per_item on public.offers (item_id)
  where status in ('agreed', 'done');

-- ---------------------------------------------------------------- realtime

-- So every open browser sees new listings and offers without a refresh.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items') then
    alter publication supabase_realtime add table public.items;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'offers') then
    alter publication supabase_realtime add table public.offers;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- ============================================================================================
-- wallets.sql
-- ============================================================================================

-- Dot Trading Post — wallets and cross-chain digital assets.
--
-- Run this in the Supabase SQL editor AFTER schema.sql.
--
-- Nothing here is trusted. These columns hold claims, not facts: an address with a signature that
-- proves someone controls it, and a contract plus token id on some chain. Every viewer's browser
-- re-checks both for itself — it verifies the signature locally, and reads the token's current
-- holder straight off that chain's own RPC — so a row that lies is visibly a row that lies, and
-- the database is never the authority on who owns what.
--
-- Cross-chain needs no bridge here because nothing is swapped atomically. An NFT on Base trades
-- for one on Ethereum the same way a skillet trades for a bike: each side sends, each side presses
-- their dot, and the board simply shows, live, whether each side still holds what it offered.

alter table public.profiles
  add column if not exists wallet_address text,
  add column if not exists wallet_msg     text,
  add column if not exists wallet_sig     text;

-- The item side of a trade.
alter table public.items
  -- null for an ordinary physical item
  add column if not exists asset_kind     text
    check (asset_kind is null or asset_kind in ('erc721', 'erc1155', 'erc20')),
  add column if not exists asset_chain    integer,
  add column if not exists asset_contract text,
  add column if not exists asset_token_id text;

-- The offered side of a trade, which may sit on an entirely different chain.
alter table public.offers
  add column if not exists asset_kind     text
    check (asset_kind is null or asset_kind in ('erc721', 'erc1155', 'erc20')),
  add column if not exists asset_chain    integer,
  add column if not exists asset_contract text,
  add column if not exists asset_token_id text;

-- A digital listing needs all of its parts or none of them. ERC-20 has no token id.
alter table public.items drop constraint if exists items_asset_complete;
alter table public.items add constraint items_asset_complete check (
  asset_kind is null
  or (asset_chain is not null and asset_contract is not null
      and (asset_kind = 'erc20' or asset_token_id is not null))
);

alter table public.offers drop constraint if exists offers_asset_complete;
alter table public.offers add constraint offers_asset_complete check (
  asset_kind is null
  or (asset_chain is not null and asset_contract is not null
      and (asset_kind = 'erc20' or asset_token_id is not null))
);

-- ============================================================================================
-- privacy.sql
-- ============================================================================================

-- Dot Trading Post — make offers private to the two people in them.
--
-- Run this in the Supabase SQL editor AFTER schema.sql and wallets.sql.
--
-- The original policy was `select using (true)`: every offer readable by anyone with the publishable
-- key, message and all. So a note meant for one person — "I can drop it round Tuesday, I'm on
-- Mill Lane" — was readable by every visitor to the board, and by anyone who ever found the key,
-- which is printed in the page by design. That is the actual privacy problem on this site, and no
-- amount of encrypting things in transit touches it, because the data was being handed out
-- correctly encrypted to people who should never have received it at all.
--
-- Dots are the complication. They are counted from the trade record, which means every visitor
-- needs to see THAT trades happened in order to compute anyone's score. So the row splits in two:
-- the fact of a trade stays public, and everything said inside it becomes private.

-- Full offer rows: only the two parties.
drop policy if exists "offers readable by everyone" on public.offers;
drop policy if exists "offers readable by the two parties" on public.offers;
create policy "offers readable by the two parties" on public.offers for select
  using (auth.uid() = owner_id or auth.uid() = from_id);

-- The public half: who traded with whom and how far it got. No `give`, no `msg`, and no asset
-- details — enough to count dots and show an offer tally, and nothing anyone would mind a stranger
-- reading.
--
-- security_invoker = off means the view runs as its owner, so it can see the rows the policy above
-- hides. That is the point of it, and it is also why the column list here is the security boundary:
-- anything added to this select becomes world-readable.
drop view if exists public.offer_signals;
create view public.offer_signals
  with (security_invoker = off) as
  select id, item_id, owner_id, from_id, status, confirm_owner, confirm_from, created_at
  from public.offers;

grant select on public.offer_signals to anon, authenticated;

-- ============================================================================================
-- storage.sql
-- ============================================================================================

-- Dot Trading Post — listing photos.
--
-- Run this in the Supabase SQL editor AFTER schema.sql. Order relative to wallets.sql and
-- privacy.sql does not matter.
--
-- Photos live in a public storage bucket, and the listing row carries their URLs. Public read is
-- the point of a board; the policies below are about who may PUT things there: only a signed-in
-- person, only under a folder named after their own id, and only they may remove what they put.
-- That folder rule is what stops one person overwriting or deleting another's pictures.
--
-- Nothing here strips location data. That happens in the browser before upload (site/photos.js),
-- because by the time bytes reach the bucket they are already public. Phone photos carry GPS
-- coordinates in EXIF, and a board that re-publishes them is handing out home addresses.

alter table public.items
  add column if not exists photos text[] not null default '{}';

-- Up to four photos a listing. A hard cap in the schema, not just the form.
alter table public.items drop constraint if exists items_photos_max;
alter table public.items add constraint items_photos_max check (coalesce(array_length(photos, 1), 0) <= 4);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "photos are public" on storage.objects;
create policy "photos are public" on storage.objects for select
  using (bucket_id = 'photos');

-- The first path segment must be the uploader's own user id.
drop policy if exists "upload into own folder" on storage.objects;
create policy "upload into own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "remove own photos" on storage.objects;
create policy "remove own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Proof-of-item photos: private. Only their uploader can read them back; the verify-item Edge
-- Function reads them with the service role. Nothing about them is public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upload proof into own folder" on storage.objects;
create policy "upload proof into own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "read own proofs" on storage.objects;
create policy "read own proofs" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- The listing-photo read policy must not cover proofs: it is scoped to bucket 'photos' above.

-- ============================================================================================
-- verify.sql
-- ============================================================================================

-- Dot Trading Post — Proof of Item, plus the two missing exits from a trade.
--
-- Run this in the Supabase SQL editor AFTER schema.sql, wallets.sql, privacy.sql and storage.sql.
--
-- PROOF OF ITEM. Lifted from cbay. The person who posted an item writes a note by hand — their
-- name, today's date, and a one-time four-character code the board hands them — and photographs
-- it next to the item. A vision model then reads the handwriting and scores six things: does the
-- name match, is the date today, does the code match character for character, is the item in the
-- frame, is the note real pen on real paper, is the photo an original rather than a screenshot.
-- The code is the part that cannot be prepared in advance; the handwriting is the part that cannot
-- be copied from a listing elsewhere.
--
-- The scoring runs in an Edge Function (supabase/functions/verify-item) because it needs an API
-- key, and a key in a browser is a key everyone has. The function writes the result here with the
-- service role; nothing in the browser can mark an item verified.

create table if not exists public.verifications (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items on delete cascade,
  owner_id    uuid not null references auth.users on delete cascade,
  -- Four characters from an alphabet with no look-alikes: no 0/O, 1/I/L, 2/Z, 5/S, 8/B.
  code        text not null check (code ~ '^[ACDEFGHJKMNPQRTUVWXY3467]{4}$'),
  status      text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'expired')),
  proof_url   text,
  analysis    jsonb,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours',
  verified_at timestamptz
);

create index if not exists verifications_item_idx on public.verifications (item_id, created_at desc);

alter table public.verifications enable row level security;

-- Full rows, code included, are the owner's alone. The code is what makes a proof unforgeable in
-- advance, so it is never readable by anyone else before it has been used.
drop policy if exists "verifications readable by owner" on public.verifications;
create policy "verifications readable by owner" on public.verifications for select
  using (auth.uid() = owner_id);

-- No insert, update or delete policies at all: starting one goes through the function below, and
-- finishing one is the Edge Function's job, with the service role.

-- The public half: which items are verified, when, and the model's one-line read. Not the proof
-- photo: it shows handwriting, a room, whatever else was on the table, and people only need to
-- know the check passed. Proof photos live in the private `proofs` bucket. This select list IS
-- the security boundary.
drop view if exists public.verification_badges;
create view public.verification_badges
  with (security_invoker = off) as
  select id, item_id, owner_id, status, verified_at,
         analysis -> 'scores' ->> 'summary'        as summary,
         (analysis -> 'scores' ->> 'weighted_score')::int as score
  from public.verifications
  where status = 'verified';

grant select on public.verification_badges to anon, authenticated;

-- Start a proof for one of your own open items. Any live pending attempt on the item is expired
-- first, so there is exactly one code in play at a time.
create or replace function public.start_verification(p_item uuid)
returns table (id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare it public.items; alphabet text := 'ACDEFGHJKMNPQRTUVWXY3467'; c text := ''; i int;
begin
  select * into it from public.items where items.id = p_item;
  if not found then raise exception 'item not found'; end if;
  if it.owner_id <> auth.uid() then raise exception 'you can only verify your own items'; end if;
  if it.status <> 'open' then raise exception 'only an item still on the board can be verified'; end if;
  if exists (select 1 from public.verifications v where v.item_id = p_item and v.status = 'verified') then
    raise exception 'this item is already verified';
  end if;

  update public.verifications set status = 'expired'
   where item_id = p_item and status = 'pending';

  for i in 1..4 loop
    c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;

  return query
    insert into public.verifications (item_id, owner_id, code)
    values (p_item, auth.uid(), c)
    returning verifications.id, verifications.code, verifications.expires_at;
end $$;

-- ---------------------------------------------------------------- the two missing exits
--
-- The audit found that once a trade was agreed there was no way out. If one side went quiet the
-- item sat pledged forever, and a pending offer could never be taken back. cbay has withdraw; the
-- cancel after agreement is new — cbay has the same gap.

-- Take back an offer you made, while it is still pending.
create or replace function public.withdraw_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  if o.from_id <> auth.uid() then raise exception 'only the person who made the offer can withdraw it'; end if;
  if o.status <> 'pending' then raise exception 'only a pending offer can be withdrawn'; end if;
  update public.offers set status = 'withdrawn' where id = p_offer;
end $$;

-- Walk away from an agreed trade. Either side may, but only while THEY have not pressed their dot:
-- pressing says "my side arrived", and you do not get to say that and then cancel. The item goes
-- back on the board. The record of the cancellation stays — a negative signal for dots later.
alter table public.offers drop constraint if exists offers_status_check;
alter table public.offers add constraint offers_status_check
  check (status in ('pending', 'agreed', 'done', 'declined', 'cancelled', 'withdrawn'));

alter table public.offers add column if not exists cancelled_by uuid;

create or replace function public.cancel_trade(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  if o.status <> 'agreed' then raise exception 'only an agreed trade can be cancelled'; end if;
  if auth.uid() = o.owner_id then
    if o.confirm_owner then raise exception 'you already confirmed your side arrived'; end if;
  elsif auth.uid() = o.from_id then
    if o.confirm_from then raise exception 'you already confirmed your side arrived'; end if;
  else
    raise exception 'you are not part of this trade';
  end if;
  update public.offers set status = 'cancelled', cancelled_by = auth.uid() where id = p_offer;
  update public.items set status = 'open' where id = o.item_id;
end $$;

-- ============================================================================================
-- location.sql
-- ============================================================================================

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

-- ============================================================================================
-- messages.sql
-- ============================================================================================

-- Dot Trading Post — messages between the two people in a trade.
--
-- Run after schema.sql and privacy.sql (setup.sql runs everything in order).
--
-- Once an offer exists, its two parties need somewhere to say "I can meet Saturday" or "here's
-- my postcode". Before this there was nowhere: an accepted trade had no way to arrange the swap.
-- A thread hangs off each offer and only its two parties can read or write it. Nothing here is
-- public, nothing is editable after sending, and a thread closes for new messages once a trade
-- is declined, withdrawn or cancelled.

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  offer_id    uuid not null references public.offers on delete cascade,
  from_id     uuid not null references auth.users on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index if not exists messages_offer_idx on public.messages (offer_id, created_at);

alter table public.messages enable row level security;

drop policy if exists "messages readable by the two parties" on public.messages;
create policy "messages readable by the two parties" on public.messages for select
  using (exists (
    select 1 from public.offers o
    where o.id = messages.offer_id and (auth.uid() = o.owner_id or auth.uid() = o.from_id)
  ));

drop policy if exists "parties write their own messages" on public.messages;
create policy "parties write their own messages" on public.messages for insert
  with check (
    auth.uid() = from_id
    and exists (
      select 1 from public.offers o
      where o.id = messages.offer_id
        and (auth.uid() = o.owner_id or auth.uid() = o.from_id)
        and o.status in ('pending', 'agreed', 'done')
    )
  );

-- No update or delete policy: what was said stays said.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ============================================================================================
-- trades.sql
-- ============================================================================================

-- Dot Trading Post — protected trades: ship-by dates, "sent" with tracking, no-show claims,
-- atomic NFT swaps, and trade bonds.
--
-- Run after verify.sql (setup.sql runs everything in order).
--
-- THE PROBLEM. Pressing your dot says "mine arrived". Nothing recorded that anyone SENT anything,
-- there was no deadline, and walking away cost nothing. Whoever sent first carried all the risk.
--
-- SENDING. An agreed trade gets a ship-by date four days out. Each side marks its own side sent:
-- posted with a tracking number, handed over in person, or moved on chain. Past the ship-by date,
-- a side that DID send can close the trade against a side that didn't. That records a no-show
-- against them — the first thing on the board that can cost someone dots — and is what decides
-- who forfeits a bond.
--
-- SWAPS. When both sides are NFTs on the same chain, neither has to send first: the lister signs a
-- Seaport order "my NFT for yours", the other side fills it in one transaction, and either both
-- move or neither does. Nobody here ever holds anything.
--
-- BONDS. Either side can put a card hold on a trade through Stripe. A clean trade releases the hold
-- and keeps a small fee; a no-show forfeits theirs to the other side. Stripe holds the money, never
-- this database — the tables below only mirror what Stripe says, and only the bond Edge Function
-- (with the service role) can write them.

-- ---------------------------------------------------------------- sending

alter table public.offers
  add column if not exists ship_by          timestamptz,
  add column if not exists owner_sent_at    timestamptz,
  add column if not exists owner_sent_how   text,
  add column if not exists owner_carrier    text,
  add column if not exists owner_ref        text,
  add column if not exists from_sent_at     timestamptz,
  add column if not exists from_sent_how    text,
  add column if not exists from_carrier     text,
  add column if not exists from_ref         text,
  add column if not exists defaulted_by     uuid,
  add column if not exists swap_order       jsonb,
  add column if not exists swap_sig         text,
  add column if not exists swap_tx          text,
  -- An on-chain send is a claim until the chain confirms it. The notify Edge Function reads the
  -- transaction and records here whether it really moved that NFT to the other side's wallet.
  add column if not exists owner_tx_status  text,
  add column if not exists owner_tx_note    text,
  add column if not exists from_tx_status   text,
  add column if not exists from_tx_note     text;
alter table public.offers drop constraint if exists offers_tx_status;
alter table public.offers add constraint offers_tx_status check (
  (owner_tx_status is null or owner_tx_status in ('checking', 'verified', 'rejected')) and
  (from_tx_status  is null or from_tx_status  in ('checking', 'verified', 'rejected')));
create index if not exists offers_owner_ref_idx on public.offers (lower(owner_ref)) where owner_sent_how = 'onchain';
create index if not exists offers_from_ref_idx on public.offers (lower(from_ref)) where from_sent_how = 'onchain';

-- Whether a side's sending can be checked by someone other than the sender: posted with tracking,
-- or moved on chain and confirmed there. (Sends from before checking existed have no status and
-- keep counting as they did.) A finished trade is "verified" when it was a confirmed on-chain swap
-- or both sides were proven this way — what earns the extra dot.
create or replace function public.side_proven(how text, tx_status text) returns boolean
language sql immutable as $$ select how = 'post' or (how = 'onchain' and coalesce(tx_status, 'verified') = 'verified') $$;
create or replace function public.trade_verified(swap_tx text, owner_how text, owner_status text, from_how text, from_status text) returns boolean
language sql immutable as $$
  select (swap_tx is not null and coalesce(owner_status, 'verified') = 'verified' and coalesce(from_status, 'verified') = 'verified')
      or (coalesce(public.side_proven(owner_how, owner_status), false) and coalesce(public.side_proven(from_how, from_status), false))
$$;
-- Whether a side counts as sent for closing a trade as a no-show: an on-chain send counts while it
-- is being checked (it may be fine) but never once the chain says otherwise. For the person making
-- the claim, only a confirmed one counts — you can't close someone out with an unchecked hash.
create or replace function public.side_sent(sent_at timestamptz, how text, tx_status text, for_claimant boolean) returns boolean
language sql immutable as $$
  select sent_at is not null and (how is distinct from 'onchain'
    or coalesce(tx_status, 'verified') = 'verified'
    or (not for_claimant and tx_status = 'checking'))
$$;

alter table public.offers drop constraint if exists offers_sent_how;
alter table public.offers add constraint offers_sent_how check (
  (owner_sent_how is null or owner_sent_how in ('post', 'in_person', 'onchain')) and
  (from_sent_how  is null or from_sent_how  in ('post', 'in_person', 'onchain')));

-- Agreeing starts the clock. A trigger rather than another copy of accept_offer, so the rule holds
-- however the status gets there.
create or replace function public.offers_start_clock() returns trigger
language plpgsql as $$
begin
  if new.status = 'agreed' and old.status is distinct from 'agreed' and new.ship_by is null then
    new.ship_by := now() + interval '4 days';
  end if;
  return new;
end $$;
drop trigger if exists offers_start_clock on public.offers;
create trigger offers_start_clock before update on public.offers
  for each row execute function public.offers_start_clock();

create or replace function public.mark_sent(p_offer uuid, p_how text, p_carrier text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  if o.status <> 'agreed' then raise exception 'only an agreed trade can be marked sent'; end if;
  if p_how not in ('post', 'in_person', 'onchain') then raise exception 'say how it was sent'; end if;
  if p_how = 'post' and exists (select 1 from public.items where id = o.item_id and local_only) then
    raise exception 'this one is local pickup only — hand it over in person';
  end if;
  if p_how = 'post' and coalesce(btrim(p_ref), '') = '' then raise exception 'add the tracking number'; end if;
  if p_how = 'onchain' and coalesce(p_ref, '') !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'add the transaction hash'; end if;
  if p_how = 'onchain' then
    -- Only an NFT can be sent on chain: the listing's for its owner, the offer's for the offerer.
    if not exists (
      select 1 from public.items it where it.id = o.item_id and (
        (auth.uid() = o.owner_id and it.asset_kind in ('erc721', 'erc1155')) or
        (auth.uid() = o.from_id and o.asset_kind in ('erc721', 'erc1155'))))
    then raise exception 'your side of this trade isn''t an NFT — mark it posted or handed over'; end if;
    if exists (select 1 from public.offers x where x.id <> p_offer and (
         (x.owner_sent_how = 'onchain' and lower(x.owner_ref) = lower(p_ref)) or (x.from_sent_how = 'onchain' and lower(x.from_ref) = lower(p_ref))))
    then raise exception 'that transaction is already recorded for another trade'; end if;
  end if;
  if char_length(coalesce(p_ref, '')) > 80 or char_length(coalesce(p_carrier, '')) > 40 then raise exception 'too long'; end if;
  if auth.uid() = o.owner_id then
    if o.owner_sent_at is not null then raise exception 'you already marked your side sent'; end if;
    update public.offers set owner_sent_at = now(), owner_sent_how = p_how, owner_carrier = nullif(btrim(p_carrier), ''),
      owner_ref = case when p_how = 'onchain' then lower(p_ref) else nullif(btrim(p_ref), '') end,
      owner_tx_status = case when p_how = 'onchain' then 'checking' end, owner_tx_note = null where id = p_offer;
  elsif auth.uid() = o.from_id then
    if o.from_sent_at is not null then raise exception 'you already marked your side sent'; end if;
    update public.offers set from_sent_at = now(), from_sent_how = p_how, from_carrier = nullif(btrim(p_carrier), ''),
      from_ref = case when p_how = 'onchain' then lower(p_ref) else nullif(btrim(p_ref), '') end,
      from_tx_status = case when p_how = 'onchain' then 'checking' end, from_tx_note = null where id = p_offer;
  else
    raise exception 'you are not part of this trade';
  end if;
end $$;

-- Past the ship-by date, a side that sent (or already pressed) can close the trade against a side
-- that did neither. Not available to someone who hasn't sent either: two no-shows is just a
-- cancelled trade, and cancel_trade is right there.
create or replace function public.claim_no_show(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers; me_done boolean; them_done boolean; them uuid;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  if o.status <> 'agreed' then raise exception 'only an agreed trade can be claimed'; end if;
  if o.ship_by is null or now() <= o.ship_by then raise exception 'the ship-by date has not passed yet'; end if;
  if auth.uid() = o.owner_id then
    me_done := public.side_sent(o.owner_sent_at, o.owner_sent_how, o.owner_tx_status, true) or o.confirm_owner;
    them_done := public.side_sent(o.from_sent_at, o.from_sent_how, o.from_tx_status, false) or o.confirm_from; them := o.from_id;
  elsif auth.uid() = o.from_id then
    me_done := public.side_sent(o.from_sent_at, o.from_sent_how, o.from_tx_status, true) or o.confirm_from;
    them_done := public.side_sent(o.owner_sent_at, o.owner_sent_how, o.owner_tx_status, false) or o.confirm_owner; them := o.owner_id;
  else
    raise exception 'you are not part of this trade';
  end if;
  if not me_done then raise exception 'mark your own side sent first (an NFT send counts once the chain confirms it)'; end if;
  if them_done then raise exception 'they marked their side sent — this is not a no-show'; end if;
  update public.offers set status = 'cancelled', cancelled_by = auth.uid(), defaulted_by = them where id = p_offer;
  update public.items set status = 'open' where (id = o.item_id or id = any (o.give_items)) and status = 'pledged';
end $$;

-- Walking away is still allowed, but not after saying your side is on its way.
create or replace function public.cancel_trade(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  if o.status <> 'agreed' then raise exception 'only an agreed trade can be cancelled'; end if;
  if auth.uid() = o.owner_id then
    if o.confirm_owner then raise exception 'you already confirmed your side arrived'; end if;
    if o.owner_sent_at is not null then raise exception 'you already marked your side sent'; end if;
  elsif auth.uid() = o.from_id then
    if o.confirm_from then raise exception 'you already confirmed your side arrived'; end if;
    if o.from_sent_at is not null then raise exception 'you already marked your side sent'; end if;
  else
    raise exception 'you are not part of this trade';
  end if;
  update public.offers set status = 'cancelled', cancelled_by = auth.uid() where id = p_offer;
  update public.items set status = 'open' where (id = o.item_id or id = any (o.give_items)) and status = 'pledged';
end $$;

-- ---------------------------------------------------------------- creating an offer

-- A new offer's owner is whoever owns the item — looked up here, never taken from the browser — and
-- every field the trade functions control starts blank. Before this, a hand-made request could
-- name any "owner", or arrive already agreed, done, vouched for, or carrying a no-show against
-- someone who never traded.
create or replace function public.offers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare it public.items;
begin
  select * into it from public.items where id = new.item_id;
  if not found then raise exception 'item not found'; end if;
  if it.status <> 'open' then raise exception 'this item is no longer on the board'; end if;
  new.owner_id := it.owner_id;
  if new.from_id = new.owner_id then raise exception 'you cannot offer on your own item'; end if;
  -- Listings put into the offer: the offerer's own, still on the board, each once, never the item
  -- being offered on.
  new.give_items := coalesce((select array_agg(distinct g) from unnest(new.give_items) g), '{}');
  if new.item_id = any (new.give_items) then raise exception 'you cannot offer an item for itself'; end if;
  if exists (
    select 1 from unnest(new.give_items) gid left join public.items g on g.id = gid
     where g.id is null or g.owner_id <> new.from_id or g.status <> 'open'
  ) then raise exception 'every listing you put in must be your own and still on the board'; end if;
  new.status := 'pending';
  new.confirm_owner := false; new.confirm_from := false;
  new.cancelled_by := null; new.defaulted_by := null; new.ship_by := null;
  new.owner_sent_at := null; new.owner_sent_how := null; new.owner_carrier := null; new.owner_ref := null;
  new.from_sent_at := null;  new.from_sent_how := null;  new.from_carrier := null;  new.from_ref := null;
  new.swap_order := null; new.swap_sig := null; new.swap_tx := null; new.done_at := null;
  new.owner_tx_status := null; new.owner_tx_note := null; new.from_tx_status := null; new.from_tx_note := null;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists offers_guard on public.offers;
create trigger offers_guard before insert on public.offers
  for each row execute function public.offers_guard();

-- The public half gains the no-show column: it is what costs dots, so everyone must be able to count it.
drop view if exists public.offer_signals;
create view public.offer_signals with (security_invoker = off) as
  select id, item_id, owner_id, from_id, status, confirm_owner, confirm_from, defaulted_by,
         -- how each side sent (not the tracking numbers) and whether it was an on-chain swap: what
         -- makes a finished trade "verified" when dots are counted
         owner_sent_how, from_sent_how, (swap_tx is not null) as swapped, created_at,
         owner_tx_status, from_tx_status,
         public.trade_verified(swap_tx, owner_sent_how, owner_tx_status, from_sent_how, from_tx_status) as verified
  from public.offers;
grant select on public.offer_signals to anon, authenticated;

-- ---------------------------------------------------------------- atomic NFT swaps

-- The lister posts a signed Seaport order. The database checks it is the order this trade agreed
-- — the listed NFT offered, the offered NFT asked for, paid to the lister, at most one more item
-- which must be the native-currency fee — so a signed order can't quietly ask for more. The
-- person filling it checks again in their own browser before sending anything.
create or replace function public.post_swap(p_offer uuid, p_order jsonb, p_sig text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers; it public.items; w text; n int;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  if auth.uid() <> o.owner_id then raise exception 'the lister sets up the swap'; end if;
  if o.status <> 'agreed' then raise exception 'only an agreed trade can be swapped'; end if;
  if o.swap_tx is not null then raise exception 'this trade was already swapped'; end if;
  select * into it from public.items where id = o.item_id;
  if it.asset_kind not in ('erc721', 'erc1155') or o.asset_kind not in ('erc721', 'erc1155') then raise exception 'both sides must be NFTs'; end if;
  if it.asset_chain is distinct from o.asset_chain then raise exception 'both NFTs must be on the same chain'; end if;
  select lower(wallet_address) into w from public.profiles where id = o.owner_id;
  if w is null or lower(p_order->>'offerer') <> w then raise exception 'the order must come from your linked wallet'; end if;
  if jsonb_array_length(p_order->'offer') <> 1 then raise exception 'the order must offer exactly your item'; end if;
  if lower(p_order->'offer'->0->>'token') <> lower(it.asset_contract) or p_order->'offer'->0->>'identifierOrCriteria' <> it.asset_token_id then
    raise exception 'the order does not offer the listed item'; end if;
  n := jsonb_array_length(p_order->'consideration');
  if n < 1 or n > 2 then raise exception 'unexpected order shape'; end if;
  if lower(p_order->'consideration'->0->>'token') <> lower(o.asset_contract)
     or p_order->'consideration'->0->>'identifierOrCriteria' <> o.asset_token_id
     or lower(p_order->'consideration'->0->>'recipient') <> w then
    raise exception 'the order does not ask for the offered item'; end if;
  if n = 2 and (p_order->'consideration'->1->>'itemType') <> '0' then raise exception 'the second item may only be the fee'; end if;
  if coalesce(p_sig, '') !~ '^0x[0-9a-fA-F]{128,132}$' then raise exception 'bad signature'; end if;
  update public.offers set swap_order = p_order, swap_sig = p_sig where id = p_offer;
end $$;

-- After filling the order, the other side records the transaction. That is "sent" for both sides.
create or replace function public.record_swap(p_offer uuid, p_tx text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  if auth.uid() <> o.from_id then raise exception 'the person filling the swap records it'; end if;
  if o.status <> 'agreed' or o.swap_order is null then raise exception 'there is no swap to record'; end if;
  if coalesce(p_tx, '') !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'bad transaction hash'; end if;
  if exists (select 1 from public.offers x where x.id <> p_offer and (lower(x.swap_tx) = lower(p_tx)
       or (x.owner_sent_how = 'onchain' and lower(x.owner_ref) = lower(p_tx)) or (x.from_sent_how = 'onchain' and lower(x.from_ref) = lower(p_tx))))
  then raise exception 'that transaction is already recorded for another trade'; end if;
  -- Both NFTs should move in this one transaction; the chain is checked for each before either counts.
  update public.offers set swap_tx = lower(p_tx), owner_tx_status = 'checking', from_tx_status = 'checking', owner_tx_note = null, from_tx_note = null,
    owner_sent_at = coalesce(owner_sent_at, now()), owner_sent_how = coalesce(owner_sent_how, 'onchain'), owner_ref = coalesce(owner_ref, lower(p_tx)),
    from_sent_at  = coalesce(from_sent_at, now()),  from_sent_how  = coalesce(from_sent_how, 'onchain'),  from_ref  = coalesce(from_ref, lower(p_tx))
  where id = p_offer;
end $$;

-- What the chain said about an on-chain send. Only the notify Edge Function (service role) calls
-- this. A rejected send is undone, so the person can mark it again with the right transaction; if
-- it was a swap, the swap record goes too.
create or replace function public.record_delivery(p_offer uuid, p_side text, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found or p_side not in ('owner', 'from') then return; end if;
  if p_side = 'owner' then
    if o.owner_tx_status is distinct from 'checking' then return; end if;
    if p_ok then update public.offers set owner_tx_status = 'verified', owner_tx_note = left(p_note, 200) where id = p_offer;
    else update public.offers set owner_tx_status = 'rejected', owner_tx_note = left(p_note, 200),
      owner_sent_at = null, owner_sent_how = null, owner_ref = null,
      swap_tx = case when swap_tx = o.owner_ref then null else swap_tx end where id = p_offer;
    end if;
  else
    if o.from_tx_status is distinct from 'checking' then return; end if;
    if p_ok then update public.offers set from_tx_status = 'verified', from_tx_note = left(p_note, 200) where id = p_offer;
    else update public.offers set from_tx_status = 'rejected', from_tx_note = left(p_note, 200),
      from_sent_at = null, from_sent_how = null, from_ref = null,
      swap_tx = case when swap_tx = o.from_ref then null else swap_tx end where id = p_offer;
    end if;
  end if;
end $$;
revoke execute on function public.record_delivery(uuid, text, boolean, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_delivery(uuid, text, boolean, text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------- bonds

create table if not exists public.bonds (
  id              uuid primary key default gen_random_uuid(),
  offer_id        uuid not null references public.offers on delete cascade,
  user_id         uuid not null references auth.users on delete cascade,
  amount_cents    integer not null check (amount_cents > 0),
  fee_cents       integer not null check (fee_cents >= 0),
  checkout_id     text,
  payment_intent  text,
  status          text not null default 'pending'
                  check (status in ('pending', 'held', 'released', 'forfeited', 'expired', 'failed')),
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,
  unique (offer_id, user_id)
);
alter table public.bonds enable row level security;
drop policy if exists "bonds readable by the two parties" on public.bonds;
create policy "bonds readable by the two parties" on public.bonds for select using (exists (
  select 1 from public.offers o where o.id = bonds.offer_id and (auth.uid() = o.owner_id or auth.uid() = o.from_id)));

-- A forfeited bond becomes money owed to the other side. Nothing is paid until someone running the
-- board sets approved = true (Table Editor) — tracking numbers can be faked, so a human looks first.
create table if not exists public.payouts (
  id            uuid primary key default gen_random_uuid(),
  bond_id       uuid not null unique references public.bonds on delete cascade,
  user_id       uuid not null references auth.users on delete cascade,
  amount_cents  integer not null check (amount_cents > 0),
  approved      boolean not null default false,
  status        text not null default 'owed' check (status in ('owed', 'paid')),
  transfer_id   text,
  created_at    timestamptz not null default now(),
  paid_at       timestamptz
);
alter table public.payouts enable row level security;
drop policy if exists "payouts readable by their recipient" on public.payouts;
create policy "payouts readable by their recipient" on public.payouts for select using (auth.uid() = user_id);

-- Stripe Connect account per person, for receiving a forfeited bond. Private to its owner.
create table if not exists public.stripe_accounts (
  user_id     uuid primary key references auth.users on delete cascade,
  account_id  text not null,
  created_at  timestamptz not null default now()
);
alter table public.stripe_accounts enable row level security;
drop policy if exists "stripe account readable by its owner" on public.stripe_accounts;
create policy "stripe account readable by its owner" on public.stripe_accounts for select using (auth.uid() = user_id);

-- No insert/update/delete policies on bonds, payouts or stripe_accounts: only the bond Edge
-- Function, with the service role, writes them.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bonds') then
    alter publication supabase_realtime add table public.bonds;
  end if;
end $$;

-- ============================================================================================
-- aliases.sql
-- ============================================================================================

-- Dot Trading Post — what people call things.
--
-- Run before matching.sql (setup.sql runs everything in order).
--
-- People write the same thing many ways: PS5, PlayStation 5, ps 5; Pokémon, pokemon tcg, pkmn.
-- Each phrase here names a thing: the first term is what it is, and the rest are broader things
-- it also counts as. A listing that HAS "Charizard" gets charizard, pokemon and tcg as keywords,
-- so someone who wants "pokemon cards" finds it. A listing that WANTS "Charizard" gets only
-- charizard, so it isn't matched with every Pokémon card on the board. Matching only ever widens
-- in the direction that is true.
--
-- Add a row to teach the board a new name; then bump match_terms_version in matching.sql so
-- existing listings are re-read.

create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;

create table if not exists public.match_aliases (
  phrase text primary key check (phrase ~ '^[a-z0-9]+( [a-z0-9]+)*$'),
  terms  text[] not null check (cardinality(terms) between 1 and 8)
);
alter table public.match_aliases enable row level security;
drop policy if exists "aliases are public" on public.match_aliases;
create policy "aliases are public" on public.match_aliases for select using (true);

-- Lowercase, accents off (Pokémon = Pokemon), anything else a single space, padded with spaces
-- so a phrase can be found as whole words.
create or replace function public.match_norm(t text) returns text
language sql immutable as $$
  select ' ' || btrim(regexp_replace(translate(lower(coalesce(t, '')), 'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçýÿ', 'aaaaaaaeeeeeiiiiiooooooouuuuuncyy'), '[^a-z0-9]+', ' ', 'g')) || ' '
$$;

insert into public.match_aliases (phrase, terms) values
  ('pokemon', '{pokemon,tcg}'),
  ('pokemon tcg', '{pokemon,tcg}'),
  ('pokemon card', '{pokemon,tcg}'),
  ('pokemon cards', '{pokemon,tcg}'),
  ('pkmn', '{pokemon,tcg}'),
  ('ptcg', '{pokemon,tcg}'),
  ('pikachu', '{pikachu,pokemon,tcg}'),
  ('charizard', '{charizard,pokemon,tcg}'),
  ('mewtwo', '{mewtwo,pokemon,tcg}'),
  ('mew', '{mew,pokemon,tcg}'),
  ('eevee', '{eevee,pokemon,tcg}'),
  ('blastoise', '{blastoise,pokemon,tcg}'),
  ('venusaur', '{venusaur,pokemon,tcg}'),
  ('gengar', '{gengar,pokemon,tcg}'),
  ('lugia', '{lugia,pokemon,tcg}'),
  ('umbreon', '{umbreon,pokemon,tcg}'),
  ('rayquaza', '{rayquaza,pokemon,tcg}'),
  ('snorlax', '{snorlax,pokemon,tcg}'),
  ('gyarados', '{gyarados,pokemon,tcg}'),
  ('dragonite', '{dragonite,pokemon,tcg}'),
  ('magic the gathering', '{mtg,tcg}'),
  ('magic gathering', '{mtg,tcg}'),
  ('mtg', '{mtg,tcg}'),
  ('yu gi oh', '{yugioh,tcg}'),
  ('yugioh', '{yugioh,tcg}'),
  ('ygo', '{yugioh,tcg}'),
  ('one piece tcg', '{onepiece,tcg}'),
  ('one piece card', '{onepiece,tcg}'),
  ('one piece cards', '{onepiece,tcg}'),
  ('lorcana', '{lorcana,tcg}'),
  ('disney lorcana', '{lorcana,tcg}'),
  ('sports card', '{sportscard}'),
  ('sports cards', '{sportscard}'),
  ('baseball card', '{sportscard}'),
  ('baseball cards', '{sportscard}'),
  ('basketball card', '{sportscard}'),
  ('basketball cards', '{sportscard}'),
  ('football card', '{sportscard}'),
  ('football cards', '{sportscard}'),
  ('hockey card', '{sportscard}'),
  ('hockey cards', '{sportscard}'),
  ('topps', '{topps,sportscard}'),
  ('panini', '{panini,sportscard}'),
  ('prizm', '{panini,sportscard}'),
  ('psa', '{graded}'),
  ('bgs', '{graded}'),
  ('cgc', '{graded}'),
  ('beckett', '{graded}'),
  ('graded', '{graded}'),
  ('ngc', '{graded}'),
  ('pcgs', '{graded}'),
  ('slab', '{graded}'),
  ('slabbed', '{graded}'),
  ('booster box', '{booster,sealed,tcg}'),
  ('booster boxes', '{booster,sealed,tcg}'),
  ('booster pack', '{booster,sealed,tcg}'),
  ('booster packs', '{booster,sealed,tcg}'),
  ('etb', '{etb,sealed,pokemon,tcg}'),
  ('elite trainer box', '{etb,sealed,pokemon,tcg}'),
  ('ps5', '{ps5,playstation,sony,console}'),
  ('ps 5', '{ps5,playstation,sony,console}'),
  ('playstation 5', '{ps5,playstation,sony,console}'),
  ('playstation five', '{ps5,playstation,sony,console}'),
  ('ps4', '{ps4,playstation,sony,console}'),
  ('ps 4', '{ps4,playstation,sony,console}'),
  ('playstation 4', '{ps4,playstation,sony,console}'),
  ('playstation four', '{ps4,playstation,sony,console}'),
  ('ps3', '{ps3,playstation,sony,console,retro}'),
  ('ps 3', '{ps3,playstation,sony,console,retro}'),
  ('playstation 3', '{ps3,playstation,sony,console,retro}'),
  ('ps2', '{ps2,playstation,sony,console,retro}'),
  ('ps 2', '{ps2,playstation,sony,console,retro}'),
  ('playstation 2', '{ps2,playstation,sony,console,retro}'),
  ('ps1', '{ps1,playstation,sony,console,retro}'),
  ('psx', '{ps1,playstation,sony,console,retro}'),
  ('psone', '{ps1,playstation,sony,console,retro}'),
  ('ps one', '{ps1,playstation,sony,console,retro}'),
  ('playstation 1', '{ps1,playstation,sony,console,retro}'),
  ('psp', '{psp,playstation,sony,handheld}'),
  ('ps vita', '{vita,playstation,sony,handheld}'),
  ('psvita', '{vita,playstation,sony,handheld}'),
  ('playstation vita', '{vita,playstation,sony,handheld}'),
  ('playstation', '{playstation,sony,console}'),
  ('xbox series x', '{xboxseries,xbox,microsoft,console}'),
  ('xbox series s', '{xboxseries,xbox,microsoft,console}'),
  ('series x', '{xboxseries,xbox,microsoft,console}'),
  ('series s', '{xboxseries,xbox,microsoft,console}'),
  ('xbox one', '{xboxone,xbox,microsoft,console}'),
  ('xbox 360', '{xbox360,xbox,microsoft,console,retro}'),
  ('original xbox', '{xboxog,xbox,microsoft,console,retro}'),
  ('xbox', '{xbox,microsoft,console}'),
  ('nintendo switch', '{switch,nintendo,console}'),
  ('switch oled', '{switch,nintendo,console}'),
  ('switch lite', '{switch,nintendo,console}'),
  ('switch 2', '{switch,nintendo,console}'),
  ('nintendo switch 2', '{switch,nintendo,console}'),
  ('n64', '{n64,nintendo,console,retro}'),
  ('nintendo 64', '{n64,nintendo,console,retro}'),
  ('snes', '{snes,nintendo,console,retro}'),
  ('super nintendo', '{snes,nintendo,console,retro}'),
  ('super nes', '{snes,nintendo,console,retro}'),
  ('super famicom', '{snes,nintendo,console,retro}'),
  ('nes', '{nes,nintendo,console,retro}'),
  ('famicom', '{nes,nintendo,console,retro}'),
  ('nintendo entertainment system', '{nes,nintendo,console,retro}'),
  ('gamecube', '{gamecube,nintendo,console,retro}'),
  ('game cube', '{gamecube,nintendo,console,retro}'),
  ('wii u', '{wiiu,nintendo,console}'),
  ('wiiu', '{wiiu,nintendo,console}'),
  ('wii', '{wii,nintendo,console}'),
  ('game boy', '{gameboy,nintendo,handheld,retro}'),
  ('gameboy', '{gameboy,nintendo,handheld,retro}'),
  ('game boy color', '{gbc,gameboy,nintendo,handheld,retro}'),
  ('gameboy color', '{gbc,gameboy,nintendo,handheld,retro}'),
  ('gbc', '{gbc,gameboy,nintendo,handheld,retro}'),
  ('game boy advance', '{gba,gameboy,nintendo,handheld,retro}'),
  ('gameboy advance', '{gba,gameboy,nintendo,handheld,retro}'),
  ('gba', '{gba,gameboy,nintendo,handheld,retro}'),
  ('gba sp', '{gba,gameboy,nintendo,handheld,retro}'),
  ('nintendo ds', '{ds,nintendo,handheld}'),
  ('nds', '{ds,nintendo,handheld}'),
  ('ds lite', '{ds,nintendo,handheld}'),
  ('dsi', '{ds,nintendo,handheld}'),
  ('3ds', '{3ds,nintendo,handheld}'),
  ('2ds', '{3ds,nintendo,handheld}'),
  ('new 3ds', '{3ds,nintendo,handheld}'),
  ('3ds xl', '{3ds,nintendo,handheld}'),
  ('nintendo', '{nintendo}'),
  ('sega genesis', '{genesis,sega,console,retro}'),
  ('mega drive', '{genesis,sega,console,retro}'),
  ('megadrive', '{genesis,sega,console,retro}'),
  ('genesis console', '{genesis,sega,console,retro}'),
  ('dreamcast', '{dreamcast,sega,console,retro}'),
  ('sega saturn', '{saturn,sega,console,retro}'),
  ('game gear', '{gamegear,sega,handheld,retro}'),
  ('master system', '{mastersystem,sega,console,retro}'),
  ('sega', '{sega}'),
  ('atari', '{atari,console,retro}'),
  ('atari 2600', '{atari,console,retro}'),
  ('neo geo', '{neogeo,console,retro}'),
  ('neogeo', '{neogeo,console,retro}'),
  ('steam deck', '{steamdeck,handheld,valve}'),
  ('rog ally', '{rogally,handheld}'),
  ('retro game', '{retro}'),
  ('retro games', '{retro}'),
  ('retro gaming', '{retro}'),
  ('vintage game', '{retro}'),
  ('vintage games', '{retro}'),
  ('cartridge', '{cartridge}'),
  ('cartridges', '{cartridge}'),
  ('cart', '{cartridge}'),
  ('carts', '{cartridge}'),
  ('cib', '{cib}'),
  ('complete in box', '{cib}'),
  ('video game', '{videogame}'),
  ('video games', '{videogame}'),
  ('console', '{console}'),
  ('consoles', '{console}'),
  ('handheld', '{handheld}'),
  ('handhelds', '{handheld}'),
  ('funko', '{funko,figure}'),
  ('funko pop', '{funko,figure}'),
  ('funko pops', '{funko,figure}'),
  ('pop vinyl', '{funko,figure}'),
  ('lego', '{lego}'),
  ('legos', '{lego}'),
  ('hot wheels', '{diecast}'),
  ('hotwheels', '{diecast}'),
  ('matchbox car', '{diecast}'),
  ('matchbox cars', '{diecast}'),
  ('diecast', '{diecast}'),
  ('die cast', '{diecast}'),
  ('beanie baby', '{beanie}'),
  ('beanie babies', '{beanie}'),
  ('action figure', '{figure}'),
  ('action figures', '{figure}'),
  ('figurine', '{figure}'),
  ('figurines', '{figure}'),
  ('comic', '{comic}'),
  ('comics', '{comic}'),
  ('comic book', '{comic}'),
  ('comic books', '{comic}'),
  ('graphic novel', '{comic}'),
  ('vinyl record', '{vinyl,music}'),
  ('vinyl records', '{vinyl,music}'),
  ('lp', '{vinyl,music}'),
  ('lps', '{vinyl,music}'),
  ('vinyl', '{vinyl}'),
  ('iphone', '{iphone,apple,phone}'),
  ('ipad', '{ipad,apple,tablet}'),
  ('macbook', '{macbook,apple,laptop}'),
  ('airpods', '{airpods,apple,headphones}'),
  ('laptop', '{laptop}'),
  ('laptops', '{laptop}'),
  ('notebook computer', '{laptop}'),
  ('headphones', '{headphones}'),
  ('earbuds', '{headphones}')
on conflict (phrase) do update set terms = excluded.terms;

-- ============================================================================================
-- matching.sql
-- ============================================================================================

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

create or replace function public.items_terms() returns trigger
language plpgsql as $$
begin
  new.have_terms := public.match_terms(coalesce(new.title, '') || ' ' || coalesce(new.descr, ''), 'have');
  new.want_terms := public.match_terms(new.want, 'want');
  return new;
end $$;
drop trigger if exists items_terms on public.items;
create trigger items_terms before insert or update of title, descr, want on public.items
  for each row execute function public.items_terms();
-- Re-read every listing and saved search when the way keywords are made changes. Bump the
-- version whenever match_terms or the alias list changes meaningfully.
do $$
begin
  if coalesce((select value from public.app_config where key = 'match_terms_version'), '') <> '2' then
    update public.items set have_terms = public.match_terms(coalesce(title, '') || ' ' || coalesce(descr, ''), 'have'),
                            want_terms = public.match_terms(want, 'want');
    insert into public.app_config (key, value) values ('match_terms_version', '2')
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

-- ============================================================================================
-- notifications.sql
-- ============================================================================================

-- Dot Trading Post — email notifications.
--
-- Run after matching.sql (setup.sql runs everything in order). Needs the `notify` Edge Function
-- deployed to send anything; until then the triggers below simply knock on a door nobody answers.
--
-- People only learned about an offer or a message by opening the board. Now the database tells
-- the notify function when something happens — an offer arrives, one is accepted, a message is
-- sent, a listing goes up, a trade closes as a no-show — and a daily sweep catches ship-by dates
-- due tomorrow. The function works out who to tell and sends the email. It is told only WHAT
-- happened (a kind and an id); it reads everything else itself, so a forged call can at most
-- prompt an email that was due anyway, and each email is recorded so it can never go twice.

alter table public.profiles add column if not exists email_notify boolean not null default true;
-- Which kinds of email, under that switch. A kind set to false is off; anything missing is on.
-- Kinds: offers, trades (accepted, no-shows), messages, matches (saved searches, mutual matches),
-- reminders (ship-by).
alter table public.profiles add column if not exists email_prefs jsonb not null default '{}';
alter table public.profiles drop constraint if exists profiles_email_prefs_object;
alter table public.profiles add constraint profiles_email_prefs_object check (jsonb_typeof(email_prefs) = 'object');

-- What has been sent. Written only by the notify function (service role); no policies.
create table if not exists public.notifications_sent (
  key         text primary key,
  user_id     uuid,
  kind        text,
  created_at  timestamptz not null default now()
);
alter table public.notifications_sent enable row level security;

-- Where the functions live. Public information (it is in site/config.js too); kept here so the
-- triggers know where to knock. Change it if the project moves.
create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;
insert into public.app_config (key, value)
values ('functions_url', 'https://yujxwfghmauajrpduagl.supabase.co/functions/v1')
on conflict (key) do nothing;
-- The notify function's address. Supabase's editor can give a new function a random address
-- (e.g. "clever-function") whatever its label says; set this to the last part of its URL.
insert into public.app_config (key, value) values ('notify_function', 'notify') on conflict (key) do nothing;

-- pg_net lets the database make an HTTP call without waiting for it. On Supabase it is available;
-- elsewhere (a local test database) it may not be, and notifications are then simply off.
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net not available here: notifications stay off';
end $$;

create or replace function public.notify_event(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare base text; fn text;
begin
  if to_regproc('net.http_post') is null then return; end if;
  select value into base from public.app_config where key = 'functions_url';
  if base is null then return; end if;
  select value into fn from public.app_config where key = 'notify_function';
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using base || '/' || coalesce(nullif(btrim(fn), ''), 'notify'), jsonb_build_object('kind', p_kind, 'id', p_id), '{"Content-Type": "application/json"}'::jsonb;
exception when others then
  raise warning 'notify_event % % failed: %', p_kind, p_id, sqlerrm;   -- never let an email break a trade
end $$;
revoke execute on function public.notify_event(text, uuid) from public, anon, authenticated;

create or replace function public.notify_offers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.notify_event('offer', new.id);
  elsif new.status is distinct from old.status then
    if new.status = 'agreed' then perform public.notify_event('accepted', new.id);
    elsif new.status = 'cancelled' and new.defaulted_by is not null then perform public.notify_event('noshow', new.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists notify_offers on public.offers;
create trigger notify_offers after insert or update of status on public.offers
  for each row execute function public.notify_offers();

-- An on-chain send waiting to be checked: ask the function to read the chain now.
create or replace function public.notify_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.owner_tx_status = 'checking' and old.owner_tx_status is distinct from 'checking')
     or (new.from_tx_status = 'checking' and old.from_tx_status is distinct from 'checking') then
    perform public.notify_event('verify_tx', new.id);
  end if;
  return null;
end $$;
drop trigger if exists notify_delivery on public.offers;
create trigger notify_delivery after update of owner_tx_status, from_tx_status on public.offers
  for each row execute function public.notify_delivery();

create or replace function public.notify_messages() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.notify_event('message', new.id); return null; end $$;
drop trigger if exists notify_messages on public.messages;
create trigger notify_messages after insert on public.messages
  for each row execute function public.notify_messages();

create or replace function public.notify_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.notify_event('listing', new.id); return null; end $$;
drop trigger if exists notify_items on public.items;
create trigger notify_items after insert on public.items
  for each row execute function public.notify_items();

-- Who a new listing should be mentioned to: people whose saved search it fits, and owners of
-- listings it is a mutual match for. Only the notify function (service role) may ask — saved
-- searches are private.
create or replace function public.listing_alert_targets(p_item uuid)
returns table (user_id uuid, kind text, label text, other_item uuid)
language sql stable security definer set search_path = public as $$
  select distinct on (w.user_id) w.user_id, 'search'::text, coalesce(nullif(w.label, ''), array_to_string(w.cats, ', ')), null::uuid
  from public.items x join public.saved_wants w on w.user_id <> x.owner_id and public.search_fits(w, x)
  where x.id = p_item and x.status = 'open'
  union all
  select y.owner_id, 'mutual'::text, y.title, y.id
  from public.items x join public.items y on y.status = 'open' and y.owner_id <> x.owner_id
   and public.wants_item(y.want_cats, y.want_terms, x) and public.wants_item(x.want_cats, x.want_terms, y)
  where x.id = p_item and x.status = 'open';
$$;
revoke execute on function public.listing_alert_targets(uuid) from public, anon, authenticated;
grant execute on function public.listing_alert_targets(uuid) to service_role;

-- A daily nudge for trades whose ship-by date is within a day. pg_cron is available on Supabase;
-- where it isn't, there is simply no reminder.
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'dtp-shipby';
  perform cron.schedule('dtp-shipby', '7 14 * * *', $job$ select public.notify_event('shipby_sweep', null) $job$);
  -- Transactions the chain hadn't confirmed yet when they were first checked: look again.
  perform cron.unschedule(jobid) from cron.job where jobname = 'dtp-verify';
  perform cron.schedule('dtp-verify', '*/10 * * * *', $job$ select public.notify_event('verify_sweep', null) where exists (select 1 from public.offers where owner_tx_status = 'checking' or from_tx_status = 'checking') $job$);
exception when others then raise notice 'pg_cron not available here: no ship-by reminders';
end $$;

-- ============================================================================================
-- history.sql
-- ============================================================================================

-- Dot Trading Post — finished trades, for everyone to see.
--
-- Run this in the Supabase SQL editor AFTER trades.sql (setup.sql does it in order).
--
-- Offers are private to their two parties while they are being worked out. Once both dots are
-- pressed the trade is done, and what was swapped for what becomes part of the board's record:
-- the item, what the other side gave (their words, any listings they put in, any token), who the
-- two traders were, and when. Messages, tracking numbers and anything said in the offer stay
-- private. Only finished trades appear here — never pending, declined or cancelled ones.

drop view if exists public.trade_history;
create view public.trade_history with (security_invoker = off) as
  select o.id, o.item_id, o.owner_id, o.from_id, o.give, o.give_items,
         o.asset_kind, o.asset_chain, o.asset_contract, o.asset_token_id,
         coalesce(o.done_at, o.created_at) as done_at,
         (o.swap_tx is not null) as swapped,
         public.trade_verified(o.swap_tx, o.owner_sent_how, o.owner_tx_status, o.from_sent_how, o.from_tx_status) as tracked
  from public.offers o
  where o.status = 'done';
grant select on public.trade_history to anon, authenticated;

create index if not exists offers_done_idx on public.offers (done_at desc) where status = 'done';

-- ============================================================================================
-- scale.sql
-- ============================================================================================

-- Dot Trading Post — the board, a page at a time, and each trader's record added up here.
--
-- Run after history.sql (setup.sql runs everything in order).
--
-- The board used to fetch hundreds of listings, profiles and trade records and do the sums in
-- the browser. These let it ask for one page of listings, filtered here, and for the record of
-- only the traders on screen.

-- Each trader's record — the same rules the board uses to count dots, in one place:
--   a finished trade with someone counts 2 the first time, 1 the second, nothing after;
--   it counts once more (at the same weight) when it was tracked both ways or swapped on chain;
--   +1 for each different person who pressed their dot for you; +1 for a filled-in profile;
--   −3 for every trade you agreed and never sent.
-- Runs as the database owner and returns only these totals, never the offers behind them.
create or replace function public.trader_stats(p_ids uuid[])
returns table (user_id uuid, dots integer, trades integer, partners integer, verified integer, vouches integer, profile integer, no_shows integer)
language sql stable security definer set search_path = public as $$
  with ids as (select distinct unnest(p_ids[1:500]) as id),
  seen as (
    select i.id, o.id as offer_id, o.status, o.created_at,
           case when o.from_id = i.id then o.owner_id else o.from_id end as partner,
           case when o.from_id = i.id then o.confirm_owner else o.confirm_from end as vouched_me,
           public.trade_verified(o.swap_tx, o.owner_sent_how, o.owner_tx_status, o.from_sent_how, o.from_tx_status) as ver
    from ids i join public.offers o on o.from_id = i.id or o.owner_id = i.id
  ),
  done as (
    select id, partner, ver,
           case row_number() over (partition by id, partner order by created_at, offer_id) when 1 then 1.0 when 2 then 0.5 else 0 end as w
    from seen where status = 'done'
  ),
  t as (
    select id, count(*)::int as trades, count(distinct partner)::int as partners, count(*) filter (where ver)::int as verified,
           sum(2 * w) as trade_pts, coalesce(sum(w) filter (where ver), 0) as verified_pts
    from done group by id
  ),
  v as (select id, count(distinct partner)::int as vouches from seen where vouched_me group by id),
  n as (select i.id, count(o.id)::int as no_shows from ids i join public.offers o on o.defaulted_by = i.id group by i.id)
  select i.id,
         greatest(0, floor(coalesce(t.trade_pts, 0) + coalesce(t.verified_pts, 0) + coalesce(v.vouches, 0)
           + (case when coalesce(p.area, '') <> '' or coalesce(p.note, '') <> '' then 1 else 0 end) - 3 * coalesce(n.no_shows, 0)))::int,
         coalesce(t.trades, 0), coalesce(t.partners, 0), coalesce(t.verified, 0), coalesce(v.vouches, 0),
         (case when coalesce(p.area, '') <> '' or coalesce(p.note, '') <> '' then 1 else 0 end),
         coalesce(n.no_shows, 0)
  from ids i
  left join t on t.id = i.id left join v on v.id = i.id left join n on n.id = i.id
  left join public.profiles p on p.id = i.id;
$$;
grant execute on function public.trader_stats(uuid[]) to anon, authenticated;

-- One page of the board: open listings, newest first, older than p_before, filtered by category,
-- by words (in the title, details or want, or by matching keyword), and by distance from a point.
-- Listings are public; this runs as the caller.
create or replace function public.board_page(
  p_cat text default null, p_q text default null,
  p_lat double precision default null, p_lng double precision default null, p_km double precision default null,
  p_before timestamptz default null, p_limit integer default 30)
returns setof public.items
language sql stable set search_path = public as $$
  select x.* from public.items x
  left join public.profiles p on p.id = x.owner_id
  where x.status = 'open'
    and (nullif(p_cat, '') is null or x.cat = p_cat)
    and (p_before is null or x.created_at < p_before)
    and (nullif(btrim(p_q), '') is null
         or position(lower(btrim(p_q)) in lower(x.title || ' ' || x.descr || ' ' || x.want)) > 0
         or x.have_terms && public.match_terms(p_q, 'want'))
    and (p_km is null or p_lat is null or p_lng is null
         or (p.lat is not null and 111 * sqrt(power(p.lat - p_lat, 2) + power((p.lng - p_lng) * cos(radians(p_lat)), 2)) <= p_km))
  order by x.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 120);
$$;
grant execute on function public.board_page(text, text, double precision, double precision, double precision, timestamptz, integer) to anon, authenticated;

create index if not exists items_open_created_idx on public.items (created_at desc) where status = 'open';
create index if not exists offers_from_idx on public.offers (from_id);
create index if not exists offers_owner_idx on public.offers (owner_id);
create index if not exists offers_defaulted_idx on public.offers (defaulted_by) where defaulted_by is not null;
