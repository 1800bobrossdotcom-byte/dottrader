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
