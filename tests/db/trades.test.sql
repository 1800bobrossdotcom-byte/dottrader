\set ON_ERROR_STOP 0
\pset tuples_only on
\set QUIET on
delete from public.offers; delete from public.items; delete from auth.users;
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','alice@x'),('b0000000-0000-0000-0000-000000000002','bob@x'),('e0000000-0000-0000-0000-000000000003','eve@x');
insert into public.profiles (id, name, wallet_address) values ('a0000000-0000-0000-0000-000000000001','Alice','0xaaaa000000000000000000000000000000000001'),('b0000000-0000-0000-0000-000000000002','Bob','0xbbbb000000000000000000000000000000000002') on conflict (id) do update set wallet_address = excluded.wallet_address;
-- physical trade
insert into public.items (id, owner_id, title) values ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Lamp');
insert into public.offers (id, item_id, owner_id, from_id, give) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','Vinyl');
-- NFT trade, same chain
insert into public.items (id, owner_id, title, asset_kind, asset_chain, asset_contract, asset_token_id) values ('10000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','NFT A','erc721',1,'0xc0ffee0000000000000000000000000000000001','7');
insert into public.offers (id, item_id, owner_id, from_id, give, asset_kind, asset_chain, asset_contract, asset_token_id) values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','NFT B','erc1155',1,'0xbeef000000000000000000000000000000000002','99');
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('req.uid', u, false); end $$;
create or replace function pg_temp.try(q text) returns text language plpgsql as $$ begin execute q; return 'ok'; exception when others then return 'refused: ' || sqlerrm; end $$;
\set A '''a0000000-0000-0000-0000-000000000001'''
\set B '''b0000000-0000-0000-0000-000000000002'''

set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select public.accept_offer('20000000-0000-0000-0000-000000000001');
select 'S1 accept sets ship-by ~4 days: ' || (round(extract(epoch from ship_by - now())/86400))::text from public.offers where id='20000000-0000-0000-0000-000000000001';
select 'S2 post without tracking: ' || pg_temp.try($q$select public.mark_sent('20000000-0000-0000-0000-000000000001','post','USPS','')$q$);
select 'S3 post with tracking: ' || pg_temp.try($q$select public.mark_sent('20000000-0000-0000-0000-000000000001','post','USPS','9400111')$q$);
select 'S4 mark sent twice: ' || pg_temp.try($q$select public.mark_sent('20000000-0000-0000-0000-000000000001','in_person','','')$q$);
select 'S5 cancel after sending: ' || pg_temp.try($q$select public.cancel_trade('20000000-0000-0000-0000-000000000001')$q$);
select 'S6 claim before deadline: ' || pg_temp.try($q$select public.claim_no_show('20000000-0000-0000-0000-000000000001')$q$);
reset role; update public.offers set ship_by = now() - interval '1 hour' where id='20000000-0000-0000-0000-000000000001'; set role authenticated;
select pg_temp.as_user('e0000000-0000-0000-0000-000000000003');
select 'S7 outsider claims: ' || pg_temp.try($q$select public.claim_no_show('20000000-0000-0000-0000-000000000001')$q$);
select pg_temp.as_user('b0000000-0000-0000-0000-000000000002');
select 'S8 non-sender claims against sender: ' || pg_temp.try($q$select public.claim_no_show('20000000-0000-0000-0000-000000000001')$q$);
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select 'S9 sender claims after deadline: ' || pg_temp.try($q$select public.claim_no_show('20000000-0000-0000-0000-000000000001')$q$);
select 'S10 result: ' || status || ', no-show recorded against bob: ' || (defaulted_by = 'b0000000-0000-0000-0000-000000000002')::text from public.offers where id='20000000-0000-0000-0000-000000000001';
select 'S11 item back on board: ' || status from public.items where id='10000000-0000-0000-0000-000000000001';
reset role; set role anon; select pg_temp.as_user('');
select 'S12 anyone can count no-shows: ' || count(*) from public.offer_signals where defaulted_by is not null;
reset role; set role authenticated;

