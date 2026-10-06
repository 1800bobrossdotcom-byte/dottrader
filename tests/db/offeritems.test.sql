-- Offering listings you have already posted: they must be yours and on the board, they travel with
-- the trade (pledged, traded, or back on the board), and one listing can't be promised twice.
\set ON_ERROR_STOP 0
\pset tuples_only on
create or replace function pg_temp.try(q text) returns text language plpgsql as $$ begin execute q; return 'ok'; exception when others then return 'refused: ' || sqlerrm; end $$;
create or replace function pg_temp.st(p uuid) returns text language sql as $$ select status from public.items where id = p $$;
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','a@x'),('b0000000-0000-0000-0000-000000000002','b@x'),('c0000000-0000-0000-0000-000000000003','c@x'),('e0000000-0000-0000-0000-000000000004','e@x');
insert into public.items (id, owner_id, title) values
  ('10000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','Lamp'),
  ('10000000-0000-0000-0000-0000000000a2','a0000000-0000-0000-0000-000000000001','Second lamp'),
  ('10000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-000000000003','Cara mug'),
  ('10000000-0000-0000-0000-0000000000b1','b0000000-0000-0000-0000-000000000002','Card one'),
  ('10000000-0000-0000-0000-0000000000b2','b0000000-0000-0000-0000-000000000002','Card two'),
  ('10000000-0000-0000-0000-0000000000b3','b0000000-0000-0000-0000-000000000002','Card three'),
  ('10000000-0000-0000-0000-0000000000b4','b0000000-0000-0000-0000-000000000002','Card four'),
  ('10000000-0000-0000-0000-0000000000b5','b0000000-0000-0000-0000-000000000002','Card five');
