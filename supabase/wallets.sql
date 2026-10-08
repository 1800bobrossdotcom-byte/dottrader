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

-- ---------------------------------------------------------------- several wallets per account
--
-- People keep NFTs in more than one wallet. Each wallet linked to an account is a row here, with
-- its own signed message, so a listing counts as held when any of them holds it. The wallet in
-- profiles above stays the main one: the wallet the board points others to when they send you
-- something. It is always one of these rows too.
--
-- The message must name the account it links to. A signature is public, so without that anyone
-- could copy someone else's message and signature onto their own account and claim the wallet.
create table if not exists public.linked_wallets (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  address  text not null check (address ~ '^0x[0-9a-f]{40}$'),
  msg      text not null check (length(msg) <= 400),
  sig      text not null check (sig ~ '^0x[0-9a-fA-F]{130,132}$'),
  added_at timestamptz not null default now(),
  primary key (owner_id, address),
  constraint linked_wallets_names_account check (position(owner_id::text in msg) > 0)
);
alter table public.linked_wallets enable row level security;

drop policy if exists "linked wallets readable by everyone" on public.linked_wallets;
create policy "linked wallets readable by everyone" on public.linked_wallets for select using (true);
drop policy if exists "link own wallet" on public.linked_wallets;
create policy "link own wallet" on public.linked_wallets for insert with check (auth.uid() = owner_id);
drop policy if exists "re-sign own wallet" on public.linked_wallets;
create policy "re-sign own wallet" on public.linked_wallets for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "unlink own wallet" on public.linked_wallets;
create policy "unlink own wallet" on public.linked_wallets for delete using (auth.uid() = owner_id);
grant select on public.linked_wallets to anon, authenticated;
grant insert, update, delete on public.linked_wallets to authenticated;

-- The wallet each account already had becomes its first row.
insert into public.linked_wallets (owner_id, address, msg, sig)
  select id, lower(wallet_address), wallet_msg, wallet_sig from public.profiles
  where wallet_address ~* '^0x[0-9a-f]{40}$' and wallet_sig ~ '^0x[0-9a-fA-F]{130,132}$'
    and length(wallet_msg) <= 400 and position(id::text in wallet_msg) > 0
  on conflict do nothing;

-- Every wallet an account has linked, the main one included. Read by the database's own checks.
create or replace function public.wallets_of(p_user uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select lower(wallet_address) from public.profiles where id = p_user and wallet_address is not null
  union
  select address from public.linked_wallets where owner_id = p_user
$$;
