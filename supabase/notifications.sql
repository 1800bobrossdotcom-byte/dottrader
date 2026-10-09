-- Dot Trading Post — email notifications.
--
-- Run after matching.sql (setup.sql runs everything in order). Needs the `notify` Edge Function
-- deployed to send anything; until then the triggers below simply knock on a door nobody answers.
--
-- People only learned about an offer or a message by opening the board. Now the database tells
-- the notify function when something happens — an offer arrives, one is accepted, a message is
-- sent, a listing goes up, a trade closes as a no-show — and a daily sweep catches ship-by dates
-- due tomorrow. The function works out who to tell and sends the email. It is told only WHAT
-- happened (a kind and an id); it reads everything else itself, so a forged call can at most
-- prompt an email that was due anyway, and each email is recorded so it can never go twice.

alter table public.profiles add column if not exists email_notify boolean not null default true;
-- Which kinds of email, under that switch. A kind set to false is off; anything missing is on.
-- Kinds: offers, trades (accepted, no-shows), messages, matches (saved searches, mutual matches),
-- reminders (ship-by).
alter table public.profiles add column if not exists email_prefs jsonb not null default '{}';
alter table public.profiles drop constraint if exists profiles_email_prefs_object;
alter table public.profiles add constraint profiles_email_prefs_object check (jsonb_typeof(email_prefs) = 'object');
-- The language the board and its emails speak to this trader in (English, Spanish, Japanese,
-- Brazilian Portuguese). Empty until the board first sets it.
alter table public.profiles add column if not exists lang text;
alter table public.profiles drop constraint if exists profiles_lang_known;
alter table public.profiles add constraint profiles_lang_known check (lang is null or lang in ('en', 'es', 'ja', 'pt'));

-- What has been sent. Written only by the notify function (service role); no policies.
create table if not exists public.notifications_sent (
  key         text primary key,
  user_id     uuid,
  kind        text,
  created_at  timestamptz not null default now()
);
alter table public.notifications_sent enable row level security;

-- Where the functions live. Public information (it is in site/config.js too); kept here so the
-- triggers know where to knock. Change it if the project moves.
create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;
insert into public.app_config (key, value)
values ('functions_url', 'https://yujxwfghmauajrpduagl.supabase.co/functions/v1')
on conflict (key) do nothing;
-- The notify function's address. Supabase's editor can give a new function a random address
-- (e.g. "clever-function") whatever its label says; set this to the last part of its URL.
insert into public.app_config (key, value) values ('notify_function', 'notify') on conflict (key) do nothing;

-- pg_net lets the database make an HTTP call without waiting for it. On Supabase it is available;
-- elsewhere (a local test database) it may not be, and notifications are then simply off.
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net not available here: notifications stay off';
end $$;

