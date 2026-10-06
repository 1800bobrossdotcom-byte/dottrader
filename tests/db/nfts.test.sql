-- NFTs first-class: an NFT files under NFTs, carries nft and its chain as keywords, and a thing
-- is physical — so "any NFT", "on Base", "anything IRL" and the NFTs chip all find the right ones.
\set ON_ERROR_STOP 0
\pset tuples_only on
insert into auth.users values ('a0000000-0000-0000-0000-000000000001','a@x'),('b0000000-0000-0000-0000-000000000002','b@x'),('c0000000-0000-0000-0000-000000000003','c@x'),('d0000000-0000-0000-0000-000000000004','d@x');
insert into public.items (id, owner_id, title, cat, want, want_cats, asset_kind, asset_chain, asset_contract, asset_token_id) values
  ('10000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','Based Punk #12','Art','a Game Boy, or anything IRL','{}','erc721',8453,'0x1111111111111111111111111111111111111111','12'),
  ('10000000-0000-0000-0000-00000000000e','a0000000-0000-0000-0000-000000000001','Wiiide #8240','Other','','{}','erc721',1,'0x2222222222222222222222222222222222222222','8240');
insert into public.items (id, owner_id, title, cat, want, want_cats) values
  ('10000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-000000000002','Game Boy Color','Consoles & Retro','an NFT on Base','{}'),
  ('10000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-000000000003','Charizard holo','Trading Cards','Pokemon base set','{}'),
  ('10000000-0000-0000-0000-00000000000d','d0000000-0000-0000-0000-000000000004','Vintage camera','Cameras','','{NFTs}');
insert into public.items (id, owner_id, title, cat, want, asset_kind, asset_chain, asset_contract) values
  ('10000000-0000-0000-0000-00000000000f','d0000000-0000-0000-0000-000000000004','USDC','Other','','erc20',8453,'0x3333333333333333333333333333333333333333');
select 'N1 an NFT files under NFTs whatever it was given: ' || string_agg(title || '=' || cat, ', ' order by title) from public.items where asset_kind in ('erc721','erc1155');
select 'N2 a Base NFT''s keywords: ' || array_to_string(have_terms, ',') from public.items where id = '10000000-0000-0000-0000-00000000000a';
select 'N3 an Ethereum NFT''s keywords: ' || array_to_string(have_terms, ',') from public.items where id = '10000000-0000-0000-0000-00000000000e';
select 'N4 a thing is physical: ' || ('physical' = any (have_terms))::text from public.items where id = '10000000-0000-0000-0000-00000000000b';
select 'N4b tokens are neither: ' || (not (have_terms && '{physical,nft}'))::text from public.items where id = '10000000-0000-0000-0000-00000000000f';
select 'N5 "an NFT on Base" wants: ' || array_to_string(want_terms, ',') from public.items where id = '10000000-0000-0000-0000-00000000000b';
select 'N6 listings that want the Base NFT: ' || string_agg(i.title, ', ' order by i.title) from public.listings_wanting('10000000-0000-0000-0000-00000000000a') l join public.items i on i.id = l;
select 'N7 listings that want the Ethereum NFT: ' || string_agg(i.title, ', ' order by i.title) from public.listings_wanting('10000000-0000-0000-0000-00000000000e') l join public.items i on i.id = l;
select 'N8 "anything IRL" wants the Game Boy: ' || public.wants_item(x.want_cats, x.want_terms, y)::text from public.items x, public.items y where x.id = '10000000-0000-0000-0000-00000000000a' and y.id = '10000000-0000-0000-0000-00000000000b';
select 'N9 Pokemon "base set" doesn''t want a Base NFT: ' || (not public.wants_item(x.want_cats, x.want_terms, y))::text from public.items x, public.items y where x.id = '10000000-0000-0000-0000-00000000000c' and y.id = '10000000-0000-0000-0000-00000000000a';
set role authenticated; select set_config('req.uid','a0000000-0000-0000-0000-000000000001',false);
update public.items set cat = 'Art', title = 'Based Punk #12 (rare)' where id = '10000000-0000-0000-0000-00000000000a';
select 'N10 the owner can''t move an NFT out of NFTs: ' || cat || ', keywords kept: ' || ('basechain' = any (have_terms))::text from public.items where id = '10000000-0000-0000-0000-00000000000a';
select 'N11 the Base NFT''s owner is matched with the Game Boy both ways: ' || string_agg(i.title || ' ' || (m.they_want_mine and m.i_want_theirs)::text, '; ' order by i.title)
  from public.my_matches() m join public.items i on i.id = m.their_item where m.my_item = '10000000-0000-0000-0000-00000000000a';
reset role;
select 'N12 keywords are at version ' || value from public.app_config where key = 'match_terms_version';
