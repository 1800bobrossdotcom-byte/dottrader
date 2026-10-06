-- Notifications: who a new listing alerts, who may ask, and that the triggers never get in the way.
\set ON_ERROR_STOP 0
\pset tuples_only on
create or replace function pg_temp.try(q text) returns text language plpgsql as $$ begin execute q; return 'ok'; exception when others then return 'refused: ' || sqlerrm; end $$;
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','a@x'),('b0000000-0000-0000-0000-000000000002','b@x'),('c0000000-0000-0000-0000-000000000003','c@x');
select 'N1 emails are on by default: ' || email_notify::text from public.profiles where id = 'a0000000-0000-0000-0000-000000000001';
insert into public.items (id, owner_id, title, cat, want, want_cats) values
  ('10000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-000000000002','Steam Deck 512GB','Consoles & Retro','a Nintendo Switch','{}');
insert into public.saved_wants (user_id, label, cats) values ('c0000000-0000-0000-0000-000000000003','switch','{}');
-- Alice lists a Switch wanting Consoles & Retro: Bob is a mutual match, Cara's saved search fits.
set role authenticated; select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select 'N2 posting a listing with the triggers in place: ' || pg_temp.try($q$insert into public.items (id, owner_id, title, cat, want_cats) values ('10000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','Nintendo Switch OLED','Video Games','{Consoles & Retro}')$q$);
reset role; set role service_role;
select 'N2b alert targets for a new Switch listing: ' || string_agg(kind || ' -> ' || (select name from public.profiles where id = t.user_id), ', ' order by kind) from public.listing_alert_targets('10000000-0000-0000-0000-00000000000a') t;
reset role; set role authenticated; select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select 'N3 who may list alert targets: ' || pg_temp.try($q$select * from public.listing_alert_targets('10000000-0000-0000-0000-00000000000a')$q$);
select 'N4 who may fire notify_event: ' || pg_temp.try($q$select public.notify_event('offer', null)$q$);
select set_config('req.uid','b0000000-0000-0000-0000-000000000002',false);
select 'N5 making an offer with the triggers in place: ' || pg_temp.try($q$insert into public.offers (id, item_id, from_id, give) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-000000000002','Steam Deck')$q$);
select 'N6 sending a message with the triggers in place: ' || pg_temp.try($q$insert into public.messages (offer_id, from_id, body) values ('20000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','hi')$q$);
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select 'N7 accepting with the triggers in place: ' || pg_temp.try($q$select public.accept_offer('20000000-0000-0000-0000-000000000001')$q$);
select 'N8 turning emails off: ' || pg_temp.try($q$update public.profiles set email_notify = false where id = 'a0000000-0000-0000-0000-000000000001'$q$);
select 'N10 anyone reads what was sent: ' || count(*) from public.notifications_sent;
