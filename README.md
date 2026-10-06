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

## Running it

Static HTML on Vercel, with Supabase for the database and email sign-in. No
build step.

```
site/index.html    landing page
site/app.html      the board
site/config.js     Supabase project URL + anon key
supabase/schema.sql
```

**Setup**

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Under Authentication → URL Configuration, set the Site URL to your domain and
   add `/app` to the redirect URLs.
4. Put the project URL and the **anon public** key into `site/config.js`.

The anon key belongs in the page — that's what it's for. Row-level security in
the schema is what protects the data, which is why the `service_role` key must
never appear in this repository.

## A note on the schema

`offers` has no update or delete policy at all. Both transitions that matter go
through `accept_offer` and `press_dot` instead, because if either party could
write an offer row directly, whoever made the offer could set the *other* side's
confirmation and close a trade alone — exactly what the two-sided press exists
to prevent. The functions check who is calling and set only that caller's own
field.