-- swaps
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select public.accept_offer('20000000-0000-0000-0000-000000000002');
\set GOOD '''{"offerer":"0xAAAA000000000000000000000000000000000001","offer":[{"itemType":2,"token":"0xc0ffee0000000000000000000000000000000001","identifierOrCriteria":"7","startAmount":"1","endAmount":"1"}],"consideration":[{"itemType":3,"token":"0xbeef000000000000000000000000000000000002","identifierOrCriteria":"99","startAmount":"1","endAmount":"1","recipient":"0xaaaa000000000000000000000000000000000001"},{"itemType":0,"token":"0x0000000000000000000000000000000000000000","identifierOrCriteria":"0","startAmount":"500","endAmount":"500","recipient":"0x00000000000000000000000000000000000000fe"}]}'''
\set SIG '''0x1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111'''
select 'W1 wrong item offered: ' || pg_temp.try(format('select public.post_swap(%L, %L::jsonb, %L)', '20000000-0000-0000-0000-000000000002', replace(:GOOD, '"identifierOrCriteria":"7"', '"identifierOrCriteria":"8"'), :SIG));
select 'W2 extra thing asked of the other side: ' || pg_temp.try(format('select public.post_swap(%L, %L::jsonb, %L)', '20000000-0000-0000-0000-000000000002', replace(:GOOD, '"itemType":0,', '"itemType":2,'), :SIG));
select 'W3 paid to someone else: ' || pg_temp.try(format('select public.post_swap(%L, %L::jsonb, %L)', '20000000-0000-0000-0000-000000000002', replace(:GOOD, '"recipient":"0xaaaa000000000000000000000000000000000001"', '"recipient":"0x9999000000000000000000000000000000000009"'), :SIG));
select 'W4 not from the linked wallet: ' || pg_temp.try(format('select public.post_swap(%L, %L::jsonb, %L)', '20000000-0000-0000-0000-000000000002', replace(:GOOD, '"offerer":"0xAAAA', '"offerer":"0xDDDD'), :SIG));
select pg_temp.as_user('b0000000-0000-0000-0000-000000000002');
select 'W5 non-lister posts order: ' || pg_temp.try(format('select public.post_swap(%L, %L::jsonb, %L)', '20000000-0000-0000-0000-000000000002', :GOOD, :SIG));
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select 'W6 correct order: ' || pg_temp.try(format('select public.post_swap(%L, %L::jsonb, %L)', '20000000-0000-0000-0000-000000000002', :GOOD, :SIG));
select 'W7 lister records the fill: ' || pg_temp.try($q$select public.record_swap('20000000-0000-0000-0000-000000000002','0x' || repeat('ab',32))$q$);
select pg_temp.as_user('b0000000-0000-0000-0000-000000000002');
select 'W8 filler records the fill: ' || pg_temp.try($q$select public.record_swap('20000000-0000-0000-0000-000000000002','0x' || repeat('ab',32))$q$);
select 'W9 both sides now sent on chain: ' || (owner_sent_how = 'onchain' and from_sent_how = 'onchain')::text from public.offers where id='20000000-0000-0000-0000-000000000002';
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select 'W10 order after the swap: ' || pg_temp.try(format('select public.post_swap(%L, %L::jsonb, %L)', '20000000-0000-0000-0000-000000000002', :GOOD, :SIG));

-- bonds and payouts: server-only writes
reset role;
insert into public.bonds (offer_id, user_id, amount_cents, fee_cents, status) values ('20000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',2500,150,'held');
insert into public.payouts (bond_id, user_id, amount_cents) select id, 'a0000000-0000-0000-0000-000000000001', 2500 from public.bonds;
set role authenticated;
select pg_temp.as_user('b0000000-0000-0000-0000-000000000002');
select 'B1 party sees bond: ' || count(*) from public.bonds;
select 'B2 bob cannot see alice''s payout: ' || count(*) from public.payouts;
select 'B3 party writes a bond: ' || pg_temp.try($q$insert into public.bonds (offer_id, user_id, amount_cents, fee_cents, status) values ('20000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002',1,0,'held')$q$);
select 'B4 party marks own bond released: ' || pg_temp.try($q$update public.bonds set status='released'$q$) || ', still held: ' || (select count(*) from public.bonds where status='held');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select 'B5 alice sees her payout: ' || count(*) from public.payouts;
select 'B6 alice approves her own payout: ' || pg_temp.try($q$update public.payouts set approved = true$q$) || ', approved rows: ' || (select count(*) from public.payouts where approved);
select pg_temp.as_user('e0000000-0000-0000-0000-000000000003');
select 'B7 outsider sees bonds: ' || count(*) from public.bonds;
