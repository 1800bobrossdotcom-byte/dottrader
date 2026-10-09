// Dot Trading Post — trade bonds, through Stripe.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name it `bond`, paste this
// file. Under the function's settings turn "Verify JWT" OFF: it identifies the caller itself, from
// their session, on every request. Then Edge Functions → Secrets → add STRIPE_SECRET_KEY (start
// with the sk_test_ key). Optional secrets: BOND_CENTS (default 2500), BOND_FEE_CENTS (default 300),
// BOND_HANDLING_CENTS (default 250), SITE_URL (default https://www.dottrader.app).
//
// HOW A BOND WORKS. Either side of an agreed trade can put a hold on their card for the bond plus
// the fee. Stripe holds it; nothing is charged yet.
//   · the trade completes          → only the fee is captured, the rest of the hold drops away
//   · the trade is called off      → the hold is released in full, no fee
//   · one side is a no-show        → their whole hold is captured, and the bond amount less a
//                                    handling fee becomes a payout owed to the other side, released
//                                    once someone running the board approves it (payouts.approved
//                                    in the Table Editor). The other side's own fee is refunded.
// Card holds last seven days, which is why trades have a four-day ship-by date: the case a bond is
// for — "they never sent anything" — is decided inside that window, and the honest side must close
// the no-show before the hold lapses. Once a trader has marked their side sent, their bond has done
// its job, so on day six the fee is taken and the rest released rather than lost to the lapse.
//
// THE SWEEP. The database calls {action: "sweep"} every ten minutes while any bond is open (the
// dtp-bonds job in notifications.sql), with a secret from app_config in the x-bond-key header that
// the function checks against the same row. It finishes checkouts that never came back to the
// board, settles finished trades, takes day-six fees, refunds fees owed back, recreates a missing
// payout, and records lapsed holds. Every money movement carries an idempotency key that names
// the payment it moves, so running it twice changes nothing.
//
// "Sent" for a side means it marked its side sent, or the OTHER side pressed their dot (a press
// says "theirs arrived").
//
// No libraries, so it runs anywhere and is easy to read: Stripe's REST API and the database's REST
// API, both with fetch.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const BOND = Number(Deno.env.get("BOND_CENTS") ?? 2500);
const FEE = Number(Deno.env.get("BOND_FEE_CENTS") ?? 300);
const HANDLING = Number(Deno.env.get("BOND_HANDLING_CENTS") ?? 250);
const SITE = (Deno.env.get("SITE_URL") ?? "https://www.dottrader.app").replace(/\/$/, "");
const HOLD_DAYS = 7;       // how long a card hold lasts
const FEE_DAY = 6;         // the day the fee is taken from a sender's hold, before it can lapse
const DAY = 86400e3;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

class Refusal extends Error { status: number; constructor(msg: string, status = 400) { super(msg); this.status = status; } }

// ---------------------------------------------------------------- database (service role)
async function db(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json",
      Prefer: init.prefer ?? "return=representation",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const one = async (path: string) => { const rows = await db(path); return Array.isArray(rows) ? rows[0] ?? null : null; };
type Row = Record<string, any>;

async function caller(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) throw new Refusal("sign in first", 401);
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: auth } });
  if (!r.ok) throw new Refusal("sign in first", 401);
  const u = await r.json();
  if (!u?.id) throw new Refusal("sign in first", 401);
  return { id: String(u.id), email: String(u.email ?? "") };
}

// ---------------------------------------------------------------- Stripe
function form(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}
async function stripe(path: string, params?: Record<string, unknown>, idem?: string, method = "POST") {
  const headers: Record<string, string> = { Authorization: `Bearer ${STRIPE_KEY}` };
  if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idem) headers["Idempotency-Key"] = idem;
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers, body: method === "GET" ? undefined : form(params ?? {}).toString() });
  const j = await r.json();
  if (j.error) { const e = new Error(j.error.message) as Error & { stripe?: unknown }; e.stripe = j.error; throw e; }
  return j;
}
// A hold that lapsed (cards drop them after about a week) can't be captured or cancelled.
const lapsed = (e: unknown) => /payment_intent_unexpected_state|charge_expired_for_capture/.test((e as { stripe?: { code?: string } }).stripe?.code ?? "");

