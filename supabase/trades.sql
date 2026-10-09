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

-- The board's fee on an atomic swap, per chain, in that chain's own coin (wei, as text so no
-- precision is lost on the way to a browser). Whoever completes the swap pays it, in the same
-- transaction, to `recipient`. post_swap() below refuses an order that leaves it out, and the
-- filler's browser refuses one that asks for more, so the fee is exactly this, every time. A
-- chain with no row, a null recipient or a zero amount charges nothing. Edit the rows to change
-- the price; the board reads them when it starts. (Rows are only seeded, never overwritten.)
create table if not exists public.swap_fees (
  chain     integer primary key,
  recipient text check (recipient is null or recipient ~ '^0x[0-9a-f]{40}$'),
  wei       text not null default '0' check (wei ~ '^[0-9]{1,40}$')
);
alter table public.swap_fees enable row level security;
drop policy if exists "swap fees readable by everyone" on public.swap_fees;
create policy "swap fees readable by everyone" on public.swap_fees for select using (true);
grant select on public.swap_fees to anon, authenticated;
insert into public.swap_fees (chain, recipient, wei) values
  (1,       '0x8455cf296e1265b494605207e97884813de21950', '500000000000000'),      -- Ethereum  0.0005 ETH
  (8453,    '0x8455cf296e1265b494605207e97884813de21950', '500000000000000'),      -- Base      0.0005 ETH
  (42161,   '0x8455cf296e1265b494605207e97884813de21950', '500000000000000'),      -- Arbitrum  0.0005 ETH
  (10,      '0x8455cf296e1265b494605207e97884813de21950', '500000000000000'),      -- Optimism  0.0005 ETH
  (7777777, '0x8455cf296e1265b494605207e97884813de21950', '500000000000000'),      -- Zora      0.0005 ETH
  (137,     '0x8455cf296e1265b494605207e97884813de21950', '5000000000000000000'),  -- Polygon   5 POL
  (56,      '0x8455cf296e1265b494605207e97884813de21950', '2500000000000000'),     -- BNB Chain 0.0025 BNB
  (43114,   '0x8455cf296e1265b494605207e97884813de21950', '60000000000000000')     -- Avalanche 0.06 AVAX
on conflict (chain) do nothing;

-- The lister posts a signed Seaport order. The database checks it is the order this trade agreed
-- — the listed NFT offered, the offered NFT asked for, paid to the lister, at most one more item
-- which must be the native-currency fee — so a signed order can't quietly ask for more. The
-- person filling it checks again in their own browser before sending anything.
create or replace function public.post_swap(p_offer uuid, p_order jsonb, p_sig text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers; it public.items; w text; n int; f public.swap_fees; fee jsonb;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  if auth.uid() <> o.owner_id then raise exception 'the lister sets up the swap'; end if;
  if o.status <> 'agreed' then raise exception 'only an agreed trade can be swapped'; end if;
  if o.swap_tx is not null then raise exception 'this trade was already swapped'; end if;
  select * into it from public.items where id = o.item_id;
  if it.asset_kind not in ('erc721', 'erc1155') or o.asset_kind not in ('erc721', 'erc1155') then raise exception 'both sides must be NFTs'; end if;
  if it.asset_chain is distinct from o.asset_chain then raise exception 'both NFTs must be on the same chain'; end if;
  -- Any wallet the lister has linked may sign it; the offered NFT comes back to that same wallet.
  w := lower(p_order->>'offerer');
  if w is null or w not in (select public.wallets_of(o.owner_id)) then raise exception 'the order must come from one of your linked wallets'; end if;
  if jsonb_array_length(p_order->'offer') <> 1 then raise exception 'the order must offer exactly your item'; end if;
  if lower(p_order->'offer'->0->>'token') <> lower(it.asset_contract) or p_order->'offer'->0->>'identifierOrCriteria' <> it.asset_token_id then
    raise exception 'the order does not offer the listed item'; end if;
  n := jsonb_array_length(p_order->'consideration');
  if n < 1 or n > 2 then raise exception 'unexpected order shape'; end if;
  if lower(p_order->'consideration'->0->>'token') <> lower(o.asset_contract)
     or p_order->'consideration'->0->>'identifierOrCriteria' <> o.asset_token_id
     or lower(p_order->'consideration'->0->>'recipient') <> w then
    raise exception 'the order does not ask for the offered item'; end if;
  -- Where this chain carries a board fee, the order must ask the filler for exactly that.
  select * into f from public.swap_fees where chain = it.asset_chain and recipient is not null and wei::numeric > 0;
  if found then
    fee := p_order->'consideration'->1;
    if n <> 2 or (fee->>'itemType') <> '0' or lower(fee->>'token') <> '0x0000000000000000000000000000000000000000'
       or lower(fee->>'recipient') <> f.recipient or coalesce(fee->>'startAmount', '') !~ '^[0-9]{1,40}$'
       or (fee->>'startAmount')::numeric < f.wei::numeric or (fee->>'endAmount') is distinct from (fee->>'startAmount') then
      raise exception 'the order must include the board fee'; end if;
  elsif n = 2 and (p_order->'consideration'->1->>'itemType') <> '0' then raise exception 'the second item may only be the fee'; end if;
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
-- When the card authorised (holds lapse seven days later), what became of the fee, and so what the
-- board earned: 'released' alone can't say whether a fee was kept.
alter table public.bonds
  add column if not exists held_at            timestamptz,
  add column if not exists fee_captured_cents integer not null default 0 check (fee_captured_cents >= 0),
  add column if not exists fee_refunded_cents integer not null default 0 check (fee_refunded_cents >= 0);
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
-- The handling fee kept from a forfeited bond before the rest is paid to the other side.
alter table public.payouts add column if not exists handling_cents integer not null default 0 check (handling_cents >= 0);
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

-- What the bonds earned, by month, for whoever runs the board (read it in the SQL editor; nothing
-- grants it to the API). Fees kept on completed trades, less fees refunded to honest sides of
-- no-shows, plus the handling kept from forfeits that were paid out.
create or replace view public.bond_revenue with (security_invoker = true) as
select to_char(m.month, 'YYYY-MM') as month,
       coalesce(f.fees_kept, 0)::int as fees_kept, coalesce(f.fee_cents, 0)::int as fee_cents,
       coalesce(f.forfeits, 0)::int as forfeits, coalesce(p.handling_cents, 0)::int as handling_cents,
       (coalesce(f.fee_cents, 0) + coalesce(p.handling_cents, 0))::int as revenue_cents
from (select distinct date_trunc('month', settled_at) as month from public.bonds where settled_at is not null
      union select distinct date_trunc('month', paid_at) from public.payouts where paid_at is not null) m
left join (select date_trunc('month', settled_at) as month,
                  count(*) filter (where fee_captured_cents > fee_refunded_cents) as fees_kept,
                  sum(fee_captured_cents - fee_refunded_cents) as fee_cents,
                  count(*) filter (where status = 'forfeited') as forfeits
           from public.bonds where settled_at is not null group by 1) f on f.month = m.month
left join (select date_trunc('month', paid_at) as month, sum(handling_cents) as handling_cents
           from public.payouts where status = 'paid' group by 1) p on p.month = m.month
order by 1 desc;
revoke all on public.bond_revenue from public, anon, authenticated;

-- No insert/update/delete policies on bonds, payouts or stripe_accounts: only the bond Edge
-- Function, with the service role, writes them.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bonds') then
    alter publication supabase_realtime add table public.bonds;
  end if;
end $$;
