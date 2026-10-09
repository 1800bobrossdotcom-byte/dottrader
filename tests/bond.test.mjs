// Bond Edge Function: every money movement it asks Stripe for, with Stripe, the database and
// sign-in replaced by in-memory fakes. Run: npm run test:bond
const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", STRIPE_SECRET_KEY: "sk_test_x" };
let handler; globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const A = "a0000000-0000-0000-0000-000000000001", B = "b0000000-0000-0000-0000-000000000002", E = "e0000000-0000-0000-0000-000000000003";
const T = { offers: [], bonds: [], payouts: [], stripe_accounts: [] };
const stripeCalls = []; const idem = new Map(); let acctActive = false; let seq = 0;
// What Stripe would say about a checkout session or a payment intent, when a test wants something other than "held".
const sessionState = {}, piStatus = {};
const tokens = { tA: A, tB: B, tE: E };
function filt(rows, qs) { for (const [k, v] of qs) { if (["select", "on_conflict"].includes(k)) continue; const val = v.replace(/^eq\./, ""); rows = rows.filter(r => String(r[k]) === val); } return rows; }
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const m = init.method || "GET"; const R = (b, s = 200) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status: s });
  if (url.endsWith("/auth/v1/user")) { const t = (init.headers.Authorization || "").slice(7); return tokens[t] ? R({ id: tokens[t], email: t + "@x.com" }) : R({ msg: "bad jwt" }, 401); }
  if (url.includes("/rest/v1/")) {
    const u = new URL(url); const table = u.pathname.split("/").pop(); const qs = [...u.searchParams.entries()];
    if (m === "GET") return R(filt(T[table], qs));
    if (m === "POST") { const row = JSON.parse(init.body); if (table === "payouts" && T.payouts.some(p => p.bond_id === row.bond_id)) return R("", 201);
      const full = { id: table + (++seq), status: table === "payouts" ? "owed" : row.status, approved: false, created_at: new Date().toISOString(), ...row }; T[table].push(full); return R([full], 201); }
    if (m === "PATCH") { const rows = filt(T[table], qs); rows.forEach(r => Object.assign(r, JSON.parse(init.body))); return R(rows); }
  }
  if (url.startsWith("https://api.stripe.com/v1/")) {
    const path = url.slice(26), key = init.headers["Idempotency-Key"]; const body = Object.fromEntries(new URLSearchParams(init.body || ""));
    if (key && idem.has(key)) return R(idem.get(key));
    stripeCalls.push({ m, path, body, key });
    let out;
    if (path === "checkout/sessions") out = { id: "cs_test_" + (++seq), url: "https://checkout.stripe.com/c/pay/x", _body: body };
    else if (path.startsWith("checkout/sessions/")) { const id = path.split("/")[2].split("?")[0]; const b = T.bonds.find(x => x.checkout_id === id);
      out = sessionState[id] || { id, status: "complete", client_reference_id: b && b.user_id, payment_intent: { id: "pi_" + id, status: "requires_capture", created: Math.floor(Date.now() / 1000) } }; }
    else if (/payment_intents\/.*\/(capture|cancel)/.test(path)) { const id = path.split("/")[1]; if (piStatus[id] === "canceled") return R({ error: { code: "payment_intent_unexpected_state", message: "lapsed" } }); out = { id, status: path.endsWith("capture") ? "succeeded" : "canceled" }; }
    else if (/^payment_intents\/[^/]+$/.test(path) && m === "GET") out = { id: path.split("/")[1], status: piStatus[path.split("/")[1]] || "requires_capture" };
    else if (path === "refunds") out = { id: "re_" + (++seq) };
    else if (path === "accounts") out = { id: "acct_1" };
    else if (path === "accounts/acct_1") out = { id: "acct_1", capabilities: { transfers: acctActive ? "active" : "inactive" } };
    else if (path === "account_links") out = { url: "https://connect.stripe.com/setup/x" };
    else if (path === "transfers") out = { id: "tr_" + (++seq) };
    if (key) idem.set(key, out);
    return R(out);
  }
  throw new Error("unexpected fetch " + url);
};
await import(new URL("../supabase/functions/bond/index.ts", import.meta.url).href);
const call = async (tok, body, method = "POST") => { const r = await handler(new Request("https://proj.supabase.co/functions/v1/bond", { method, headers: tok ? { Authorization: "Bearer " + tok, "content-type": "application/json" } : {}, body: method === "POST" ? JSON.stringify(body) : undefined })); return [r.status, await r.json()]; };
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));

