-- Dot Trading Post — make offers private to the two people in them.
--
-- Run this in the Supabase SQL editor AFTER schema.sql and wallets.sql.
--
-- The original policy was `select using (true)`: every offer readable by anyone with the publishable
-- key, message and all. So a note meant for one person — "I can drop it round Tuesday, I'm on
-- Mill Lane" — was readable by every visitor to the board, and by anyone who ever found the key,
-- which is printed in the page by design. That is the actual privacy problem on this site, and no
-- amount of encrypting things in transit touches it, because the data was being handed out
-- correctly encrypted to people who should never have received it at all.
--
-- Dots are the complication. They are counted from the trade record, which means every visitor
-- needs to see THAT trades happened in order to compute anyone's score. So the row splits in two:
-- the fact of a trade stays public, and everything said inside it becomes private.

-- Full offer rows: only the two parties.
drop policy if exists "offers readable by everyone" on public.offers;
drop policy if exists "offers readable by the two parties" on public.offers;
create policy "offers readable by the two parties" on public.offers for select
  using (auth.uid() = owner_id or auth.uid() = from_id);

-- The public half: who traded with whom and how far it got. No `give`, no `msg`, and no asset
-- details — enough to count dots and show an offer tally, and nothing anyone would mind a stranger
-- reading.
--
-- security_invoker = off means the view runs as its owner, so it can see the rows the policy above
-- hides. That is the point of it, and it is also why the column list here is the security boundary:
-- anything added to this select becomes world-readable.
drop view if exists public.offer_signals;
create view public.offer_signals
  with (security_invoker = off) as
  select id, item_id, owner_id, from_id, status, confirm_owner, confirm_from, created_at
  from public.offers;

grant select on public.offer_signals to anon, authenticated;
