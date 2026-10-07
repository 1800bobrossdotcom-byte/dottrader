// Notify Edge Function: who gets which email, exactly once, with the database, sign-in lookups and
// Resend replaced by in-memory fakes. Run: npm run test:notify
const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", RESEND_API_KEY: "re_test" };
let handler; globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const A = "a0000000-0000-0000-0000-000000000001", B = "b0000000-0000-0000-0000-000000000002", C = "c0000000-0000-0000-0000-000000000003";
const T = {
  profiles: [{ id: A, name: "Alice", email_notify: true }, { id: B, name: "Bob", email_notify: true }, { id: C, name: "Cara", email_notify: false }],
  items: [{ id: "11111111-1111-1111-1111-111111111111", title: "Switch OLED", owner_id: A, status: "open" }, { id: "22222222-2222-2222-2222-222222222222", title: "Charizard", owner_id: C, status: "open" }],
  offers: [{ id: "33333333-3333-3333-3333-333333333333", item_id: "11111111-1111-1111-1111-111111111111", owner_id: A, from_id: B, give: "Steam Deck", msg: "Can meet Sat", status: "pending", confirm_owner: false, confirm_from: false }],
  messages: [{ id: "44444444-4444-4444-4444-444444444444", offer_id: "33333333-3333-3333-3333-333333333333", from_id: B, body: "Still on for Saturday?" },
             { id: "55555555-5555-5555-5555-555555555555", offer_id: "33333333-3333-3333-3333-333333333333", from_id: B, body: "Hello?" }],
  notifications_sent: [],
};
const emails = [];
const users = { [A]: "alice@x.com", [B]: "bob@x.com", [C]: "cara@x.com" };
function filt(rows, qs) {
  for (const [k, v] of qs) { if (["select", "on_conflict"].includes(k)) continue;
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    rows = rows.filter(r => op === "eq" ? String(r[k]) === val : op === "gt" ? r[k] > val : op === "lt" ? r[k] < val : true); }
  return rows;
}
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const R = (b, s = 200) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status: s });
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return R({ id: "em_" + emails.length }); }
  const adm = url.match(/\/auth\/v1\/admin\/users\/(.+)$/); if (adm) return users[adm[1]] ? R({ id: adm[1], email: users[adm[1]] }) : R({}, 404);
  if (url.includes("/rest/v1/rpc/listing_alert_targets")) {
    const { p_item } = JSON.parse(init.body);
    return R(p_item === "22222222-2222-2222-2222-222222222222" ? [{ user_id: A, kind: "search", label: "pokemon cards", other_item: null }, { user_id: B, kind: "mutual", label: "Steam Deck", other_item: "x" }] : []);
  }
  const u = new URL(url); const table = u.pathname.split("/").pop(); const qs = [...u.searchParams.entries()];
  if ((init.method || "GET") === "GET") { const ors = qs.filter(([k]) => k === "ship_by"); let rows = filt(T[table], qs.filter(([k]) => k !== "ship_by")); for (const [, v] of ors) rows = filt(rows, [["ship_by", v]]); return R(rows); }
  if (init.method === "POST" && table === "notifications_sent") { const row = JSON.parse(init.body); if (T.notifications_sent.some(r => r.key === row.key)) return R([], 201); T.notifications_sent.push(row); return R([row], 201); }
  throw new Error("unexpected " + init.method + " " + url);
};
await import(new URL("../supabase/functions/notify/index.ts", import.meta.url).href);
const call = async body => { const r = await handler(new Request("https://proj.supabase.co/functions/v1/notify", { method: "POST", body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));
const last = () => emails[emails.length - 1];

let [s, j] = await call({ kind: "offer", id: "33333333-3333-3333-3333-333333333333" });
ok("new offer emails the listing's owner", j.sent === 1 && last().to[0] === "alice@x.com" && /Bob wants to trade for your Switch OLED/.test(last().html) && /Steam Deck/.test(last().html));
[s, j] = await call({ kind: "offer", id: "33333333-3333-3333-3333-333333333333" });
ok("the same event never emails twice", j.sent === 0 && emails.length === 1);
[s, j] = await call({ kind: "accepted", id: "33333333-3333-3333-3333-333333333333" });
ok("accepted is only sent once the offer really is agreed", j.sent === 0);
T.offers[0].status = "agreed"; T.offers[0].ship_by = new Date(Date.now() + 20 * 3600e3).toISOString();
[s, j] = await call({ kind: "accepted", id: "33333333-3333-3333-3333-333333333333" });
ok("accepted emails the offerer with the send-by date", j.sent === 1 && last().to[0] === "bob@x.com" && /Send your side by/.test(last().html));
[s, j] = await call({ kind: "message", id: "44444444-4444-4444-4444-444444444444" });
ok("a message emails the other side", j.sent === 1 && last().to[0] === "alice@x.com" && /Still on for Saturday/.test(last().html));
[s, j] = await call({ kind: "message", id: "55555555-5555-5555-5555-555555555555" });
ok("a second message in the same hour doesn't email again", j.sent === 0);
[s, j] = await call({ kind: "listing", id: "22222222-2222-2222-2222-222222222222" });
const subj = emails.slice(-2).map(e => e.to[0] + ": " + e.subject);
ok("a new listing alerts saved searches and mutual matches", j.sent === 2 && subj.some(x => /alice@x.com: New: Charizard/.test(x)) && subj.some(x => /bob@x.com: A mutual match for your Steam Deck/.test(x)), subj.join(" | "));
[s, j] = await call({ kind: "shipby_sweep", id: null });
ok("ship-by sweep reminds both unsent sides", j.sent === 2 && emails.slice(-2).every(e => /ship-by date is tomorrow/.test(e.subject)));
[s, j] = await call({ kind: "shipby_sweep", id: null });
ok("…once", j.sent === 0);
T.offers[0].defaulted_by = C; T.offers[0].status = "cancelled";
[s, j] = await call({ kind: "noshow", id: "33333333-3333-3333-3333-333333333333" });
ok("someone who turned emails off gets none", j.sent === 0);
[s, j] = await call({ kind: "offer", id: "99999999-9999-9999-9999-999999999999" });
ok("an unknown id sends nothing", j.sent === 0);
[s, j] = await call({ kind: "offer", id: "not-an-id" });
ok("a malformed id sends nothing", j.sent === 0);
[s, j] = await call({ kind: "drop-tables", id: null });
ok("an unknown kind sends nothing", j.sent === 0);
ok("every email has a plain-text part and a link to the email settings", emails.every(e => e.text && /app#profile/.test(e.html) && /app#profile/.test(e.text)));
ok("emails about a trade open My trades", emails.filter(e => /offer|message|accepted/i.test(e.subject)).every(e => /app#mine/.test(e.html)));
// Per-kind settings: Alice turns off message emails but keeps offers.
T.profiles[0].email_prefs = { messages: false };
T.messages.push({ id: "66666666-6666-6666-6666-666666666666", offer_id: "33333333-3333-3333-3333-333333333333", from_id: B, body: "Next hour" });
const hourAgo = T.notifications_sent.filter(r => !/^message:/.test(r.key)); T.notifications_sent.length = 0; T.notifications_sent.push(...hourAgo);
[s, j] = await call({ kind: "message", id: "66666666-6666-6666-6666-666666666666" });
ok("a kind switched off isn't sent", j.sent === 0);
T.offers.push({ id: "77777777-7777-7777-7777-777777777777", item_id: "11111111-1111-1111-1111-111111111111", owner_id: A, from_id: B, give: "Game Boy", msg: "", status: "pending" });
[s, j] = await call({ kind: "offer", id: "77777777-7777-7777-7777-777777777777" });
ok("…while the others still are", j.sent === 1 && last().to[0] === "alice@x.com");
// Each email in the recipient's own language, with links that keep it.
T.profiles[1].lang = "ja";
T.items.push({ id: "88888888-8888-8888-8888-888888888888", title: "Game Boy Color", owner_id: B, status: "open" });
T.offers.push({ id: "99999999-0000-4000-8000-000000000009", item_id: "88888888-8888-8888-8888-888888888888", owner_id: B, from_id: A, give: "Pikachu", msg: "", status: "pending" });
[s, j] = await call({ kind: "offer", id: "99999999-0000-4000-8000-000000000009" });
ok("a Japanese trader's email is in Japanese, and its links stay Japanese", j.sent === 1 && last().to[0] === "bob@x.com" && /新しいオファー/.test(last().subject) &&
  /Aliceさんが/.test(last().html) && /lang="ja"/.test(last().html) && /app\?lang=ja#mine/.test(last().html) && /app\?lang=ja#profile/.test(last().text), last().subject);
T.profiles[1].lang = "pt"; T.offers[T.offers.length - 1].status = "agreed"; T.offers[T.offers.length - 1].ship_by = "2026-10-10T12:00:00Z";
T.profiles[0].lang = "es";
[s, j] = await call({ kind: "accepted", id: "99999999-0000-4000-8000-000000000009" });
ok("…and a Spanish one in Spanish, with the date written the Spanish way", j.sent === 1 && last().to[0] === "alice@x.com" && /aceptó tu oferta/.test(last().subject) && /sábado/.test(last().html), last().subject);
console.log(res.join("\n")); if (res.some(r => !r.startsWith("PASS"))) process.exitCode = 1;
