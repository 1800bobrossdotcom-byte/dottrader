// Bond Edge Function: every money movement it asks Stripe for, with Stripe, the database and
// sign-in replaced by in-memory fakes. Run: npm run test:bond
const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", STRIPE_SECRET_KEY: "sk_test_x" };
let handler; globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const A = "a0000000-0000-0000-0000-000000000001", B = "b0000000-0000-0000-0000-000000000002", E = "e0000000-0000-0000-0000-000000000003";
const T = { offers: [], bonds: [], payouts: [], stripe_accounts: [] };
const stripeCalls = []; const idem = new Map(); let acctActive = false; let seq = 0;
const tokens = { tA: A, tB: B, tE: E };
function filt(rows, qs) { for (const [k, v] of qs) { if (["select", "on_conflict"].includes(k)) continue; const val = v.replace(/^eq\./, ""); rows = rows.filter(r => String(r[k]) === val); } return rows; }
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const m = init.method || "GET"; const R = (b, s = 200) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status: s });
  if (url.endsWith("/auth/v1/user")) { const t = (init.headers.Authorization || "").slice(7); return tokens[t] ? R({ id: tokens[t], email: t + "@x.com" }) : R({ msg: "bad jwt" }, 401); }
  if (url.includes("/rest/v1/")) {
    const u = new URL(url); const table = u.pathname.split("/").pop(); const qs = [...u.searchParams.entries()];
    if (m === "GET") return R(filt(T[table], qs));
    if (m === "POST") { const row = JSON.parse(init.body); if (table === "payouts" && T.payouts.some(p => p.bond_id === row.bond_id)) return R("", 201);
      const full = { id: table + (++seq), status: table === "payouts" ? "owed" : row.status, approved: false, ...row }; T[table].push(full); return R([full], 201); }
    if (m === "PATCH") { const rows = filt(T[table], qs); rows.forEach(r => Object.assign(r, JSON.parse(init.body))); return R(rows); }
  }
  if (url.startsWith("https://api.stripe.com/v1/")) {
    const path = url.slice(26), key = init.headers["Idempotency-Key"]; const body = Object.fromEntries(new URLSearchParams(init.body || ""));
    if (key && idem.has(key)) return R(idem.get(key));
    stripeCalls.push({ m, path, body, key });
    let out;
    if (path === "checkout/sessions") out = { id: "cs_test_" + (++seq), url: "https://checkout.stripe.com/c/pay/x", _body: body };
    else if (path.startsWith("checkout/sessions/")) { const id = path.split("/")[2].split("?")[0]; const b = T.bonds.find(x => x.checkout_id === id); out = { id, client_reference_id: b && b.user_id, payment_intent: { id: "pi_" + id, status: "requires_capture" } }; }
    else if (/payment_intents\/.*\/(capture|cancel)/.test(path)) out = { id: path.split("/")[1], status: path.endsWith("capture") ? "succeeded" : "canceled" };
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

let [s, j] = await call(null, null, "GET"); ok("GET tells the board the price", s === 200 && j.bond_cents === 2500 && j.fee_cents === 150);
[s, j] = await call(null, { action: "start", offer_id: "o1" }); ok("no session is refused", s === 401);
T.offers.push({ id: "11111111-1111-1111-1111-111111111111", owner_id: A, from_id: B, status: "pending" });
const O = T.offers[0].id;
[s, j] = await call("tE", { action: "start", offer_id: O }); ok("outsider can't bond someone else's trade", s === 403);
[s, j] = await call("tA", { action: "start", offer_id: O }); ok("can't bond a trade that isn't agreed yet", s === 400, j.error);
T.offers[0].status = "agreed";
[s, j] = await call("tA", { action: "start", offer_id: O }); const cs = stripeCalls.at(-1).body;
ok("start opens a Stripe checkout for a HOLD (manual capture) of bond + fee", s === 200 && /^https:\/\/checkout/.test(j.url) && cs["payment_intent_data[capture_method]"] === "manual" && cs["line_items[0][price_data][unit_amount]"] === "2650");
const sidA = T.bonds[0].checkout_id;
[s, j] = await call("tB", { action: "confirm", session_id: sidA }); ok("someone else can't confirm your checkout", s === 403);
[s, j] = await call("tA", { action: "confirm", session_id: sidA }); ok("confirm marks the bond held", j.status === "held" && T.bonds[0].status === "held");
[s, j] = await call("tA", { action: "start", offer_id: O }); ok("can't hold twice on one trade", s === 400);
await call("tB", { action: "start", offer_id: O }); await call("tB", { action: "confirm", session_id: T.bonds[1].checkout_id });
[s, j] = await call("tA", { action: "settle", offer_id: O }); ok("settling an unfinished trade does nothing", j.settled === 0 && T.bonds.every(b => b.status === "held"));

// clean finish: only the fee is captured from each
T.offers[0].status = "done"; const before = stripeCalls.length;
[s, j] = await call("tB", { action: "settle", offer_id: O });
const caps = stripeCalls.slice(before);
ok("completed trade captures only the $1.50 fee from each hold", j.settled === 2 && caps.length === 2 && caps.every(c => /capture$/.test(c.path) && c.body.amount_to_capture === "150"), caps.map(c => c.path + " " + c.body.amount_to_capture).join(", "));
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
ok("exactly one payout owed to the other side, unapproved", T.payouts.length === 1 && T.payouts[0].user_id === A && T.payouts[0].amount_cents === 2500 && !T.payouts[0].approved);

// payouts
[s, j] = await call("tA", { action: "payout" }); ok("unapproved payout waits for review", j.paid === 0 && j.waiting === 1);
T.payouts[0].approved = true;
[s, j] = await call("tA", { action: "payout" }); ok("approved payout first sends them to Stripe onboarding", /connect\.stripe\.com/.test(j.onboarding || ""));
acctActive = true; [s, j] = await call("tA", { action: "payout" });
ok("after onboarding the money is transferred", j.paid === 1 && T.payouts[0].status === "paid" && stripeCalls.some(c => c.path === "transfers" && c.body.amount === "2500" && c.body.destination === "acct_1"));
[s, j] = await call("tA", { action: "payout" }); ok("and never twice", j.paid === 0 && stripeCalls.filter(c => c.path === "transfers").length === 1);
[s, j] = await call("tB", { action: "payout" }); ok("the no-show has nothing to claim", j.paid === 0 && j.waiting === 0);
console.log(res.join("\n")); if (res.some(r => !r.startsWith("PASS"))) process.exitCode = 1;