let [s, j] = await call(null, null, "GET"); ok("GET tells the board the price", s === 200 && j.bond_cents === 2500 && j.fee_cents === 300 && j.handling_cents === 250 && j.hold_days === 7, JSON.stringify(j));
[s, j] = await call(null, { action: "start", offer_id: "o1" }); ok("no session is refused", s === 401);
T.offers.push({ id: "11111111-1111-1111-1111-111111111111", owner_id: A, from_id: B, status: "pending" });
const O = T.offers[0].id;
[s, j] = await call("tE", { action: "start", offer_id: O }); ok("outsider can't bond someone else's trade", s === 403);
[s, j] = await call("tA", { action: "start", offer_id: O }); ok("can't bond a trade that isn't agreed yet", s === 400, j.error);
T.offers[0].status = "agreed";
[s, j] = await call("tA", { action: "start", offer_id: O }); const cs = stripeCalls.at(-1).body;
ok("start opens a Stripe checkout for a HOLD (manual capture) of bond + fee", s === 200 && /^https:\/\/checkout/.test(j.url) && cs["payment_intent_data[capture_method]"] === "manual" && cs["line_items[0][price_data][unit_amount]"] === "2800" && /terms/.test(cs["line_items[0][price_data][product_data][description]"]));
const sidA = T.bonds[0].checkout_id;
[s, j] = await call("tB", { action: "confirm", session_id: sidA }); ok("someone else can't confirm your checkout", s === 403);
[s, j] = await call("tA", { action: "confirm", session_id: sidA }); ok("confirm marks the bond held, and from when", j.status === "held" && T.bonds[0].status === "held" && /^20/.test(T.bonds[0].held_at || ""));
[s, j] = await call("tA", { action: "start", offer_id: O }); ok("can't hold twice on one trade", s === 400);
await call("tB", { action: "start", offer_id: O }); await call("tB", { action: "confirm", session_id: T.bonds[1].checkout_id });
[s, j] = await call("tA", { action: "settle", offer_id: O }); ok("settling an unfinished trade does nothing", j.settled === 0 && T.bonds.every(b => b.status === "held"));

// clean finish: only the fee is captured from each
T.offers[0].status = "done"; const before = stripeCalls.length;
[s, j] = await call("tB", { action: "settle", offer_id: O });
const caps = stripeCalls.slice(before);
ok("completed trade captures only the $3.00 fee from each hold", j.settled === 2 && caps.length === 2 && caps.every(c => /capture$/.test(c.path) && c.body.amount_to_capture === "300"), caps.map(c => c.path + " " + c.body.amount_to_capture).join(", "));
ok("…and the ledger says the fee was kept", T.bonds.slice(0, 2).every(b => b.status === "released" && b.fee_captured_cents === 300 && b.fee_refunded_cents === 0));
[s, j] = await call("tA", { action: "settle", offer_id: O }); ok("settling again charges nothing more", j.settled === 0 && stripeCalls.length === before + 2);

// no-show: B defaulted
T.offers.push({ id: "22222222-2222-2222-2222-222222222222", owner_id: A, from_id: B, status: "agreed" }); const O2 = T.offers[1].id;
await call("tA", { action: "start", offer_id: O2 }); await call("tA", { action: "confirm", session_id: T.bonds.at(-1).checkout_id });
await call("tB", { action: "start", offer_id: O2 }); await call("tB", { action: "confirm", session_id: T.bonds.at(-1).checkout_id });
T.offers[1].status = "cancelled"; T.offers[1].defaulted_by = B; const b2 = stripeCalls.length;
await Promise.all([call("tA", { action: "settle", offer_id: O2 }), call("tB", { action: "settle", offer_id: O2 })]);
const c2 = stripeCalls.slice(b2);
const bA = T.bonds.find(b => b.offer_id === O2 && b.user_id === A), bB = T.bonds.find(b => b.offer_id === O2 && b.user_id === B);
ok("no-show: their whole hold is captured", c2.some(c => c.path === `payment_intents/${bB.payment_intent}/capture` && !c.body.amount_to_capture) && bB.status === "forfeited");
ok("no-show: the other side's hold is released free", c2.some(c => c.path === `payment_intents/${bA.payment_intent}/cancel`) && bA.status === "released");
ok("two people settling at once capture once", c2.filter(c => c.path === `payment_intents/${bB.payment_intent}/capture`).length === 1, c2.length + " stripe calls");
ok("exactly one payout owed to the other side, less the $2.50 handling fee, unapproved", T.payouts.length === 1 && T.payouts[0].user_id === A && T.payouts[0].amount_cents === 2250 && T.payouts[0].handling_cents === 250 && !T.payouts[0].approved, JSON.stringify(T.payouts[0]));

// payouts
[s, j] = await call("tA", { action: "payout" }); ok("unapproved payout waits for review", j.paid === 0 && j.waiting === 1);
T.payouts[0].approved = true;
[s, j] = await call("tA", { action: "payout" }); ok("approved payout first sends them to Stripe onboarding", /connect\.stripe\.com/.test(j.onboarding || ""));
acctActive = true; [s, j] = await call("tA", { action: "payout" });
ok("after onboarding the money is transferred", j.paid === 1 && T.payouts[0].status === "paid" && stripeCalls.some(c => c.path === "transfers" && c.body.amount === "2250" && c.body.destination === "acct_1"));
[s, j] = await call("tA", { action: "payout" }); ok("and never twice", j.paid === 0 && stripeCalls.filter(c => c.path === "transfers").length === 1);
[s, j] = await call("tB", { action: "payout" }); ok("the no-show has nothing to claim", j.paid === 0 && j.waiting === 0);

