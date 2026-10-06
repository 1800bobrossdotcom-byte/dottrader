-- Dot Trading Post — database schema.
--
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- The rule it enforces everywhere: a person can only ever write their own rows, and the two
-- transitions that matter — accepting an offer and pressing your dot — go through functions
-- rather than direct writes. That is deliberate. If offers were directly updatable by both
-- parties, the person who made an offer could set the OTHER side's confirmation and close a
-- trade alone, which is exactly the thing the two-sided press exists to prevent. The functions
-- check who is calling and set only that caller's own field.

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text,
  area        text,
  note        text,
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles readable by everyone" on public.profiles;
create policy "profiles readable by everyone" on public.profiles for select using (true);

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update using (auth.uid() = id);

-- Give every new account a profile row so names resolve from the first visit. The name is an
-- anonymous placeholder, never derived from the email: profiles are public, and the part of an
-- address before the @ is often a real name. The board asks people to choose their own.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, 'Trader ' || upper(substr(replace(new.id::text, '-', ''), 1, 4)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- items

create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  descr       text not null default '' check (char_length(descr) <= 600),
  want        text not null default '' check (char_length(want) <= 80),
  cat         text not null default 'Other',
  -- open: on the board · pledged: agreed, awaiting delivery · traded: finished
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);

-- open: on the board · pledged: in an agreed trade · traded: finished · removed: taken down by its
-- owner but kept, because trades that happened on it are part of other people's records.
alter table public.items drop constraint if exists items_status_check;
alter table public.items add constraint items_status_check check (status in ('open', 'pledged', 'traded', 'removed'));

create index if not exists items_created_idx on public.items (created_at desc);
create index if not exists items_owner_idx on public.items (owner_id);

alter table public.items enable row level security;

drop policy if exists "items readable by everyone" on public.items;
create policy "items readable by everyone" on public.items for select using (true);

drop policy if exists "insert own item" on public.items;
create policy "insert own item" on public.items for insert with check (auth.uid() = owner_id);

drop policy if exists "update own item" on public.items;
create policy "update own item" on public.items for update using (auth.uid() = owner_id);

-- No delete policy: deleting an item used to cascade away its offers, which let someone erase a
-- no-show or a finished trade from the record. remove_item() below deletes only an item nobody has
-- traded on, and otherwise takes it off the board while keeping the history.
drop policy if exists "delete own item" on public.items;

-- An item's status is the trade's business, not its owner's: new items start open, and only the
-- trade functions (which run as the database owner) move it after that. An owner editing a title
-- can't quietly reopen something they have promised to someone.
create or replace function public.items_guard() returns trigger
language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then new.status := 'open';
    elsif new.status is distinct from old.status then raise exception 'listing status changes go through the board';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists items_guard on public.items;
create trigger items_guard before insert or update on public.items
  for each row execute function public.items_guard();

create or replace function public.remove_item(p_item uuid)
returns text language plpgsql security definer set search_path = public as $$
declare it public.items;
begin
  select * into it from public.items where id = p_item for update;
  if not found then raise exception 'item not found'; end if;
  if it.owner_id <> auth.uid() then raise exception 'you can only remove your own listing'; end if;
  if it.status = 'pledged' then raise exception 'it is in an agreed trade — finish or cancel that first'; end if;
  if exists (select 1 from public.offers o where o.item_id = p_item and (o.status in ('agreed', 'done', 'cancelled'))) then
    update public.offers set status = 'declined' where item_id = p_item and status = 'pending';
    update public.items set status = 'removed' where id = p_item;
    return 'removed';
  end if;
  delete from public.items where id = p_item;
  return 'deleted';
end $$;

-- ---------------------------------------------------------------- offers

create table if not exists public.offers (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.items on delete cascade,
  owner_id       uuid not null references auth.users on delete cascade,  -- whoever posted the item
  from_id        uuid not null references auth.users on delete cascade,  -- whoever is offering
  give           text not null check (char_length(give) between 1 and 80),
  msg            text not null default '' check (char_length(msg) <= 400),
  status         text not null default 'pending'
                 check (status in ('pending', 'agreed', 'done', 'declined')),
  confirm_owner  boolean not null default false,
  confirm_from   boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists offers_item_idx on public.offers (item_id);
create index if not exists offers_people_idx on public.offers (owner_id, from_id);

alter table public.offers enable row level security;

drop policy if exists "offers readable by everyone" on public.offers;
create policy "offers readable by everyone" on public.offers for select using (true);

drop policy if exists "insert own offer" on public.offers;
create policy "insert own offer" on public.offers for insert
  with check (auth.uid() = from_id and auth.uid() <> owner_id);

-- Deliberately NO update or delete policy: every change to an offer goes through the functions
-- below, so neither party can write the other's confirmation.

-- ---------------------------------------------------------------- transitions

create or replace function public.accept_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers; it public.items;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  -- Lock the item, then check everything against it rather than against what the offer claims.
  -- Two accepts racing on one item now queue here; the second finds it pledged and stops.
  select * into it from public.items where id = o.item_id for update;
  if it.owner_id <> auth.uid() or o.owner_id <> it.owner_id then raise exception 'only the person who posted the item can accept'; end if;
  if it.status <> 'open' then raise exception 'this item is already in a trade'; end if;
  if o.status <> 'pending' then raise exception 'this offer is no longer pending'; end if;

  update public.offers set status = 'agreed' where id = p_offer;
  update public.items  set status = 'pledged' where id = o.item_id;
  -- Every other open offer on that item is now moot.
  update public.offers set status = 'declined'
   where item_id = o.item_id and id <> p_offer and status = 'pending';
end $$;

create or replace function public.decline_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  if o.owner_id <> auth.uid() then raise exception 'only the person who posted the item can decline'; end if;
  if o.status <> 'pending' then raise exception 'this offer is no longer pending'; end if;
  update public.offers set status = 'declined' where id = p_offer;
end $$;

-- Pressing your dot confirms YOUR side arrived and earns the other person a dot. The second
-- press closes the trade. The caller can only ever set their own field.
create or replace function public.press_dot(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers; v_both boolean;
begin
  select * into o from public.offers where id = p_offer for update;
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
    update public.items  set status = 'traded' where id = o.item_id;
  end if;
end $$;

-- The invariant the trade functions maintain, made impossible to break: one item, at most one live
-- or finished trade.
create unique index if not exists offers_one_trade_per_item on public.offers (item_id)
  where status in ('agreed', 'done');

-- ---------------------------------------------------------------- realtime

-- So every open browser sees new listings and offers without a refresh.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items') then
    alter publication supabase_realtime add table public.items;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'offers') then
    alter publication supabase_realtime add table public.offers;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