create or replace function public.notify_event(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare base text; fn text;
begin
  if to_regproc('net.http_post') is null then return; end if;
  select value into base from public.app_config where key = 'functions_url';
  if base is null then return; end if;
  select value into fn from public.app_config where key = 'notify_function';
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using base || '/' || coalesce(nullif(btrim(fn), ''), 'notify'), jsonb_build_object('kind', p_kind, 'id', p_id), '{"Content-Type": "application/json"}'::jsonb;
exception when others then
  raise warning 'notify_event % % failed: %', p_kind, p_id, sqlerrm;   -- never let an email break a trade
end $$;
revoke execute on function public.notify_event(text, uuid) from public, anon, authenticated;

-- The bond function's address (see notify_function above), and the tick that drives it: Stripe's
-- holds lapse on a clock, so the function's sweep runs every ten minutes while any bond is open.
insert into public.app_config (key, value) values ('bond_function', 'bond') on conflict (key) do nothing;
-- A secret only the database and the bond function know (app_config has no read policy, so the API
-- can't see it; the function reads it with the service key). The sweep refuses calls without it.
insert into public.app_config (key, value) values ('bond_sweep_key', md5(gen_random_uuid()::text || clock_timestamp()::text) || md5(gen_random_uuid()::text)) on conflict (key) do nothing;
create or replace function public.bond_tick()
returns void language plpgsql security definer set search_path = public as $$
declare base text; fn text; k text;
begin
  if to_regproc('net.http_post') is null then return; end if;
  select value into base from public.app_config where key = 'functions_url';
  if base is null then return; end if;
  select value into fn from public.app_config where key = 'bond_function';
  select value into k from public.app_config where key = 'bond_sweep_key';
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using base || '/' || coalesce(nullif(btrim(fn), ''), 'bond'), '{"action": "sweep"}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-bond-key', coalesce(k, ''));
  perform public.notify_event('bond_sweep', null);
exception when others then
  raise warning 'bond_tick failed: %', sqlerrm;
end $$;
revoke execute on function public.bond_tick() from public, anon, authenticated;

create or replace function public.notify_offers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.notify_event('offer', new.id);
  elsif new.status is distinct from old.status then
    if new.status = 'agreed' then perform public.notify_event('accepted', new.id);
    elsif new.status = 'cancelled' and new.defaulted_by is not null then perform public.notify_event('noshow', new.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists notify_offers on public.offers;
create trigger notify_offers after insert or update of status on public.offers
  for each row execute function public.notify_offers();

-- An on-chain send waiting to be checked: ask the function to read the chain now.
create or replace function public.notify_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.owner_tx_status = 'checking' and old.owner_tx_status is distinct from 'checking')
     or (new.from_tx_status = 'checking' and old.from_tx_status is distinct from 'checking') then
    perform public.notify_event('verify_tx', new.id);
  end if;
  return null;
end $$;
drop trigger if exists notify_delivery on public.offers;
create trigger notify_delivery after update of owner_tx_status, from_tx_status on public.offers
  for each row execute function public.notify_delivery();

create or replace function public.notify_messages() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.notify_event('message', new.id); return null; end $$;
drop trigger if exists notify_messages on public.messages;
create trigger notify_messages after insert on public.messages
  for each row execute function public.notify_messages();

create or replace function public.notify_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.notify_event('listing', new.id); return null; end $$;
drop trigger if exists notify_items on public.items;
create trigger notify_items after insert on public.items
  for each row execute function public.notify_items();

-- Who a new listing should be mentioned to: people whose saved search it fits, and owners of
-- listings it is a mutual match for. Only the notify function (service role) may ask — saved
-- searches are private.
create or replace function public.listing_alert_targets(p_item uuid)
returns table (user_id uuid, kind text, label text, other_item uuid)
language sql stable security definer set search_path = public as $$
  select distinct on (w.user_id) w.user_id, 'search'::text, coalesce(nullif(w.label, ''), array_to_string(w.cats, ', ')), null::uuid
  from public.items x join public.saved_wants w on w.user_id <> x.owner_id and public.search_fits(w, x)
  where x.id = p_item and x.status = 'open'
  union all
  select y.owner_id, 'mutual'::text, y.title, y.id
  from public.items x join public.items y on y.status = 'open' and y.owner_id <> x.owner_id
   and public.wants_item(y.want_cats, y.want_terms, x) and public.wants_item(x.want_cats, x.want_terms, y)
  where x.id = p_item and x.status = 'open';
$$;
revoke execute on function public.listing_alert_targets(uuid) from public, anon, authenticated;
grant execute on function public.listing_alert_targets(uuid) to service_role;

-- A daily nudge for trades whose ship-by date is within a day. pg_cron is available on Supabase;
-- where it isn't, there is simply no reminder.
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'dtp-shipby';
  perform cron.schedule('dtp-shipby', '7 14 * * *', $job$ select public.notify_event('shipby_sweep', null) $job$);
  -- Transactions the chain hadn't confirmed yet when they were first checked: look again.
  perform cron.unschedule(jobid) from cron.job where jobname = 'dtp-verify';
  perform cron.schedule('dtp-verify', '*/10 * * * *', $job$ select public.notify_event('verify_sweep', null) where exists (select 1 from public.offers where owner_tx_status = 'checking' or from_tx_status = 'checking') $job$);
  -- Bonds: finish checkouts, settle finished trades, take day-six fees, notice lapsed holds, and
  -- remind the honest side to close a no-show before the other side's hold lapses.
  perform cron.unschedule(jobid) from cron.job where jobname = 'dtp-bonds';
  perform cron.schedule('dtp-bonds', '*/10 * * * *', $job$ select public.bond_tick() where exists (select 1 from public.bonds b join public.offers o on o.id = b.offer_id
    where b.status in ('pending', 'held') or (b.fee_captured_cents > 0 and b.settled_at > now() - interval '2 days')
       or (b.status = 'released' and b.fee_captured_cents > b.fee_refunded_cents and o.status = 'cancelled')
       or (b.status = 'forfeited' and not exists (select 1 from public.payouts p where p.bond_id = b.id))) $job$);
exception when others then raise notice 'pg_cron not available here: no ship-by reminders';
end $$;
