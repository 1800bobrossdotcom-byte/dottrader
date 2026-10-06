-- Matching: keywords, who wants what, mutual matches, counts, saved searches and their privacy.
\set ON_ERROR_STOP 0
\pset tuples_only on
create or replace function pg_temp.try(q text) returns text language plpgsql as $$ begin execute q; return 'ok'; exception when others then return 'refused: ' || sqlerrm; end $$;
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','a@x'),('b0000000-0000-0000-0000-000000000002','b@x'),('c0000000-0000-0000-0000-000000000003','c@x'),('d0000000-0000-0000-0000-000000000004','d@x'),('e0000000-0000-0000-0000-000000000005','e@x');
insert into public.items (id, owner_id, title, cat, want, want_cats) values
  ('10000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','Nintendo Switch OLED, boxed with 2 games!','Video Games','Steam Deck', '{Consoles & Retro}'),
  ('10000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-000000000002','Steam Deck 512GB','Consoles & Retro','a Nintendo Switch', '{}'),
  ('10000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-000000000003','Charizard holo, 1999 base set Pokemon','Trading Cards','', '{Video Games}');
select 'M1 keywords pulled from a title: ' || array_to_string(have_terms, ',') from public.items where id = '10000000-0000-0000-0000-00000000000a';
select 'M2 keywords pulled from a want: ' || array_to_string(want_terms, ',') from public.items where id = '10000000-0000-0000-0000-00000000000b';
set role authenticated;
select set_config('req.uid','d0000000-0000-0000-0000-000000000004',false);
insert into public.saved_wants (user_id, label, cats) values ('d0000000-0000-0000-0000-000000000004','pokemon cards','{Trading Cards}');
select 'M3 a saved search with nothing in it: ' || pg_temp.try($q$insert into public.saved_wants (user_id, label, cats) values ('d0000000-0000-0000-0000-000000000004','  ','{}')$q$);
select 'M4 saving a search for someone else: ' || pg_temp.try($q$insert into public.saved_wants (user_id, label) values ('e0000000-0000-0000-0000-000000000005','anything')$q$);
select set_config('req.uid','e0000000-0000-0000-0000-000000000005',false);
insert into public.saved_wants (user_id, label) values ('e0000000-0000-0000-0000-000000000005','switch');
select 'M5 Eve sees others'' saved searches: ' || count(*) from public.saved_wants where user_id <> 'e0000000-0000-0000-0000-000000000005';
select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select 'M6 Alice''s matches: ' || string_agg(i.title || (case when m.they_want_mine and m.i_want_theirs then ' [mutual]' when m.they_want_mine then ' [wants yours]' else ' [you want it]' end), '; ' order by i.title)
  from public.my_matches() m join public.items i on i.id = m.their_item;
select 'M7 wanted counts for the Switch: listings ' || listings || ', searches ' || searches from public.wanted_counts(array['10000000-0000-0000-0000-00000000000a'::uuid]);
select 'M8 wanted counts for the Charizard: listings ' || listings || ', searches ' || searches from public.wanted_counts(array['10000000-0000-0000-0000-00000000000c'::uuid]);
select set_config('req.uid','d0000000-0000-0000-0000-000000000004',false);
select 'M9 Dave''s saved-search hits: ' || string_agg(i.title, '; ') from public.my_search_hits() h join public.items i on i.id = h.item_id;
select set_config('req.uid','e0000000-0000-0000-0000-000000000005',false);
select 'M10 Eve''s saved-search hits: ' || string_agg(i.title, '; ') from public.my_search_hits() h join public.items i on i.id = h.item_id;
reset role; set role anon; select set_config('req.uid','',false);
select 'M11 anyone reads saved searches: ' || count(*) from public.saved_wants;
select 'M12 anyone can see how many want the Switch: ' || (listings + searches) from public.wanted_counts(array['10000000-0000-0000-0000-00000000000a'::uuid]);
reset role;
insert into public.saved_wants (user_id, label) select 'b0000000-0000-0000-0000-000000000002', 'thing ' || g from generate_series(1, 20) g;
select 'M13 a 21st saved search: ' || pg_temp.try($q$insert into public.saved_wants (user_id, label) values ('b0000000-0000-0000-0000-000000000002','zelda cartridge')$q$);
update public.items set title = 'Game Boy Color, teal' where id = '10000000-0000-0000-0000-00000000000a';
select 'M14 keywords follow an edit: ' || array_to_string(have_terms, ',') from public.items where id = '10000000-0000-0000-0000-00000000000a';