// ---- the sweep: what the clock does while nobody is on the board
const ago = (days) => new Date(Date.now() - days * 86400e3).toISOString();
const offer = (id, extra = {}) => { const o = { id, owner_id: A, from_id: B, status: "agreed", ...extra }; T.offers.push(o); return o; };
[s, j] = await call(null, { action: "sweep" }); ok("the sweep needs no session", s === 200 && typeof j.held === "number", JSON.stringify(j));

// checkouts that never came back to the board
const O3 = offer("33333333-3333-3333-3333-333333333333").id;
await call("tA", { action: "start", offer_id: O3 }); const abandoned = T.bonds.at(-1);
await call("tB", { action: "start", offer_id: O3 }); const paidButLeft = T.bonds.at(-1);
sessionState[abandoned.checkout_id] = { id: abandoned.checkout_id, status: "expired", payment_intent: null };
await call(null, { action: "sweep" });
ok("a checkout under two minutes old is left alone", abandoned.status === "pending" && paidButLeft.status === "pending");
abandoned.created_at = ago(0.01); paidButLeft.created_at = ago(0.01);
[s, j] = await call(null, { action: "sweep" });
ok("an abandoned checkout is marked failed", abandoned.status === "failed", abandoned.status);
ok("a paid checkout nobody returned from is marked held, from when the card authorised", paidButLeft.status === "held" && !!paidButLeft.held_at && paidButLeft.payment_intent === "pi_" + paidButLeft.checkout_id, paidButLeft.status);

// day six: a sender's fee is taken; a non-sender's hold stays as the deterrent
const O4 = offer("44444444-4444-4444-4444-444444444444", { owner_sent_at: ago(2) });
await call("tA", { action: "start", offer_id: O4.id }); await call("tA", { action: "confirm", session_id: T.bonds.at(-1).checkout_id }); const senderBond = T.bonds.at(-1);
await call("tB", { action: "start", offer_id: O4.id }); await call("tB", { action: "confirm", session_id: T.bonds.at(-1).checkout_id }); const idlerBond = T.bonds.at(-1);
senderBond.held_at = ago(5.5); idlerBond.held_at = ago(5.5);
await call(null, { action: "sweep" });
ok("before day six nothing is taken", senderBond.status === "held" && idlerBond.status === "held");
senderBond.held_at = ago(6.1); idlerBond.held_at = ago(6.1); const b4 = stripeCalls.length;
[s, j] = await call(null, { action: "sweep" });
ok("on day six the sender's fee is taken and the rest released", senderBond.status === "released" && senderBond.fee_captured_cents === 300 && stripeCalls.slice(b4).some(c => c.path === `payment_intents/${senderBond.payment_intent}/capture` && c.body.amount_to_capture === "300"), JSON.stringify(j));
ok("…while the side that hasn't sent stays held", idlerBond.status === "held");
await call(null, { action: "sweep" });
ok("sweeping again takes nothing more", stripeCalls.filter(c => c.path === `payment_intents/${senderBond.payment_intent}/capture`).length === 1);

// then the idle side never sends and the trade is closed as a no-show
O4.status = "cancelled"; O4.defaulted_by = B; const b5 = stripeCalls.length;
await call(null, { action: "sweep" }); const c5 = stripeCalls.slice(b5);
ok("the no-show's whole hold is captured by the sweep", idlerBond.status === "forfeited" && c5.some(c => c.path === `payment_intents/${idlerBond.payment_intent}/capture` && !c.body.amount_to_capture));
ok("the honest side's fee, taken on day six, is refunded", senderBond.fee_refunded_cents === 300 && c5.some(c => c.path === "refunds" && c.body.payment_intent === senderBond.payment_intent && c.body.amount === "300"), JSON.stringify(c5.map(c => c.path)));
ok("…and the payout is the bond less handling", T.payouts.some(p => p.bond_id === idlerBond.id && p.user_id === A && p.amount_cents === 2250));
await call("tA", { action: "settle", offer_id: O4.id });
ok("settling by hand afterwards refunds nothing twice", stripeCalls.filter(c => c.path === "refunds").length === 1);

// a hold that lapsed with nobody acting
const O5 = offer("55555555-5555-5555-5555-555555555555").id;
await call("tA", { action: "start", offer_id: O5 }); await call("tA", { action: "confirm", session_id: T.bonds.at(-1).checkout_id }); const lapsedBond = T.bonds.at(-1);
lapsedBond.held_at = ago(8); piStatus[lapsedBond.payment_intent] = "canceled";
await call(null, { action: "sweep" });
ok("a hold Stripe has let go is recorded as lapsed", lapsedBond.status === "expired", lapsedBond.status);
T.offers.find(o => o.id === O5).status = "done"; const b6 = stripeCalls.length;
[s, j] = await call("tA", { action: "settle", offer_id: O5 });
ok("a lapsed hold can't be charged when the trade later completes", stripeCalls.slice(b6).every(c => !/capture/.test(c.path)) && lapsedBond.status === "expired");

console.log(res.join("\n")); if (res.some(r => !r.startsWith("PASS"))) process.exitCode = 1;