set role authenticated; select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
select pg_temp.try($q$insert into public.offers (id, item_id, from_id, give, give_items) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-000000000002','Two cards','{10000000-0000-0000-0000-0000000000b1,10000000-0000-0000-0000-0000000000b1,10000000-0000-0000-0000-0000000000b2}')$q$);
select 'O1 offering two of my listings (one named twice) stores: ' || cardinality(give_items) from public.offers where id='20000000-0000-0000-0000-000000000001';
select 'O2 putting in someone else''s listing: ' || pg_temp.try($q$insert into public.offers (item_id, from_id, give, give_items) values ('10000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-000000000002','x','{10000000-0000-0000-0000-00000000000c}')$q$);
select 'O3 putting in a listing that does not exist: ' || pg_temp.try($q$insert into public.offers (item_id, from_id, give, give_items) values ('10000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-000000000002','x','{10000000-0000-0000-0000-0000000000ff}')$q$);
insert into public.offers (id, item_id, from_id, give, give_items) values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000c','b0000000-0000-0000-0000-000000000002','Card two again','{10000000-0000-0000-0000-0000000000b2}');
insert into public.offers (id, item_id, from_id, give, give_items) values ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-00000000000c','b0000000-0000-0000-0000-000000000002','Card three','{10000000-0000-0000-0000-0000000000b3}');
select set_config('req.uid','e0000000-0000-0000-0000-000000000004',false);
insert into public.offers (id, item_id, from_id, give) values ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000004','Eve wants card one');
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select public.accept_offer('20000000-0000-0000-0000-000000000001');
select 'O4 accepted: lamp ' || pg_temp.st('10000000-0000-0000-0000-00000000000a') || ', card one ' || pg_temp.st('10000000-0000-0000-0000-0000000000b1') || ', card two ' || pg_temp.st('10000000-0000-0000-0000-0000000000b2');
reset role;
select 'O5 other offers putting in card two: ' || status from public.offers where id='20000000-0000-0000-0000-000000000002';
select 'O6 other offers on card one itself: ' || status from public.offers where id='20000000-0000-0000-0000-000000000004';
select 'O7 an unrelated offer: ' || status from public.offers where id='20000000-0000-0000-0000-000000000003';
set role authenticated; select set_config('req.uid','e0000000-0000-0000-0000-000000000004',false);
select 'O8 offering on a pledged card: ' || pg_temp.try($q$insert into public.offers (item_id, from_id, give) values ('10000000-0000-0000-0000-0000000000b2','e0000000-0000-0000-0000-000000000004','x')$q$);
select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
select 'O9 putting a pledged card into another offer: ' || pg_temp.try($q$insert into public.offers (item_id, from_id, give, give_items) values ('10000000-0000-0000-0000-0000000000a2','b0000000-0000-0000-0000-000000000002','x','{10000000-0000-0000-0000-0000000000b1}')$q$);
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select public.cancel_trade('20000000-0000-0000-0000-000000000001');
select 'O10 cancelled: lamp ' || pg_temp.st('10000000-0000-0000-0000-00000000000a') || ', card one ' || pg_temp.st('10000000-0000-0000-0000-0000000000b1') || ', card two ' || pg_temp.st('10000000-0000-0000-0000-0000000000b2');
-- B puts card one into an offer, then trades card one away elsewhere: the offer can't stand.
select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
insert into public.offers (id, item_id, from_id, give, give_items) values ('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-000000000002','Card one','{10000000-0000-0000-0000-0000000000b1}');
select set_config('req.uid','e0000000-0000-0000-0000-000000000004',false);
insert into public.offers (id, item_id, from_id, give) values ('20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000004','Eve again');
select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
select public.accept_offer('20000000-0000-0000-0000-000000000006');
reset role;
select 'O11 card one traded away elsewhere; the offer that put it in: ' || status from public.offers where id='20000000-0000-0000-0000-000000000005';
-- B puts card two into an offer, then removes card two.
set role authenticated; select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
insert into public.offers (id, item_id, from_id, give, give_items) values ('20000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-000000000002','Card two','{10000000-0000-0000-0000-0000000000b2}');
select public.remove_item('10000000-0000-0000-0000-0000000000b2');
select 'O12 card two removed; the offer that put it in: ' || status from public.offers where id='20000000-0000-0000-0000-000000000007';
-- A completed trade takes everything in it off the board.
insert into public.offers (id, item_id, from_id, give, give_items) values ('20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-000000000002','Card three','{10000000-0000-0000-0000-0000000000b3}');
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select public.accept_offer('20000000-0000-0000-0000-000000000008');
select public.press_dot('20000000-0000-0000-0000-000000000008');
select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
select public.press_dot('20000000-0000-0000-0000-000000000008');
select 'O13 done: lamp ' || pg_temp.st('10000000-0000-0000-0000-00000000000a') || ', card three ' || pg_temp.st('10000000-0000-0000-0000-0000000000b3');
-- A no-show puts everything back.
insert into public.offers (id, item_id, from_id, give, give_items) values ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-0000000000a2','b0000000-0000-0000-0000-000000000002','Card four','{10000000-0000-0000-0000-0000000000b4}');
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select public.accept_offer('20000000-0000-0000-0000-000000000009');
select public.mark_sent('20000000-0000-0000-0000-000000000009', 'in_person', null, null);
reset role; update public.offers set ship_by = now() - interval '1 day' where id = '20000000-0000-0000-0000-000000000009';
set role authenticated; select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select public.claim_no_show('20000000-0000-0000-0000-000000000009');
select 'O14 no-show: second lamp ' || pg_temp.st('10000000-0000-0000-0000-0000000000a2') || ', card four ' || pg_temp.st('10000000-0000-0000-0000-0000000000b4');
select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
select 'O15 more than six listings in one offer: ' || pg_temp.try($q$insert into public.offers (item_id, from_id, give, give_items) values ('10000000-0000-0000-0000-0000000000a2','b0000000-0000-0000-0000-000000000002','x', array(select gen_random_uuid() from generate_series(1,7)))$q$);
reset role;
-- set up the race run.sh plays out: two owners each accept an offer that puts in the same card
insert into public.items (id, owner_id, title) values
  ('30000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','Race lamp'),
  ('30000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-000000000003','Race mug');
insert into public.offers (id, item_id, from_id, give, give_items) values
  ('40000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-000000000002','Card five','{10000000-0000-0000-0000-0000000000b5}'),
  ('40000000-0000-0000-0000-00000000000c','30000000-0000-0000-0000-00000000000c','b0000000-0000-0000-0000-000000000002','Card five','{10000000-0000-0000-0000-0000000000b5}');
