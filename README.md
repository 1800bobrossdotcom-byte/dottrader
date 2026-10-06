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
site/app.html      the board
site/config.js     Supabase project URL + anon key
site/photos.js         browser-side compress + metadata strip + upload
supabase/schema.sql    tables, row-level security, the two transition functions
supabase/wallets.sql   wallet + cross-chain asset columns
supabase/privacy.sql   offers readable only by their two parties
supabase/storage.sql   photo bucket and upload policies
supabase/verify.sql    proof-of-item table, badge view, withdraw + cancel
supabase/location.sql  rough lat/lng on profiles for "near me" and the map
supabase/functions/verify-item/index.ts   Edge Function that scores a proof photo
```

**Setup**

1. Create a Supabase project.
2. Run `supabase/schema.sql` first, then `wallets.sql`, `privacy.sql`, `storage.sql`,
   `verify.sql` and `location.sql`, in the SQL editor.
3. Under Authentication → URL Configuration, set the Site URL to your domain and
   add `/app` to the redirect URLs.
4. Put the project URL and the **anon public** key into `site/config.js`.
5. For Proof of item: Edge Functions → Deploy a new function, name it
   `verify-item`, paste `supabase/functions/verify-item/index.ts`. Then Edge
   Functions → Secrets → add `ANTHROPIC_API_KEY`. The function reads
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the environment Supabase
   gives it; nothing needs pasting for those.

Without step 5 the board still works; the "Prove you have it" button simply
reports that the checker is unavailable.

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

## Leaving a trade

An offer you made can be withdrawn while it is pending. An agreed trade can be
cancelled by either side, but only while that side has not yet pressed their
dot — pressing says "mine arrived", and you do not get to say that and then
walk away. The item goes back on the board and the cancellation stays on the
record, visible to the other party.

## A note on the schema

`offers` has no update or delete policy at all. Both transitions that matter go
through `accept_offer` and `press_dot` instead, because if either party could
write an offer row directly, whoever made the offer could set the *other* side's
confirmation and close a trade alone — exactly what the two-sided press exists
to prevent. The functions check who is calling and set only that caller's own
field.
