-- On-chain sends are checked against the chain: only an NFT side can claim one, a transaction can't
-- be reused, an unchecked send can't close someone out, and only the service role records verdicts.
\set ON_ERROR_STOP 0
\pset tuples_only on
create or replace function pg_temp.try(q text) returns text language plpgsql as $$ begin execute q; return 'ok'; exception when others then return 'refused: ' || sqlerrm; end $$;
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','a@x'),('b0000000-0000-0000-0000-000000000002','b@x'),('c0000000-0000-0000-0000-000000000003','c@x');
-- Alice lists a physical card; Bob offers an NFT on Base for it. Cara has another trade with Bob.
insert into public.items (id, owner_id, title) values ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Charizard');
insert into public.items (id, owner_id, title) values ('10000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000003','Lamp');
set role authenticated; select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
insert into public.offers (id, item_id, from_id, give, asset_kind, asset_chain, asset_contract, asset_token_id) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','Base NFT #7','erc721',8453,'0x1111111111111111111111111111111111111111','7');
insert into public.offers (id, item_id, from_id, give, asset_kind, asset_chain, asset_contract, asset_token_id) values
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002','Base NFT #8','erc721',8453,'0x1111111111111111111111111111111111111111','8');
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false); select public.accept_offer('20000000-0000-0000-0000-000000000001');
select set_config('req.uid','c0000000-0000-0000-0000-000000000003',false); select public.accept_offer('20000000-0000-0000-0000-000000000002');
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select 'D1 Alice marks her physical card "sent on chain": ' || pg_temp.try($q$select public.mark_sent('20000000-0000-0000-0000-000000000001','onchain',null,'0x$q$ || repeat('a',64) || $q$')$q$);
select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
select pg_temp.try($q$select public.mark_sent('20000000-0000-0000-0000-000000000001','onchain',null,'0x$q$ || repeat('B',64) || $q$')$q$);
reset role;
select 'D2 Bob''s NFT send is recorded as: ' || from_tx_status || ', hash stored lowercase: ' || (from_ref = '0x' || repeat('b',64))::text from public.offers where id='20000000-0000-0000-0000-000000000001';
set role authenticated; select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
select 'D3 the same transaction for another trade: ' || pg_temp.try($q$select public.mark_sent('20000000-0000-0000-0000-000000000002','onchain',null,'0x$q$ || repeat('b',64) || $q$')$q$);
select 'D4 Bob records the verdict himself: ' || pg_temp.try($q$select public.record_delivery('20000000-0000-0000-0000-000000000001','from',true,'trust me')$q$);
reset role; update public.offers set ship_by = now() - interval '1 day' where id = '20000000-0000-0000-0000-000000000001';
set role authenticated; select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
select 'D5 Bob closes Alice out on an unchecked send: ' || pg_temp.try($q$select public.claim_no_show('20000000-0000-0000-0000-000000000001')$q$);
reset role; set role service_role;
select public.record_delivery('20000000-0000-0000-0000-000000000001','from',false,'no transfer of this NFT to Alice''s wallet in that transaction');
reset role;
select 'D6 a rejected send is undone, with the reason: ' || coalesce(from_sent_at::text, 'not sent') || ' / ' || from_tx_status || ' / ' || from_tx_note from public.offers where id='20000000-0000-0000-0000-000000000001';
set role authenticated; select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
select 'D7 Bob marks it again with the right transaction: ' || pg_temp.try($q$select public.mark_sent('20000000-0000-0000-0000-000000000001','onchain',null,'0x$q$ || repeat('c',64) || $q$')$q$);
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select public.mark_sent('20000000-0000-0000-0000-000000000001','post','UPS','1Z999');
select 'D8 Alice can''t close Bob out while his send is being checked: ' || pg_temp.try($q$select public.claim_no_show('20000000-0000-0000-0000-000000000001')$q$);
reset role; set role service_role;
select public.record_delivery('20000000-0000-0000-0000-000000000001','from',true,'NFT #7 reached 0xa1b2…c3d4 on Base');
select public.record_delivery('20000000-0000-0000-0000-000000000001','from',false,'a late second verdict is ignored');
reset role;
select 'D9 the chain confirmed it: ' || from_tx_status || ' — ' || from_tx_note from public.offers where id='20000000-0000-0000-0000-000000000001';
-- Alice posts the card with tracking; both press; the trade is done.
set role authenticated; select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select public.press_dot('20000000-0000-0000-0000-000000000001');
select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false); select public.press_dot('20000000-0000-0000-0000-000000000001');
reset role;
select 'D10 tracked card + confirmed NFT = a verified trade: ' || tracked::text from public.trade_history where id = '20000000-0000-0000-0000-000000000001';
select 'D11 and it counts in both records: ' || string_agg(verified::text, ',') from public.trader_stats(array['a0000000-0000-0000-0000-000000000001'::uuid,'b0000000-0000-0000-0000-000000000002'::uuid]);
select 'D12 a send that''s still being checked doesn''t verify a trade: ' || public.trade_verified(null, 'post', null, 'onchain', 'checking')::text;
select 'D13 a trade from before checking existed still counts: ' || public.trade_verified('0x' || repeat('d',64), 'onchain', null, 'onchain', null)::text;