// ---------------------------------------------------------------- actions
async function partyOffer(offerId: string, uid: string) {
  if (!/^[0-9a-f-]{36}$/i.test(offerId)) throw new Refusal("bad offer id");
  const o = await one(`offers?id=eq.${offerId}&select=*`);
  if (!o) throw new Refusal("offer not found", 404);
  if (o.owner_id !== uid && o.from_id !== uid) throw new Refusal("you are not part of this trade", 403);
  return o;
}

async function start(uid: string, email: string, offerId: string) {
  const o = await partyOffer(offerId, uid);
  if (o.status !== "agreed") throw new Refusal("a bond can only be put on an agreed trade");
  const existing = await one(`bonds?offer_id=eq.${offerId}&user_id=eq.${uid}&select=*`);
  if (existing) {
    // Money has already moved on this row: a hold is live, a fee was taken, or it was forfeited.
    if (existing.status === "held" || existing.status === "forfeited") throw new Refusal("you already have a bond on this trade");
    if (existing.status === "released") throw new Refusal("your bond on this trade has already done its job");
    // A checkout still in progress: if it has already authorised, that is the bond; if it is still
    // open, close it so it can't be paid as well as the new one.
    if (existing.status === "pending" && existing.checkout_id) {
      const state = await checkoutState(existing);
      if (state === "held") throw new Refusal("you already have a bond on this trade");
      if (state === "open") await stripe(`checkout/sessions/${existing.checkout_id}/expire`, {}, `expire-${existing.checkout_id}`).catch(() => null);
    }
  }
  const session = await stripe("checkout/sessions", {
    mode: "payment",
    customer_email: email || undefined,
    client_reference_id: uid,
    line_items: { 0: { quantity: 1, price_data: { currency: "usd", unit_amount: BOND + FEE, product_data: {
      name: "Trade bond — Dot Trading Post",
      description: `A hold of ${money(BOND + FEE)}, not a charge. If the trade completes, the ${money(FEE)} fee is kept and the rest released; ` +
        `once you've marked your side sent, the fee is taken on day six instead. If the trade is called off, nothing is kept. ` +
        `If you never send, the whole ${money(BOND + FEE)} is captured and ${money(BOND - Math.min(HANDLING, BOND))} goes to the other trader. Terms: ${SITE}/terms`,
    } } } },
    payment_method_types: { 0: "card" },
    payment_intent_data: { capture_method: "manual", metadata: { offer_id: offerId, user_id: uid } },
    metadata: { offer_id: offerId, user_id: uid },
    success_url: `${SITE}/app?bond=ok&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/app?bond=cancelled`,
  });
  const row = { offer_id: offerId, user_id: uid, amount_cents: BOND, fee_cents: FEE, handling_cents: Math.min(HANDLING, BOND), checkout_id: session.id, payment_intent: null,
    status: "pending", held_at: null, fee_captured_cents: 0, fee_refunded_cents: 0, settled_at: null, created_at: new Date().toISOString() };
  if (existing) await db(`bonds?id=eq.${existing.id}&status=eq.${existing.status}`, { method: "PATCH", body: row });
  else await db("bonds", { method: "POST", body: row });
  return { url: session.url };
}

// What Stripe says about a checkout: held (the card authorised), failed (declined, abandoned, or
// the session expired), or still open.
async function checkoutState(b: Row): Promise<"held" | "failed" | "open"> {
  const s = await stripe(`checkout/sessions/${b.checkout_id}?expand[]=payment_intent`, undefined, undefined, "GET");
  const pi = s.payment_intent;
  if (pi && pi.status === "requires_capture") {
    const heldAt = pi.created ? new Date(Number(pi.created) * 1000).toISOString() : new Date().toISOString();
    await db(`bonds?id=eq.${b.id}&status=in.(pending,failed)`, { method: "PATCH", body: { status: "held", payment_intent: pi.id, held_at: heldAt } });
    return "held";
  }
  // Only over when Stripe says so: an expired session, or a payment that was cancelled. Anything
  // else (3-D Secure in progress, still on the page) is looked at again next time.
  if (s.status === "expired" || (pi && pi.status === "canceled")) {
    await db(`bonds?id=eq.${b.id}&status=eq.pending`, { method: "PATCH", body: { status: "failed" } });
    return "failed";
  }
  return "open";
}

