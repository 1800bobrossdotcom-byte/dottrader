-- trader_stats adds a record up by the board's rules; board_page pages and filters the board.
\set ON_ERROR_STOP 0
\pset tuples_only on
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','a@x'),('b0000000-0000-0000-0000-000000000002','b@x'),('c0000000-0000-0000-0000-000000000003','c@x'),('d0000000-0000-0000-0000-000000000004','d@x');
update public.profiles set area = 'Rochester', lat = 43.16, lng = -77.61 where id = 'a0000000-0000-0000-0000-000000000001';
update public.profiles set lat = 34.05, lng = -118.24 where id = 'c0000000-0000-0000-0000-000000000003';
insert into public.items (id, owner_id, title, cat, want, created_at) values
  ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Lamp one','Home & Kitchen','', now() - interval '9 days'),
  ('10000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','Lamp two','Home & Kitchen','', now() - interval '8 days'),
  ('10000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','Lamp three','Home & Kitchen','', now() - interval '7 days'),
  ('10000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000003','Cara NFT','Art','', now() - interval '6 days'),
  ('10000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','Rug','Home & Kitchen','', now() - interval '5 days');
insert into public.offers (id, item_id, from_id, give) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','x'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002','x'),
  ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000002','x'),
  ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','x'),
  ('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000004','x');
-- Three finished trades between Alice and Bob (the first tracked both ways), one with Cara swapped
-- on chain, everyone pressing their dots; and one trade Alice agreed with Dave and never sent.
update public.offers set status = 'done', confirm_owner = true, confirm_from = true, created_at = now() - interval '4 days',
  owner_sent_how = 'post', from_sent_how = 'post' where id = '20000000-0000-0000-0000-000000000001';
update public.offers set status = 'done', confirm_owner = true, confirm_from = true, created_at = now() - interval '3 days' where id in ('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003');
update public.offers set status = 'done', confirm_owner = true, confirm_from = true, swap_tx = '0x' || repeat('a', 64) where id = '20000000-0000-0000-0000-000000000004';
update public.offers set status = 'cancelled', defaulted_by = 'a0000000-0000-0000-0000-000000000001' where id = '20000000-0000-0000-0000-000000000005';
-- Worked by hand: trades 2·(1 + ½ + 0) with Bob + 2 with Cara = 5; verified ½·0+1 (Bob's first) + 1 (Cara) = 2;
-- vouches from Bob and Cara = 2; profile 1; one no-show −3. 5 + 2 + 2 + 1 − 3 = 7.
select 'S1 Alice: ' || dots || ' dots, ' || trades || ' trades, ' || partners || ' partners, ' || verified || ' verified, ' || vouches || ' vouches, ' || profile || ' profile, ' || no_shows || ' no-shows'
  from public.trader_stats(array['a0000000-0000-0000-0000-000000000001'::uuid]);
select 'S2 Bob: ' || dots || ' dots, ' || trades || ' trades, ' || no_shows || ' no-shows' from public.trader_stats(array['b0000000-0000-0000-0000-000000000002'::uuid]);
select 'S3 someone with no trades still gets a row: ' || dots from public.trader_stats(array['d0000000-0000-0000-0000-000000000004'::uuid]);
-- The board, a page at a time.
insert into public.items (owner_id, title, cat, want, created_at)
  select 'b0000000-0000-0000-0000-000000000002', 'Card ' || g, 'Trading Cards', '', now() - (g || ' minutes')::interval from generate_series(1, 45) g;
insert into public.items (owner_id, title, cat, created_at) values
  ('c0000000-0000-0000-0000-000000000003','PS5 Digital Edition','Video Games', now() - interval '1 hour'),
  ('a0000000-0000-0000-0000-000000000001','Charizard holo','Trading Cards', now() - interval '2 hours');
set role anon;
select 'S4 a visitor gets the first page: ' || count(*) from public.board_page(p_limit => 30);
select 'S5 the next page starts where it ended: ' || count(*) from public.board_page(p_before => (select min(created_at) from public.board_page(p_limit => 30)), p_limit => 30);
select 'S6 only open listings, never traded or taken down: ' || count(*) from public.board_page(p_limit => 120) b where b.status <> 'open';
select 'S7 by category: ' || count(*) from public.board_page(p_cat => 'Video Games');
select 'S8 by words in the title: ' || string_agg(title, ',') from public.board_page(p_q => 'charizard');
select 'S9 by another name for it: ' || string_agg(title, ',') from public.board_page(p_q => 'playstation 5');
select 'S10 by a broader name: ' || string_agg(title, ',') from public.board_page(p_q => 'pokemon');
select 'S11 within 50 km of Rochester: ' || string_agg(distinct title, ',') from public.board_page(p_lat => 43.16, p_lng => -77.61, p_km => 50);
select 'S12 a page can''t be huge: ' || count(*) from public.board_page(p_limit => 100000);
reset role;
