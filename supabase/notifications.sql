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

-- pg_net lets the database make an HTTP call without waiting for it. On Supabase it is available;
-- elsewhere (a local test database) it may not be, and notifications are then simply off.
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net not available here: notifications stay off';
end $$;

create or replace function public.notify_event(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare base text;
begin
  if to_regproc('net.http_post') is null then return; end if;
  select value into base from public.app_config where key = 'functions_url';
  if base is null then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using base || '/notify', jsonb_build_object('kind', p_kind, 'id', p_id), '{"Content-Type": "application/json"}'::jsonb;
exception when others then
  raise warning 'notify_event % % failed: %', p_kind, p_id, sqlerrm;   -- never let an email break a trade
end $$;
revoke execute on function public.notify_event(text, uuid) from public, anon, authenticated;

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
exception when others then raise notice 'pg_cron not available here: no ship-by reminders';
end $$;