async function confirm(uid: string, sessionId: string) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new Refusal("bad session");
  const b = await one(`bonds?checkout_id=eq.${sessionId}&select=*`);
  if (!b) throw new Refusal("bond not found", 404);
  if (b.user_id !== uid) throw new Refusal("not your bond", 403);
  if (b.status !== "pending" && b.status !== "failed") return { status: b.status === "held" ? "held" : "failed" };
  const state = await checkoutState(b);
  return { status: state === "held" ? "held" : "failed" };
}

// Close out every bond on a finished trade. Safe to call any number of times, by either side or
// by the sweep: each money movement is keyed by the payment it moves, and each row is only moved
// from the state it is in. One bond's error doesn't stop the others being settled.
async function settleOffer(o: Row) {
  if (o.status === "pending" || o.status === "agreed") return 0;
  const bonds = await db(`bonds?offer_id=eq.${o.id}&select=*`) as Row[];
  let settled = 0, err: unknown = null;
  for (const b of bonds) {
    const now = new Date().toISOString(), pi = b.payment_intent;
    const loser = !!o.defaulted_by && o.defaulted_by === b.user_id;
    const winner = b.user_id === o.owner_id ? o.from_id : o.owner_id;
    const handling = Math.min(b.handling_cents ?? HANDLING, b.amount_cents);
    const owe = () => db("payouts?on_conflict=bond_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
      body: { bond_id: b.id, user_id: winner, amount_cents: b.amount_cents - handling, handling_cents: handling } });
    try {
      if (b.status === "held") {
        if (o.status === "done") {
          if (b.fee_cents > 0) await stripe(`payment_intents/${pi}/capture`, { amount_to_capture: b.fee_cents }, `capture-fee-${b.id}-${pi}`);
          else await stripe(`payment_intents/${pi}/cancel`, {}, `cancel-${b.id}-${pi}`);
          await db(`bonds?id=eq.${b.id}&status=eq.held`, { method: "PATCH", body: { status: "released", fee_captured_cents: b.fee_cents, settled_at: now } });
        } else if (loser) {
          await stripe(`payment_intents/${pi}/capture`, {}, `capture-all-${b.id}-${pi}`);
          // The payout row first: if writing it fails, the bond stays held and the next pass
          // replays the (keyed) capture and tries again.
          await owe();
          await db(`bonds?id=eq.${b.id}&status=eq.held`, { method: "PATCH", body: { status: "forfeited", fee_captured_cents: b.fee_cents, settled_at: now } });
        } else {
          await stripe(`payment_intents/${pi}/cancel`, {}, `cancel-${b.id}-${pi}`);
          await db(`bonds?id=eq.${b.id}&status=eq.held`, { method: "PATCH", body: { status: "released", settled_at: now } });
        }
        settled++;
      } else if (b.status === "forfeited" && loser) {
        await owe();   // a no-op when the payout is already there
      } else if (b.status === "released" && o.status === "cancelled" && !loser && b.fee_captured_cents > b.fee_refunded_cents) {
        // Their fee was taken on day six because they had sent; then the trade ended without them
        // getting theirs. Nobody pays for a trade that failed through no fault of theirs.
        const back = b.fee_captured_cents - b.fee_refunded_cents;
        await stripe("refunds", { payment_intent: pi, amount: back, metadata: { bond_id: b.id, why: o.defaulted_by ? "no-show by the other side" : "the trade was called off" } }, `refund-fee-${b.id}-${pi}`);
        await db(`bonds?id=eq.${b.id}&status=eq.released`, { method: "PATCH", body: { fee_refunded_cents: b.fee_captured_cents } });
        settled++;
      }
    } catch (e) {
      if (b.status === "held" && lapsed(e)) {
        await db(`bonds?id=eq.${b.id}&status=eq.held`, { method: "PATCH", body: { status: "expired", settled_at: now } }).catch(() => null);
      } else { err ??= e; console.error("[settle]", b.id, (e as Error).message); }
    }
  }
  if (err) throw err;
  return settled;
}

