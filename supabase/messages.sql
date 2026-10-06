-- Dot Trading Post — messages between the two people in a trade.
--
-- Run after schema.sql and privacy.sql (setup.sql runs everything in order).
--
-- Once an offer exists, its two parties need somewhere to say "I can meet Saturday" or "here's
-- my postcode". Before this there was nowhere: an accepted trade had no way to arrange the swap.
-- A thread hangs off each offer and only its two parties can read or write it. Nothing here is
-- public, nothing is editable after sending, and a thread closes for new messages once a trade
-- is declined, withdrawn or cancelled.

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  offer_id    uuid not null references public.offers on delete cascade,
  from_id     uuid not null references auth.users on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index if not exists messages_offer_idx on public.messages (offer_id, created_at);

alter table public.messages enable row level security;

drop policy if exists "messages readable by the two parties" on public.messages;
create policy "messages readable by the two parties" on public.messages for select
  using (exists (
    select 1 from public.offers o
    where o.id = messages.offer_id and (auth.uid() = o.owner_id or auth.uid() = o.from_id)
  ));

drop policy if exists "parties write their own messages" on public.messages;
create policy "parties write their own messages" on public.messages for insert
  with check (
    auth.uid() = from_id
    and exists (
      select 1 from public.offers o
      where o.id = messages.offer_id
        and (auth.uid() = o.owner_id or auth.uid() = o.from_id)
        and o.status in ('pending', 'agreed', 'done')
    )
  );

-- No update or delete policy: what was said stays said.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
