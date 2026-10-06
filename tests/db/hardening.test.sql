-- Forged offers, fake owners, hand-flipped statuses, deleted history, precise locations, public
-- proofs: each must be refused or neutralised by the database itself.
\set ON_ERROR_STOP 0
\pset tuples_only on
create or replace function pg_temp.try(q text) returns text language plpgsql as $$ begin execute q; return 'ok'; exception when others then return 'refused: ' || sqlerrm; end $$;
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','john.smith1985@x'),('b0000000-0000-0000-0000-000000000002','bob@x'),('e0000000-0000-0000-0000-000000000003','eve@x'),('f0000000-0000-0000-0000-000000000004','eve2@x');
select 'H1 new profile name: ' || name from public.profiles where id='a0000000-0000-0000-0000-000000000001';
set role authenticated; select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select pg_temp.try($q$insert into public.items (id, owner_id, title, status) values ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Lamp','traded')$q$);
select 'H2 item submitted as traded is stored as: ' || status from public.items where id='10000000-0000-0000-0000-000000000001';
select set_config('req.uid','e0000000-0000-0000-0000-000000000003',false);
select pg_temp.try($q$insert into public.offers (id, item_id, owner_id, from_id, give, status, confirm_owner, confirm_from) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','x','done',true,true)$q$);
select 'H3 forged done+vouched offer stored as: ' || status || ', confirms ' || confirm_owner::text || '/' || confirm_from::text from public.offers where id='20000000-0000-0000-0000-000000000001';
select pg_temp.try($q$insert into public.offers (id, item_id, owner_id, from_id, give, status, defaulted_by) values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','x','cancelled','a0000000-0000-0000-0000-000000000001')$q$);
select 'H4 forged no-show stored as: ' || status || ', no-show recorded: ' || (defaulted_by is not null)::text from public.offers where id='20000000-0000-0000-0000-000000000002';
select pg_temp.try($q$insert into public.offers (id, item_id, owner_id, from_id, give) values ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000003','x')$q$);
select 'H5 offer naming a fake owner stored with owner: ' || (case when owner_id='a0000000-0000-0000-0000-000000000001' then 'the real owner' else 'SOMEONE ELSE' end) from public.offers where id='20000000-0000-0000-0000-000000000003';
select set_config('req.uid','f0000000-0000-0000-0000-000000000004',false);
select 'H6 the fake owner accepts: ' || pg_temp.try($q$select public.accept_offer('20000000-0000-0000-0000-000000000003')$q$);
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select 'H7 owner flips status directly: ' || pg_temp.try($q$update public.items set status = 'pledged' where id = '10000000-0000-0000-0000-000000000001'$q$);
select pg_temp.try($q$delete from public.items where id = '10000000-0000-0000-0000-000000000001'$q$);
select 'H8 direct delete leaves the item: ' || count(*) from public.items where id='10000000-0000-0000-0000-000000000001';
select pg_temp.try($q$update public.profiles set lat = 43.157842, lng = -77.601391 where id = 'a0000000-0000-0000-0000-000000000001'$q$);
select 'H9 precise location stored as: ' || lat || ',' || lng from public.profiles where id='a0000000-0000-0000-0000-000000000001';
reset role;
select 'H10 badge view columns: ' || string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name = 'verification_badges';
select 'H11 proofs bucket public: ' || public::text from storage.buckets where id = 'proofs';
insert into public.items (id, owner_id, title) values ('10000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','Spare');
set role authenticated; select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select 'H12 remove untraded listing: ' || public.remove_item('10000000-0000-0000-0000-000000000005');
select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
insert into public.offers (id, item_id, from_id, give) values ('20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','Bob vinyl');
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select public.accept_offer('20000000-0000-0000-0000-000000000006');
select 'H13 remove a listing in an agreed trade: ' || pg_temp.try($q$select public.remove_item('10000000-0000-0000-0000-000000000001')$q$);
select public.cancel_trade('20000000-0000-0000-0000-000000000006');
select 'H14 remove after a cancelled trade: ' || public.remove_item('10000000-0000-0000-0000-000000000001') || ', trade record kept: ' || (select count(*) from public.offers where id='20000000-0000-0000-0000-000000000006');
select 'H15 offer on a removed listing: ' || pg_temp.try($q$insert into public.offers (item_id, from_id, give) values ('10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','x')$q$);
reset role;
-- set up the accept race run.sh plays out in two sessions
insert into public.items (id, owner_id, title) values ('30000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Race lamp');
insert into public.offers (id, item_id, from_id, give) values ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','one'),('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','two');
