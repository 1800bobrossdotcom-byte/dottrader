-- Dot Trading Post — Proof of Item, plus the two missing exits from a trade.
--
-- Run this in the Supabase SQL editor AFTER schema.sql, wallets.sql, privacy.sql and storage.sql.
--
-- PROOF OF ITEM. Lifted from cbay. The person who posted an item writes a note by hand — their
-- name, today's date, and a one-time four-character code the board hands them — and photographs
-- it next to the item. A vision model then reads the handwriting and scores six things: does the
-- name match, is the date today, does the code match character for character, is the item in the
-- frame, is the note real pen on real paper, is the photo an original rather than a screenshot.
-- The code is the part that cannot be prepared in advance; the handwriting is the part that cannot
-- be copied from a listing elsewhere.
--
-- The scoring runs in an Edge Function (supabase/functions/verify-item) because it needs an API
-- key, and a key in a browser is a key everyone has. The function writes the result here with the
-- service role; nothing in the browser can mark an item verified.

create table if not exists public.verifications (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items on delete cascade,
  owner_id    uuid not null references auth.users on delete cascade,
  -- Four characters from an alphabet with no look-alikes: no 0/O, 1/I/L, 2/Z, 5/S, 8/B.
  code        text not null check (code ~ '^[ACDEFGHJKMNPQRTUVWXY3467]{4}$'),
  status      text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'expired')),
  proof_url   text,
  analysis    jsonb,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours',
  verified_at timestamptz
);

create index if not exists verifications_item_idx on public.verifications (item_id, created_at desc);

alter table public.verifications enable row level security;

-- Full rows, code included, are the owner's alone. The code is what makes a proof unforgeable in
-- advance, so it is never readable by anyone else before it has been used.
drop policy if exists "verifications readable by owner" on public.verifications;
create policy "verifications readable by owner" on public.verifications for select
  using (auth.uid() = owner_id);

-- No insert, update or delete policies at all: starting one goes through the function below, and
-- finishing one is the Edge Function's job, with the service role.

-- The public half: which items are verified, with the proof photo and the model's one-line read.
-- Same shape as offer_signals, and the same rule — this select list IS the security boundary.
drop view if exists public.verification_badges;
create view public.verification_badges
  with (security_invoker = off) as
  select id, item_id, owner_id, status, proof_url, verified_at,
         analysis -> 'scores' ->> 'summary'        as summary,
         (analysis -> 'scores' ->> 'weighted_score')::int as score
  from public.verifications
  where status = 'verified';

grant select on public.verification_badges to anon, authenticated;

-- Start a proof for one of your own open items. Any live pending attempt on the item is expired
-- first, so there is exactly one code in play at a time.
create or replace function public.start_verification(p_item uuid)
returns table (id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare it public.items; alphabet text := 'ACDEFGHJKMNPQRTUVWXY3467'; c text := ''; i int;
begin
  select * into it from public.items where items.id = p_item;
  if not found then raise exception 'item not found'; end if;
  if it.owner_id <> auth.uid() then raise exception 'you can only verify your own items'; end if;
  if it.status <> 'open' then raise exception 'only an item still on the board can be verified'; end if;
  if exists (select 1 from public.verifications v where v.item_id = p_item and v.status = 'verified') then
    raise exception 'this item is already verified';
  end if;

  update public.verifications set status = 'expired'
   where item_id = p_item and status = 'pending';

  for i in 1..4 loop
    c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;

  return query
    insert into public.verifications (item_id, owner_id, code)
    values (p_item, auth.uid(), c)
    returning verifications.id, verifications.code, verifications.expires_at;
end $$;

-- ---------------------------------------------------------------- the two missing exits
--
-- The audit found that once a trade was agreed there was no way out. If one side went quiet the
-- item sat pledged forever, and a pending offer could never be taken back. cbay has withdraw; the
-- cancel after agreement is new — cbay has the same gap.

-- Take back an offer you made, while it is still pending.
create or replace function public.withdraw_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_offer;
  if not found then raise exception 'offer not found'; end if;
  if o.from_id <> auth.uid() then raise exception 'only the person who made the offer can withdraw it'; end if;
  if o.status <> 'pending' then raise exception 'only a pending offer can be withdrawn'; end if;
  update public.offers set status = 'withdrawn' where id = p_offer;
end $$;

-- Walk away from an agreed trade. Either side may, but only while THEY have not pressed their dot:
-- pressing says "my side arrived", and you do not get to say that and then cancel. The item goes
-- back on the board. The record of the cancellation stays — a negative signal for dots later.
alter table public.offers drop constraint if exists offers_status_check;
alter table public.offers add constraint offers_status_check
  check (status in ('pending', 'agreed', 'done', 'declined', 'cancelled', 'withdrawn'));

alter table public.offers add column if not exists cancelled_by uuid;

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
  update public.items set status = 'open' where id = o.item_id;
end $$;
