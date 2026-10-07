-- The footer's numbers: a visit is one browser one day; crawlers and repeats don't count; nothing
-- about the visitor is kept; nobody can read or write the tables directly.
\set ON_ERROR_STOP 0
\pset tuples_only on
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
