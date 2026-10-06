# Dot Trading Post

A barter board. Post what you have, say what you'd take for it, and swap with
someone who has it. No prices, no money, no listing fees.

**Live at [dottrader.app](https://dottrader.app)** · the board itself is at `/app`.

## How a trade works

1. **Post.** A title, a line about condition, and what you want back. "Open to
   offers" is a fine answer.
2. **Offer.** Someone says what they'd give. You see their dots before you
   decide.
3. **Agree.** Accepting takes the item off the board and commits both sides.
   Every other open offer on it is declined automatically.
4. **Press.** When your side arrives, you press your dot. That confirms you
   received it *and* earns the other person a dot. The trade closes only when
   both of you have pressed — one person can't finish it alone.

## Dots

Dots are the trust score, and they're the one thing the app guards.

| | |
|---|---|
| Completed trade | +2, both sides |
| The other side presses their dot for you | +1 |
| Profile filled in | +1 |
| Posting, browsing, anything you can do alone | 0 |

**No row anywhere stores a score.** Dots are counted from the trade record
itself, so every dot traces back to a swap someone else accepted or a press
someone else made. There is nothing to edit and nothing to buy.

## Digital assets, across chains

An item can be an NFT or tokens instead of a physical thing. Connect a wallet,
sign once to prove you control the address, and list the contract and token id.

Cross-chain needs no bridge, because nothing is swapped atomically. An NFT on
Base trades for one on Ethereum the same way a skillet trades for a bike: each
side sends, each side presses their dot. The eight chains supported are in
`CHAINS` in `site/app.html`; adding another is one line.

**None of it is taken on trust.** The database stores claims, not facts. Every
viewer's browser verifies the wallet signature locally, and reads the token's
current holder straight off that chain's own RPC. A listing whose asset has
since moved says *no longer held*, to everyone, without anyone reporting it.

A check that cannot reach the chain says so rather than guessing — "could not
check" is a different answer from "no longer held", and conflating them would
brand honest listings as fakes whenever an RPC hiccups.

## Running it

Static HTML on Vercel, with Supabase for the database and email sign-in. No
build step.

```
site/index.html    landing page
site/app.html      the board (markup only)
site/js/*.js       the board's scripts, loaded in order: core, assets, state, ui, post, wallet,
                   cards, protect, messages, board, match, map, verify, actions, auth, boot
site/css/board.css the board's styles
site/config.js     Supabase project URL + anon key
site/photos.js         browser-side compress + metadata strip + upload
supabase/schema.sql    tables, row-level security, the two transition functions
supabase/wallets.sql   wallet + cross-chain asset columns
supabase/privacy.sql   offers readable only by their two parties
supabase/storage.sql   photo bucket and upload policies
supabase/verify.sql    proof-of-item table, badge view, withdraw + cancel
supabase/location.sql  rough lat/lng on profiles for "near me" and the map
supabase/messages.sql  a private thread on each offer, for its two parties only
supabase/trades.sql    ship-by dates, "sent" + tracking, no-shows, swap orders, bonds, payouts
supabase/matching.sql  what each listing wants, mutual matches, saved searches
supabase/notifications.sql   database triggers that ask the notify function to send an email
supabase/history.sql   finished trades, public: what went for what, between whom, when
supabase/functions/notify/index.ts   Edge Function: the emails (offers, messages, matches, ship-by)
supabase/functions/bond/index.ts   Edge Function: Stripe card holds for trade bonds
site/swap.js           atomic NFT-for-NFT swaps through Seaport 1.6
api/nft.js             Vercel function: NFT name and artwork, read server-side
api/item.js            Vercel function: each listing's own page, /item/<id>, for links and search
api/c.js               Vercel function: category pages, /c/<category>, and /c for all of them
api/sitemap.js         Vercel function: /sitemap.xml, built from what is on the board
supabase/setup.sql     all of the above in order, in one paste (generated; safe to re-run)
supabase/functions/verify-item/index.ts   Edge Function that scores a proof photo
```

**Setup**

1. Create a Supabase project.
2. In the SQL editor, run `supabase/setup.sql`. It is every other `.sql` file in this folder in the
   right order, and it is safe to run again: re-running it is how a project picks up new features.
3. Under Authentication → URL Configuration, set the Site URL to your domain and add `/app` to the
   redirect URLs (both `https://dottrader.app/app` and `https://www.dottrader.app/app`).
4. Put the project URL and the **anon public** key into `site/config.js`.
5. Authentication → Emails: paste the three templates from `supabase/emails/` (Magic Link,
   Confirm signup, Reset Password), with the subjects written at the top of each file. The Magic
   Link one carries a typeable code, which is what the "Email me a code" sign-in uses.
6. For Proof of item: Edge Functions → Deploy a new function, name it `verify-item`, paste
   `supabase/functions/verify-item/index.ts`. Then Edge Functions → Secrets → add
   `ANTHROPIC_API_KEY`. The function reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the
   environment Supabase gives it; nothing needs pasting for those.

7. For trade bonds: create a Stripe account and turn on Connect (Express accounts), so a bond
   forfeited by a no-show can be paid to the other side. Edge Functions → Deploy a new function
   named `bond`, paste `supabase/functions/bond/index.ts`, and turn **Verify JWT off** for it (it
   checks the caller's session itself). Add the secret `STRIPE_SECRET_KEY` — start with your
   `sk_test_` key and switch to `sk_live_` when you are ready. Optional: `BOND_CENTS` (default
   2500), `BOND_FEE_CENTS` (default 150). Before charging real cards, publish terms of service
   that describe bonds, fees and how no-shows are decided.
8. For email notifications: create an API key at resend.com (the same account that sends your
   sign-in emails). Edge Functions → Deploy a new function named `notify`, paste
   `supabase/functions/notify/index.ts`, and turn **Verify JWT off** for it. Add the secret
   `RESEND_API_KEY`. Optional: `NOTIFY_FROM` (default `Dot Trading Post <hello@dottrader.app>`) and
   `SITE_URL`. Database → Extensions: turn on `pg_net` and `pg_cron`, then run `setup.sql` again so
   the triggers and the daily ship-by reminder can find them. Each trader can switch emails off
   in their profile.
9. For the swap fee: put the wallet that should receive it in `swapFee.recipient` in
   `site/config.js`. Empty means swaps are free. Per-chain amounts are in the same place.

Forfeited bonds become payouts that wait for a person: set `approved` to true on the row in
Table Editor → payouts once you are satisfied the other side really didn't send. The recipient
then claims it from My trades and Stripe walks them through getting paid.

The board probes for each optional piece (photos, location, messages, Proof of item, protected trades, bonds, matching, email settings) when it loads
and simply doesn't offer what the project hasn't switched on yet, so nothing fails halfway.

The anon key belongs in the page — that's what it's for. Row-level security in
the schema is what protects the data, which is why the `service_role` key must
never appear in this repository.

## Proof of item

Lifted from cbay. The board hands the lister a one-time four-character code
from an alphabet with no look-alikes. They write their name, today's date and
the code on paper by hand, photograph it next to the item, and a vision model
scores six things: name, date, code character by character, item in frame,
real pen on real paper, original photo rather than a screenshot. The code is
the part that cannot be prepared in advance; the handwriting is the part that
cannot be copied from a listing elsewhere.

The code is readable only by its owner, and only the Edge Function — holding the
service role — can mark a row verified. The page can ask; it cannot award.
Everyone else sees the public half through the `verification_badges` view: the
proof photo and a one-line read, never the code.

## Protected trades

An agreed trade gets a ship-by date four days out. Each side marks its own side sent — posted
with a tracking number, handed over in person, or moved on chain — and once you have, you can't
cancel. Past the date, a side that sent can close the trade against a side that didn't: a
no-show, which costs three dots and is visible on every card that person lists.

**Swaps.** When both sides are NFTs on the same chain, nobody sends first. The lister signs a
Seaport 1.6 order — their NFT for the other's, plus the board's flat fee if one is configured —
and the other side fills it in one transaction: both move, or neither does. The database refuses
an order that offers anything but the listed item or asks for anything but the offered one, and
the filler's browser checks the order again before the wallet opens. Approvals go to OpenSea's
conduit, which most holders have already approved.

**Bonds.** Either side can put a hold on their card through Stripe. A completed trade releases
the hold and keeps the fee; a called-off trade releases it in full; a no-show forfeits theirs to
the other side. Stripe holds the money, never this database. Card holds last about a week, which
is why the ship-by date is four days: the case a bond covers — "they never sent" — is decided
inside that window.

## Offering what you have already posted

An offer can put in up to six of the offerer's own open listings — tap them in the offer sheet
instead of describing them again. They must be the offerer's and still on the board when the offer
is made and again when it is accepted. Accepting pledges all of them along with the item; a
finished trade marks them all traded; a cancelled trade or a no-show puts them all back. Any other
pending offer that involves one of them — on it, or putting it in — is declined at that moment, so
one listing is never promised twice.

## Activity

Once both dots are pressed, a trade is public: the Activity tab lists the board's recent finished
trades, and each trader's own. It shows what went for what (the listing, the other side's words,
any listings or token they put in), between whom, when, and whether it was tracked both ways or
swapped on chain. Messages, tracking numbers and unfinished offers stay private.

## Shareable pages

Every listing has its own address, `/item/<id>`, rendered on the server so link previews and
search engines see its title, photo and what its owner wants. Category pages live at
`/c/<category>`, and `/sitemap.xml` lists every open listing. Taken-down listings answer 404;
traded ones stay readable but aren't indexed. "Make an offer" on those pages opens the board at
`/app#item=<id>`.

## Leaving a trade

An offer you made can be withdrawn while it is pending. An agreed trade can be
cancelled by either side, but only while that side has not yet pressed their
dot — pressing says "mine arrived", and you do not get to say that and then
walk away. The item goes back on the board and the cancellation stays on the
record, visible to the other party.

## Tests

```
npm run test:bond   # the bond Edge Function, with Stripe, the database and sign-in faked
npm run test:notify # the notify Edge Function, with Resend and the database faked
npm run test:pages  # listing, category and sitemap pages, with the database faked
npm run test:db     # 106 checks on a throwaway Postgres: the trade state machine, permissions,
                    # forged requests, and accepts racing on the same listings (needs PGHOST etc.)
```

The database suite applies `setup.sql` twice before each run, so it also proves the file is safe
to re-run.

## Rules the database enforces, not the page

- An offer's owner is looked up from the item; a new offer always starts pending, unconfirmed,
  with no no-show — whatever the request says.
- Accepting locks the item first; an item can have at most one agreed or finished trade (a unique
  index, not just a check).
- Listing status only moves through the trade functions. Remove deletes a listing nobody traded on
  and otherwise takes it off the board while keeping its history, so a no-show can't be erased.
- Locations are rounded to about a kilometre by a trigger, whatever the browser sends.
- New accounts get an anonymous name ("Trader 7F3A"), never one taken from the email.
- Proof-of-item photos live in a private bucket; the public badge says when an item was verified,
  never shows the photo.

## A note on the schema

`offers` has no update or delete policy at all. Both transitions that matter go
through `accept_offer` and `press_dot` instead, because if either party could
write an offer row directly, whoever made the offer could set the *other* side's
confirmation and close a trade alone — exactly what the two-sided press exists
to prevent. The functions check who is calling and set only that caller's own
field.
