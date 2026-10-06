-- Dot Trading Post — the board, a page at a time, and each trader's record added up here.
--
-- Run after history.sql (setup.sql runs everything in order).
--
-- The board used to fetch hundreds of listings, profiles and trade records and do the sums in
-- the browser. These let it ask for one page of listings, filtered here, and for the record of
-- only the traders on screen.

-- Each trader's record — the same rules the board uses to count dots, in one place:
--   a finished trade with someone counts 2 the first time, 1 the second, nothing after;
--   it counts once more (at the same weight) when it was tracked both ways or swapped on chain;
--   +1 for each different person who pressed their dot for you; +1 for a filled-in profile;
--   −3 for every trade you agreed and never sent.
-- Runs as the database owner and returns only these totals, never the offers behind them.
create or replace function public.trader_stats(p_ids uuid[])
returns table (user_id uuid, dots integer, trades integer, partners integer, verified integer, vouches integer, profile integer, no_shows integer)
language sql stable security definer set search_path = public as $$
  with ids as (select distinct unnest(p_ids[1:500]) as id),
  seen as (
    select i.id, o.id as offer_id, o.status, o.created_at,
           case when o.from_id = i.id then o.owner_id else o.from_id end as partner,
           case when o.from_id = i.id then o.confirm_owner else o.confirm_from end as vouched_me,
           (o.swap_tx is not null or (o.owner_sent_how = 'post' and o.from_sent_how = 'post')) as ver
    from ids i join public.offers o on o.from_id = i.id or o.owner_id = i.id
  ),
  done as (
    select id, partner, ver,
           case row_number() over (partition by id, partner order by created_at, offer_id) when 1 then 1.0 when 2 then 0.5 else 0 end as w
    from seen where status = 'done'
  ),
  t as (
    select id, count(*)::int as trades, count(distinct partner)::int as partners, count(*) filter (where ver)::int as verified,
           sum(2 * w) as trade_pts, coalesce(sum(w) filter (where ver), 0) as verified_pts
    from done group by id
  ),
  v as (select id, count(distinct partner)::int as vouches from seen where vouched_me group by id),
  n as (select i.id, count(o.id)::int as no_shows from ids i join public.offers o on o.defaulted_by = i.id group by i.id)
  select i.id,
         greatest(0, floor(coalesce(t.trade_pts, 0) + coalesce(t.verified_pts, 0) + coalesce(v.vouches, 0)
           + (case when coalesce(p.area, '') <> '' or coalesce(p.note, '') <> '' then 1 else 0 end) - 3 * coalesce(n.no_shows, 0)))::int,
         coalesce(t.trades, 0), coalesce(t.partners, 0), coalesce(t.verified, 0), coalesce(v.vouches, 0),
         (case when coalesce(p.area, '') <> '' or coalesce(p.note, '') <> '' then 1 else 0 end),
         coalesce(n.no_shows, 0)
  from ids i
  left join t on t.id = i.id left join v on v.id = i.id left join n on n.id = i.id
  left join public.profiles p on p.id = i.id;
$$;
grant execute on function public.trader_stats(uuid[]) to anon, authenticated;

-- One page of the board: open listings, newest first, older than p_before, filtered by category,
-- by words (in the title, details or want, or by matching keyword), and by distance from a point.
-- Listings are public; this runs as the caller.
create or replace function public.board_page(
  p_cat text default null, p_q text default null,
  p_lat double precision default null, p_lng double precision default null, p_km double precision default null,
  p_before timestamptz default null, p_limit integer default 30)
returns setof public.items
language sql stable set search_path = public as $$
  select x.* from public.items x
  left join public.profiles p on p.id = x.owner_id
  where x.status = 'open'
    and (nullif(p_cat, '') is null or x.cat = p_cat)
    and (p_before is null or x.created_at < p_before)
    and (nullif(btrim(p_q), '') is null
         or position(lower(btrim(p_q)) in lower(x.title || ' ' || x.descr || ' ' || x.want)) > 0
         or x.have_terms && public.match_terms(p_q, 'want'))
    and (p_km is null or p_lat is null or p_lng is null
         or (p.lat is not null and 111 * sqrt(power(p.lat - p_lat, 2) + power((p.lng - p_lng) * cos(radians(p_lat)), 2)) <= p_km))
  order by x.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 120);
$$;
grant execute on function public.board_page(text, text, double precision, double precision, double precision, timestamptz, integer) to anon, authenticated;

create index if not exists items_open_created_idx on public.items (created_at desc) where status = 'open';
create index if not exists offers_from_idx on public.offers (from_id);
create index if not exists offers_owner_idx on public.offers (owner_id);
create index if not exists offers_defaulted_idx on public.offers (defaulted_by) where defaulted_by is not null;
