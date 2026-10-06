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
