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

-- Give every new account a profile row so names resolve from the first visit.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, split_part(coalesce(new.email, 'trader'), '@', 1))
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
  status      text not null default 'open' check (status in ('open', 'pledged', 'traded')),
  created_at  timestamptz not null default now()
);

create index if not exists items_created_idx on public.items (created_at desc);
create index if not exists items_owner_idx on public.items (owner_id);

alter table public.items enable row level security;

drop policy if exists "items readable by everyone" on public.items;
create policy "items readable by everyone" on public.items for select using (true);

drop policy if exists "insert own item" on public.items;
create policy "insert own item" on public.items for insert with check (auth.uid() = owner_id);

drop policy if exists "update own item" on public.items;
create policy "update own item" on public.items for update using (auth.uid() = owner_id);

drop policy if exists "delete own item" on public.items;
create policy "delete own item" on public.items for delete using (auth.uid() = owner_id);

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
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer;
  if not found then raise exception 'offer not found'; end if;
  if o.owner_id <> auth.uid() then raise exception 'only the person who posted the item can accept'; end if;
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
  select * into o from public.offers where id = p_offer;
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
    update public.items  set status = 'traded' where id = o.item_id;
  end if;
end $$;

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