async function settle(uid: string, offerId: string) {
  const o = await partyOffer(offerId, uid);
  if (o.status === "pending" || o.status === "agreed") return { settled: 0, note: "the trade is still in progress" };
  return { settled: await settleOffer(o) };
}

// Everything the clock does to bonds, run by the database every ten minutes while any is open.
async function sweep() {
  const out = { held: 0, failed: 0, settled: 0, fees: 0, expired: 0 };
  // 1. Checkouts that never came back to the board: ask Stripe how they ended.
  const pending = await db("bonds?status=eq.pending&select=*") as Row[];
  for (const b of pending) {
    const age = Date.now() - new Date(b.created_at).getTime();
    if (age < 2 * 60e3) continue;                       // they may still be on the checkout page
    try {
      const state = age > 25 * 3600e3 && !b.checkout_id ? "failed" : await checkoutState(b);
      if (state === "held") out.held++;
      else if (state === "failed" || age > 25 * 3600e3) { if (state !== "failed") await db(`bonds?id=eq.${b.id}&status=eq.pending`, { method: "PATCH", body: { status: "failed" } }); out.failed++; }
    } catch (e) { console.error("[sweep pending]", b.id, (e as Error).message); }
  }
  // 2. Holds on trades that have finished, day-six fees, and holds that lapsed.
  const held = await db("bonds?status=eq.held&select=*") as Row[];
  const offers: Record<string, Row | null> = {};
  for (const b of held) {
    try {
      const o = offers[b.offer_id] ??= await one(`offers?id=eq.${b.offer_id}&select=*`);
      if (!o) continue;
      if (o.status !== "agreed" && o.status !== "pending") { out.settled += await settleOffer(o); continue; }
      const heldAt = new Date(b.held_at || b.created_at).getTime(), days = (Date.now() - heldAt) / DAY;
      const side = b.user_id === o.owner_id ? "owner" : "from";
      const sent = !!o[`${side}_sent_at`] || !!(side === "owner" ? o.confirm_from : o.confirm_owner);
      if (sent && days >= FEE_DAY) {
        // They sent, so their bond has done its job: take the fee now rather than lose it to the lapse.
        try {
          if (b.fee_cents > 0) await stripe(`payment_intents/${b.payment_intent}/capture`, { amount_to_capture: b.fee_cents }, `capture-fee-${b.id}-${b.payment_intent}`);
          else await stripe(`payment_intents/${b.payment_intent}/cancel`, {}, `cancel-${b.id}-${b.payment_intent}`);
          await db(`bonds?id=eq.${b.id}&status=eq.held`, { method: "PATCH", body: { status: "released", fee_captured_cents: b.fee_cents, settled_at: new Date().toISOString() } });
          out.fees++;
        } catch (e) {
          if (!lapsed(e)) throw e;
          await db(`bonds?id=eq.${b.id}&status=eq.held`, { method: "PATCH", body: { status: "expired", settled_at: new Date().toISOString() } });
          out.expired++;
        }
      } else if (days >= HOLD_DAYS + 0.5) {
        // Past the week: if Stripe has let it go, say so, so the board stops calling it held.
        const pi = await stripe(`payment_intents/${b.payment_intent}`, undefined, undefined, "GET");
        if (pi.status === "canceled") { await db(`bonds?id=eq.${b.id}&status=eq.held`, { method: "PATCH", body: { status: "expired", settled_at: new Date().toISOString() } }); out.expired++; }
      }
    } catch (e) { console.error("[sweep held]", b.id, (e as Error).message); }
  }
  // 3. Finished trades with nothing left held but something still owed: a fee taken on day six on a
  //    trade that was then called off or no-showed, or a forfeit whose payout row never got written.
  const owed = [...await db("bonds?status=eq.released&fee_captured_cents=gt.0&select=*") as Row[], ...await db("bonds?status=eq.forfeited&select=*") as Row[]];
  for (const b of owed) {
    if (b.status === "released" && b.fee_captured_cents <= b.fee_refunded_cents) continue;
    try {
      const o = offers[b.offer_id] ??= await one(`offers?id=eq.${b.offer_id}&select=*`);
      if (!o || o.status !== "cancelled") continue;
      if (b.status === "forfeited" && await one(`payouts?bond_id=eq.${b.id}&select=id`)) continue;
      out.settled += await settleOffer(o);
    } catch (e) { console.error("[sweep owed]", b.id, (e as Error).message); }
  }
  return out;
}

