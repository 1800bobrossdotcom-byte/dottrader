-- Matching v2: names people use for the same thing, accents, widening only the true way, ranking.
\set ON_ERROR_STOP 0
\pset tuples_only on
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','a@x'),('b0000000-0000-0000-0000-000000000002','b@x'),('c0000000-0000-0000-0000-000000000003','c@x'),('d0000000-0000-0000-0000-000000000004','d@x');
update public.profiles set lat = 43.16, lng = -77.61 where id in ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002');
update public.profiles set lat = 34.05, lng = -118.24 where id = 'c0000000-0000-0000-0000-000000000003';
select 'V1 "PlayStation 5" and "PS5" are one thing: ' || (public.match_terms('PlayStation 5', 'want') && public.match_terms('PS5 Digital Edition', 'have'))::text;
select 'V2 accents come off: ' || array_to_string(public.match_terms('Pokémon cards', 'want'), ',');
select 'V3 a Charizard listing counts as Pokemon: ' || array_to_string(public.match_terms('Charizard holo', 'have'), ',');
select 'V4 wanting a Charizard doesn''t want every Pokemon card: ' || array_to_string(public.match_terms('Charizard', 'want'), ',');
select 'V5 "light damage" on a card isn''t a Game Boy: ' || (not ('gameboy' = any (public.match_terms('Pikachu, light dmg', 'have'))))::text;
insert into public.items (id, owner_id, title, cat, want, want_cats) values
  ('10000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','PS5 Digital Edition','Video Games','Pokémon cards','{}'),
  ('10000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-000000000002','Charizard holo','Trading Cards','PlayStation 5','{}'),
  ('10000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-000000000003','Pikachu promo','Trading Cards','a console','{}'),
  ('10000000-0000-0000-0000-00000000000d','d0000000-0000-0000-0000-000000000004','Blastoise holo','Trading Cards','Charizard','{}');
set role authenticated; select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
select 'V6 Alice''s matches, best first: ' || string_agg(i.title || ' ' || m.score || (case when m.they_want_mine and m.i_want_theirs then ' mutual' else '' end) || (case when m.nearby then ' nearby' else '' end), '; ' order by m.score desc)
  from public.my_matches() m join public.items i on i.id = m.their_item;
select set_config('req.uid','d0000000-0000-0000-0000-000000000004',false);
select 'V7 Dave wants a Charizard; his matches: ' || coalesce(string_agg(i.title, '; '), 'none') from public.my_matches() m join public.items i on i.id = m.their_item where m.i_want_theirs;
reset role;
select 'V8 every alias is written the way text is read: ' || count(*) from public.match_aliases where ' ' || phrase || ' ' <> public.match_norm(phrase);
