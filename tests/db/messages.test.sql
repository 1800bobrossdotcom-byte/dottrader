\set ON_ERROR_STOP 0
\pset tuples_only on
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','alice@x'),('b0000000-0000-0000-0000-000000000002','bob@x'),('e0000000-0000-0000-0000-000000000003','eve@x');
insert into public.items (id, owner_id, title) values ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Alice lamp');
insert into public.offers (id, item_id, owner_id, from_id, give) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','Bob vinyl');
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('req.uid', u, false); end $$;

set role authenticated;
select pg_temp.as_user('b0000000-0000-0000-0000-000000000002');
insert into public.messages (offer_id, from_id, body) values ('20000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','Can meet Saturday?');
select 'T1 bob writes in his trade: ' || count(*) from public.messages;
insert into public.messages (offer_id, from_id, body) values ('20000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','forged as alice');
select 'T2 bob forging alice as sender -> rows still: ' || count(*) from public.messages;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select 'T3 alice reads thread: ' || count(*) from public.messages;
insert into public.messages (offer_id, from_id, body) values ('20000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Saturday works');
select pg_temp.as_user('e0000000-0000-0000-0000-000000000003');
select 'T4 eve reads messages: ' || count(*) from public.messages;
select 'T5 eve reads offers: ' || count(*) from public.offers;
insert into public.messages (offer_id, from_id, body) values ('20000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','hi');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select 'T6 after eve tried, alice sees: ' || count(*) from public.messages;
update public.messages set body = 'edited';
select 'T7 edit attempt, edited rows visible: ' || count(*) from public.messages where body = 'edited';
delete from public.messages;
select 'T8 delete attempt, rows left: ' || count(*) from public.messages;
insert into public.messages (offer_id, from_id, body) values ('20000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','   ');
select pg_temp.as_user('b0000000-0000-0000-0000-000000000002');
select public.withdraw_offer('20000000-0000-0000-0000-000000000001');
select 'T9 after withdraw, status: ' || status from public.offers;
insert into public.messages (offer_id, from_id, body) values ('20000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','still there?');
select 'T10 message into withdrawn trade, rows: ' || count(*) from public.messages;
reset role;
set role anon; select pg_temp.as_user('');
select 'T11 anon reads messages: ' || count(*) from public.messages;
select 'T12 anon reads offers: ' || count(*) from public.offers;
select 'T13 anon reads offer_signals: ' || count(*) from public.offer_signals;
reset role;
select 'T14 messages in realtime publication: ' || count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='messages';