async function payout(uid: string) {
  const owed = await db(`payouts?user_id=eq.${uid}&status=eq.owed&approved=eq.true&select=*`) as Row[];
  const waiting = await db(`payouts?user_id=eq.${uid}&status=eq.owed&approved=eq.false&select=id`) as unknown[];
  if (!owed.length) return { paid: 0, waiting: waiting.length };
  let acct = await one(`stripe_accounts?user_id=eq.${uid}&select=*`);
  if (!acct) {
    const a = await stripe("accounts", { type: "express", capabilities: { transfers: { requested: true } }, metadata: { user_id: uid } }, `account-${uid}`);
    await db("stripe_accounts", { method: "POST", body: { user_id: uid, account_id: a.id } });
    acct = { account_id: a.id };
  }
  const a = await stripe(`accounts/${acct.account_id}`, undefined, undefined, "GET");
  if (a.capabilities?.transfers !== "active") {
    const link = await stripe("account_links", { account: acct.account_id, type: "account_onboarding",
      refresh_url: `${SITE}/app?payout=retry`, return_url: `${SITE}/app?payout=back` });
    return { onboarding: link.url };
  }
  let paid = 0;
  for (const p of owed) {
    // Paid out of the forfeited charge itself, so it doesn't wait for that charge to reach the
    // available balance (two business days, longer on a new account).
    const b = p.bond_id ? await one(`bonds?id=eq.${p.bond_id}&select=payment_intent`) : null;
    const pi = b?.payment_intent ? await stripe(`payment_intents/${b.payment_intent}`, undefined, undefined, "GET") : null;
    const charge = pi ? (typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id) : null;
    const t = await stripe("transfers", { amount: p.amount_cents, currency: "usd", destination: acct.account_id, source_transaction: charge || undefined, metadata: { payout_id: p.id } }, `transfer-${p.id}-${charge || "balance"}`);
    await db(`payouts?id=eq.${p.id}&status=eq.owed`, { method: "PATCH", body: { status: "paid", transfer_id: t.id, paid_at: new Date().toISOString() } });
    paid++;
  }
  return { paid, waiting: waiting.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // A plain GET says the function is here and what a bond costs, so the board can show the price.
  if (req.method === "GET") return json({ bond_cents: BOND, fee_cents: FEE, handling_cents: HANDLING, hold_days: HOLD_DAYS, live: STRIPE_KEY.startsWith("sk_live_") });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!STRIPE_KEY) return json({ error: "bonds are not switched on yet" }, 503);
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "sweep") {
      const key = (await one("app_config?key=eq.bond_sweep_key&select=value"))?.value;
      if (!key || req.headers.get("x-bond-key") !== key) return json({ error: "not allowed" }, 401);
      return json(await sweep());
    }
    const who = await caller(req);
    switch (body.action) {
      case "start": return json(await start(who.id, who.email, String(body.offer_id ?? "")));
      case "confirm": return json(await confirm(who.id, String(body.session_id ?? "")));
      case "settle": return json(await settle(who.id, String(body.offer_id ?? "")));
      case "payout": return json(await payout(who.id));
      default: return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof Refusal) return json({ error: e.message }, e.status);
    console.error("[bond]", (e as Error).message);
    return json({ error: "the bond service had a problem — nothing was charged twice; try again shortly" }, 502);
  }
});
