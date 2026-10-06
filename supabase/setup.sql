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

-- Give every new account a profile row so names resolve from the first visit.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, split_part(coalesce(new.email, 'trader'), '@', 1))
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
  status      text not null default 'open' check (status in ('open', 'pledged', 'traded')),
  created_at  timestamptz not null default now()
);

create index if not exists items_created_idx on public.items (created_at desc);
create index if not exists items_owner_idx on public.items (owner_id);

alter table public.items enable row level security;

drop policy if exists "items readable by everyone" on public.items;
create policy "items readable by everyone" on public.items for select using (true);

drop policy if exists "insert own item" on public.items;
create policy "insert own item" on public.items for insert with check (auth.uid() = owner_id);

drop policy if exists "update own item" on public.items;
create policy "update own item" on public.items for update using (auth.uid() = owner_id);

drop policy if exists "delete own item" on public.items;
create policy "delete own item" on public.items for delete using (auth.uid() = owner_id);

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

create index if not exists offers_item_idx on public.offers (item_id);
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
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer;
  if not found then raise exception 'offer not found'; end if;
  if o.owner_id <> auth.uid() then raise exception 'only the person who posted the item can accept'; end if;
  if o.status <> 'pending' then raise exception 'this offer is no longer pending'; end if;

  update public.offers set status = 'agreed' where id = p_offer;
  update public.items  set status = 'pledged' where id = o.item_id;
  -- Every other open offer on that item is now moot.
  update public.offers set status = 'declined'
   where item_id = o.item_id and id <> p_offer and status = 'pending';
end $$;

create or replace function public.decline_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer;
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
  select * into o from public.offers where id = p_offer;
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
    update public.offers set status = 'done' where id = p_offer;
    update public.items  set status = 'traded' where id = o.item_id;
  end if;
end $$;

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

-- The public half: which items are verified, with the proof photo and the model's one-line read.
-- Same shape as offer_signals, and the same rule — this select list IS the security boundary.
drop view if exists public.verification_badges;
create view public.verification_badges
  with (security_invoker = off) as
  select id, item_id, owner_id, status, proof_url, verified_at,
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
  select * into o from public.offers where id = p_offer;
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
  select * into o from public.offers where id = p_offer;
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
-- Coordinates are stored rounded to two decimals (about a kilometre) by the board before they are
-- sent, and the board never asks for more than that. Profiles are public, so this is the right
-- grain: enough to say "12 miles away", not enough to find a front door.

alter table public.profiles
  add column if not exists lat double precision,
  add column if not exists lng double precision;

alter table public.profiles drop constraint if exists profiles_latlng_range;
alter table public.profiles add constraint profiles_latlng_range
  check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180));

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
