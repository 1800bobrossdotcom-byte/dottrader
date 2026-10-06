-- Dot Trading Post — bundles: several things on one side of a trade.
--
-- Run this in the Supabase SQL editor AFTER verify.sql (it replaces cancel_trade, which verify.sql
-- creates, as well as accept_offer and press_dot from schema.sql).
--
-- Two shapes. A LISTING can be a bundle: `items.parts` lists what is included, so "box of 40 N64
-- games" can name the games. An OFFER can be a bundle: `offers.parts` lists the extra things the
-- offerer is adding on top of `give`, and `offers.part_item_ids` points at any of their own
-- listings they are putting in. Those listings travel with the trade — pledged when the offer is
-- accepted, traded when both dots are pressed, back on the board if the trade is cancelled — so a
-- listing cannot be promised in two accepted trades at once.

alter table public.items add column if not exists parts text[] not null default '{}';
alter table public.items drop constraint if exists items_parts_max;
alter table public.items add constraint items_parts_max check (coalesce(array_length(parts, 1), 0) <= 12);

alter table public.offers add column if not exists parts text[] not null default '{}';
alter table public.offers add column if not exists part_item_ids uuid[] not null default '{}';
alter table public.offers drop constraint if exists offers_parts_max;
alter table public.offers add constraint offers_parts_max
  check (coalesce(array_length(parts, 1), 0) <= 6 and coalesce(array_length(part_item_ids, 1), 0) <= 6);

-- Listings put into an offer must be the offerer's own, still on the board, and not the item
-- being offered on. Checked at insert, and again at accept (things change in between).
create or replace function public.offers_check_parts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(array_length(new.part_item_ids, 1), 0) = 0 then return new; end if;
  if new.item_id = any (new.part_item_ids) then raise exception 'you cannot offer an item for itself'; end if;
  if exists (
    select 1 from unnest(new.part_item_ids) pid
    left join public.items i on i.id = pid
    where i.id is null or i.owner_id <> new.from_id or i.status <> 'open'
  ) then
    raise exception 'every listing in your offer must be your own and still on the board';
  end if;
  return new;
end $$;

drop trigger if exists offers_check_parts on public.offers;
create trigger offers_check_parts before insert on public.offers
  for each row execute function public.offers_check_parts();

create or replace function public.accept_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer;
  if not found then raise exception 'offer not found'; end if;
  if o.owner_id <> auth.uid() then raise exception 'only the person who posted the item can accept'; end if;
  if o.status <> 'pending' then raise exception 'this offer is no longer pending'; end if;
  if exists (
    select 1 from unnest(o.part_item_ids) pid
    left join public.items i on i.id = pid
    where i.id is null or i.owner_id <> o.from_id or i.status <> 'open'
  ) then
    raise exception 'something in this offer is no longer available — ask them to offer again';
  end if;

  update public.offers set status = 'agreed' where id = p_offer;
  update public.items  set status = 'pledged' where id = o.item_id;
  update public.items  set status = 'pledged' where id = any (o.part_item_ids);
  -- Every other open offer on the item, and on anything bundled into this trade, is now moot.
  update public.offers set status = 'declined'
   where status = 'pending' and id <> p_offer
     and (item_id = o.item_id or item_id = any (o.part_item_ids) or part_item_ids && (o.part_item_ids || o.item_id));
end $$;

create or replace function public.press_dot(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers; v_both boolean;
begin
  select * into o from public.offers where id = p_offer;
  if not found then raise exception 'offer not found'; end if;
  if o.status <> 'agreed' then raise exception 'this trade is not awaiting delivery'; end if;

  if auth.uid() = o.owner_id then
    update public.offers set confirm_owner = true where id = p_offer;
  elsif auth.uid() = o.from_id then
    update public.offers set confirm_from = true where id = p_offer;
  else
    raise exception 'you are not part of this trade';
  end if;

  select confirm_owner and confirm_from into v_both from public.offers where id = p_offer;
  if v_both then
    update public.offers set status = 'done' where id = p_offer;
    update public.items  set status = 'traded' where id = o.item_id or id = any (o.part_item_ids);
  end if;
end $$;

create or replace function public.cancel_trade(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer;
  if not found then raise exception 'offer not found'; end if;
  if o.status <> 'agreed' then raise exception 'only an agreed trade can be cancelled'; end if;
  if auth.uid() = o.owner_id then
    if o.confirm_owner then raise exception 'you already confirmed your side arrived'; end if;
  elsif auth.uid() = o.from_id then
    if o.confirm_from then raise exception 'you already confirmed your side arrived'; end if;
  else
    raise exception 'you are not part of this trade';
  end if;
  update public.offers set status = 'cancelled', cancelled_by = auth.uid() where id = p_offer;
  update public.items set status = 'open' where (id = o.item_id or id = any (o.part_item_ids)) and status = 'pledged';
end $$;
