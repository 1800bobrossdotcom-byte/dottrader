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
  add column if not exists swap_tx          text;

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
  if p_how = 'post' and coalesce(btrim(p_ref), '') = '' then raise exception 'add the tracking number'; end if;
  if p_how = 'onchain' and coalesce(p_ref, '') !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'add the transaction hash'; end if;
  if char_length(coalesce(p_ref, '')) > 80 or char_length(coalesce(p_carrier, '')) > 40 then raise exception 'too long'; end if;
  if auth.uid() = o.owner_id then
    if o.owner_sent_at is not null then raise exception 'you already marked your side sent'; end if;
    update public.offers set owner_sent_at = now(), owner_sent_how = p_how, owner_carrier = nullif(btrim(p_carrier), ''), owner_ref = nullif(btrim(p_ref), '') where id = p_offer;
  elsif auth.uid() = o.from_id then
    if o.from_sent_at is not null then raise exception 'you already marked your side sent'; end if;
    update public.offers set from_sent_at = now(), from_sent_how = p_how, from_carrier = nullif(btrim(p_carrier), ''), from_ref = nullif(btrim(p_ref), '') where id = p_offer;
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
    me_done := o.owner_sent_at is not null or o.confirm_owner; them_done := o.from_sent_at is not null or o.confirm_from; them := o.from_id;
  elsif auth.uid() = o.from_id then
    me_done := o.from_sent_at is not null or o.confirm_from; them_done := o.owner_sent_at is not null or o.confirm_owner; them := o.owner_id;
  else
    raise exception 'you are not part of this trade';
  end if;
  if not me_done then raise exception 'mark your own side sent first'; end if;
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
  new.swap_order := null; new.swap_sig := null; new.swap_tx := null;
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
         owner_sent_how, from_sent_how, (swap_tx is not null) as swapped, created_at
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
  update public.offers set swap_tx = lower(p_tx),
    owner_sent_at = coalesce(owner_sent_at, now()), owner_sent_how = coalesce(owner_sent_how, 'onchain'), owner_ref = coalesce(owner_ref, lower(p_tx)),
    from_sent_at  = coalesce(from_sent_at, now()),  from_sent_how  = coalesce(from_sent_how, 'onchain'),  from_ref  = coalesce(from_ref, lower(p_tx))
  where id = p_offer;
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
