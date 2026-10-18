-- The footer's numbers: a visit is one browser one day; crawlers and repeats don't count; nothing
-- about the visitor is kept; nobody can read or write the tables directly.
\set ON_ERROR_STOP 0
\pset tuples_only on
create or replace function pg_temp.try(q text) returns text language plpgsql as $$ begin execute q; return 'ok'; exception when others then return 'refused: ' || sqlerrm; end $$;
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','a@x'),('b0000000-0000-0000-0000-000000000002','b@x');
set role anon;
select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.7","user-agent":"Mozilla/5.0 (iPhone)"}', false);
select 'S1 a first visit: ' || visits || ' visit, ' || members || ' members' from public.note_visit('client-1');
select 'S2 the same browser again today: ' || visits from public.note_visit('client-1');
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.4","user-agent":"Mozilla/5.0 (Android)"}', false);
select 'S3 someone else: ' || visits from public.note_visit('client-2');
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.9","user-agent":"Googlebot/2.1"}', false);
select 'S4 a crawler isn''t counted: ' || visits from public.note_visit(null);
select set_config('request.headers', '{"user-agent":"Mozilla/5.0"}', false);
select 'S5 no address: the page''s own id stands in: ' || visits from public.note_visit('client-3');
select 'S6 no address and no id: not counted: ' || visits from public.note_visit(null);
select 'S7 anyone reading the visits: ' || (select count(*) from public.site_visits)::text;
insert into public.site_visits values (current_date, 'fake');
select 'S8 anyone writing a visit: ' || (select count(*) from public.site_visits)::text;
reset role;
select 'S9 nothing stored names a visitor: ' || (not exists (select 1 from public.site_visits where who ~ '(203\.0|198\.51|client|Mozilla)'))::text || ', one secret kept: ' || (select count(*) from public.site_salts);
insert into public.site_salts values (current_date - 1, 'old');
set role anon; select public.note_visit('client-1') is not null; reset role;
select 'S10 yesterday''s secret is gone after a visit: ' || (not exists (select 1 from public.site_salts where day < current_date))::text;
-- Where visitors come from, and how far they get.
set role anon;
select set_config('request.headers', '{"cf-connecting-ip":"192.0.2.10","user-agent":"Mozilla/5.0 (iPad)"}', false);
select public.note_visit('client-9', 'sticker') is not null;
select public.note_visit('client-9', 'sticker') is not null;
select set_config('request.headers', '{"cf-connecting-ip":"192.0.2.11","user-agent":"Mozilla/5.0 (Mac)"}', false);
select public.note_visit('client-10', 'Bad Ref!<script>') is not null;
reset role;
select 'S11 a visit from a sticker is counted once for that source: ' || (select count(*) from public.site_refs where ref = 'sticker');
select 'S12 a malformed source is ignored, the visit still counted: ' || (select count(*) from public.site_refs where ref <> 'sticker') || ', visits ' || (select count(*) from public.site_visits);
update public.profiles set ref = 'sticker' where id = 'a0000000-0000-0000-0000-000000000001';
insert into public.items (id, owner_id, title) values ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Lamp');
select 'S13 a source that isn''t a plain word is refused: ' || pg_temp.try($q$update public.profiles set ref = 'x y' where id = 'b0000000-0000-0000-0000-000000000002'$q$);
select 'S14 the funnel, by source: ' || string_agg(ref || ' ' || visitors || '/' || signups || '/' || posted || '/' || offered || '/' || traded, '; ' order by ref) from public.site_funnel;
set role anon;
select 'S15 a visitor reading the funnel: ' || pg_temp.try('select count(*) from public.site_funnel');
reset role;
