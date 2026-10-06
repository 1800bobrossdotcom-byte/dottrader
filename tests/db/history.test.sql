-- Finished trades are public; nothing else about offers is.
\set ON_ERROR_STOP 0
\pset tuples_only on
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','a@x'),('b0000000-0000-0000-0000-000000000002','b@x'),('e0000000-0000-0000-0000-000000000003','e@x');
insert into public.items (id, owner_id, title) values
  ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Lamp'),
  ('10000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','Chair'),
  ('10000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','Rug');
set role authenticated; select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
insert into public.offers (id, item_id, from_id, give, msg, done_at) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','Vinyl box','my number is 555-0100','2001-01-01');
insert into public.offers (id, item_id, from_id, give) values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002','Pending thing');
insert into public.offers (id, item_id, from_id, give) values ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000002','Cancelled thing');
select 'T1 a new offer can''t arrive already finished: ' || coalesce(done_at::text, 'no finish time') from public.offers where id='20000000-0000-0000-0000-000000000001';
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select public.accept_offer('20000000-0000-0000-0000-000000000001'); select public.press_dot('20000000-0000-0000-0000-000000000001');
select public.accept_offer('20000000-0000-0000-0000-000000000003'); select public.cancel_trade('20000000-0000-0000-0000-000000000003');
select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
select public.press_dot('20000000-0000-0000-0000-000000000001');
select 'T2 finishing a trade stamps when: ' || (done_at > now() - interval '1 minute')::text from public.offers where id='20000000-0000-0000-0000-000000000001';
select set_config('req.uid','e0000000-0000-0000-0000-000000000003',false);
select 'T3 a stranger sees finished trades: ' || coalesce(string_agg(give, ','), 'none') from public.trade_history;
reset role; set role anon;
select 'T4 so does a visitor: ' || count(*) from public.trade_history;
reset role;
select 'T5 what the history shows: ' || string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name = 'trade_history';
-- Local pickup only.
insert into public.items (id, owner_id, title, local_only) values ('10000000-0000-0000-0000-000000000009','a0000000-0000-0000-0000-000000000001','Sofa',true);
set role authenticated; select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
insert into public.offers (id, item_id, from_id, give) values ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000009','b0000000-0000-0000-0000-000000000002','Armchair');
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select public.accept_offer('20000000-0000-0000-0000-000000000009');
create or replace function pg_temp.try(q text) returns text language plpgsql as $$ begin execute q; return 'ok'; exception when others then return 'refused: ' || sqlerrm; end $$;
select 'L1 marking a local-pickup trade posted: ' || pg_temp.try($q$select public.mark_sent('20000000-0000-0000-0000-000000000009','post','UPS','1Z999')$q$);
select 'L2 marking it handed over in person: ' || pg_temp.try($q$select public.mark_sent('20000000-0000-0000-0000-000000000009','in_person',null,null)$q$);
reset role;
