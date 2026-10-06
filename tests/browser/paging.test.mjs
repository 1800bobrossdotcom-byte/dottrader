// The board a page at a time (scale.sql): one page from board_page, Load more, filters answered by
// the database, only the needed listings and people fetched, records from trader_stats.
import { chromium, VENDOR } from "./harness.mjs";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: A, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const sess = { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id: A, email: "a@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const ago = (m) => new Date(Date.now() - m * 60e3).toISOString();
const id = (n) => "aaaaaaaa-0000-4000-8000-" + String(n).padStart(12, "0");
const items = [];
for (let n = 1; n <= 70; n++) items.push({ id: id(n), owner_id: B, title: "Card " + n, want: "", want_cats: [], open_to_offers: true, cat: "Trading Cards", status: "open", photos: [], created_at: ago(n) });
items.push({ id: id(100), owner_id: B, title: "PS5 Digital Edition", want: "", want_cats: [], cat: "Video Games", status: "open", photos: [], created_at: ago(500), have_terms: ["ps5", "playstation", "console"] });
items.push({ id: id(200), owner_id: A, title: "My lamp", want: "", want_cats: [], cat: "Home & Kitchen", status: "open", photos: [], created_at: ago(900) });
items.push({ id: id(201), owner_id: A, title: "My old rug", want: "", want_cats: [], cat: "Home & Kitchen", status: "traded", photos: [], created_at: ago(9000) });
items.push({ id: id(300), owner_id: C, title: "Cara's ancient vase", want: "", want_cats: [], cat: "Antiques", status: "pledged", photos: [], created_at: ago(99999) });
const offers = [{ id: "cccccccc-0000-4000-8000-000000000001", item_id: id(300), owner_id: C, from_id: A, give: "My lamp", give_items: [], msg: "", status: "agreed", created_at: ago(50) }];
const stats = { [B]: { user_id: B, dots: 21, trades: 12, partners: 9, verified: 9, vouches: 8, profile: 1, no_shows: 0 }, [C]: { user_id: C, dots: 3, trades: 2, partners: 2, verified: 0, vouches: 1, profile: 0, no_shows: 1 } };
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1100, height: 1300 } })).newPage();
const log = [];
p.on("pageerror", e => res.push("PAGEERROR " + e.message));
const hdr = { "access-control-allow-origin": "*" };
await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, r => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, r => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
await p.route(/fonts\.|functions\/v1|api\/nft/, r => r.fulfill({ status: 404, body: "" }));
const J = (r, d) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
await p.route(/supabase\.co\/rest\/v1\/(\w+)/, r => {
  const url = decodeURIComponent(r.request().url()), t = url.match(/rest\/v1\/(\w+)/)[1];
  log.push(t + " " + url.split("?")[1]);
  const ids = (url.match(/(?:[?&](?:id|item_id))=in\.\(([^)]*)\)/) || [])[1];
  const inIds = ids ? ids.split(",").map(s => s.replace(/"/g, "")) : null;
  if (t === "items") {
    if (inIds) return J(r, items.filter(x => inIds.includes(x.id)));
    if (/owner_id=eq\./.test(url)) return J(r, items.filter(x => x.owner_id === A));
    return J(r, items.slice(0, 400));
  }
  if (t === "offers") return J(r, offers);
  if (t === "profiles") return J(r, [{ id: A, name: "Alice" }, { id: B, name: "Bob" }, { id: C, name: "Cara" }].filter(x => !inIds || inIds.includes(x.id)));
  return J(r, []);
});
await p.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, r => {
  const fn = r.request().url().match(/rpc\/(\w+)/)[1], body = JSON.parse(r.request().postData() || "{}");
  log.push("rpc " + fn + " " + JSON.stringify(body));
  if (fn === "board_page") {
    let rows = items.filter(x => x.status === "open" && x.owner_id !== "nobody");
    if (body.p_cat) rows = rows.filter(x => x.cat === body.p_cat);
    if (body.p_before) rows = rows.filter(x => x.created_at < body.p_before);
    if (body.p_q) { const q = body.p_q.toLowerCase(); rows = rows.filter(x => x.title.toLowerCase().includes(q) || (/playstation/.test(q) && (x.have_terms || []).includes("playstation"))); }
    rows.sort((a, c) => (a.created_at < c.created_at ? 1 : -1));
    return J(r, rows.slice(0, body.p_limit || 30));
  }
  if (fn === "trader_stats") return J(r, (body.p_ids || []).filter(x => stats[x]).map(x => stats[x]));
  return J(r, fn === "my_matches" || fn === "wanted_counts" || fn === "my_search_hits" ? [] : null);
});
await p.route(/supabase\.co\/(auth|realtime)/, r => J(r, sess.user));
await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
await p.evaluate(([s]) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), [sess]);
await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(1800);
const cards = () => p.$$eval("#feed .item h3", x => x.map(e => e.textContent));
let c = await cards();
ok("the board shows one page of listings", c.length === 30 && c[0] === "Card 1" && c[29] === "Card 30", c.length + " cards");
ok("…with a Load more button", await p.isVisible("#moreBtn"));
ok("it never fetches the whole board, every profile, or every trade", !log.some(l => /^items select=\*&order=created_at.desc&limit=400/.test(l)) && !log.some(l => /^offer_signals/.test(l)) && !log.some(l => /^profiles select=\*&limit=800/.test(l)), log.filter(l => /^(items|profiles|offer_signals) /.test(l)).join(" || ").slice(0, 300));
ok("profiles are fetched only for the people on screen", log.some(l => /^profiles .*id=in\./.test(l)));
ok("records come from the database, for those people", log.some(l => /^rpc trader_stats /.test(l) && l.includes(B) && l.includes(C)));
ok("a card spells out the record the database added up", (await p.textContent("#feed .item:has-text('Card 1') .who .rec")) === "12 trades · 9 verified · 0 no-shows");
await p.click("#moreBtn"); await p.waitForTimeout(500);
c = await cards();
ok("Load more adds the next page", c.length === 60 && c[59] === "Card 60", c.length + " cards");
await p.click("#moreBtn"); await p.waitForTimeout(500);
c = await cards();
ok("…and the last page, then the button goes", c.length === 72 && c[70] === "PS5 Digital Edition" && c[71] === "My lamp" && await p.isHidden("#moreBtn"), c.length + " cards");
await p.click("#t-mine"); await p.waitForTimeout(300);
ok("My trades shows a trade on a listing far off the board's pages", /Cara's ancient vase/.test(await p.textContent("#mine")));
ok("…and all my own listings, traded ones too", /My old rug/.test(await p.textContent("#myItems")) && /My lamp/.test(await p.textContent("#myItems")));
await p.click("#t-browse"); await p.waitForTimeout(100);
log.length = 0;
await p.fill("#q", "playstation 5"); await p.waitForTimeout(900);
c = await cards();
ok("a search is answered by the database, which knows other names for things", c.length === 1 && c[0] === "PS5 Digital Edition", c.join(","));
ok("…with the words sent to it", log.some(l => /^rpc board_page .*"p_q":"playstation 5"/.test(l)));
await p.fill("#q", ""); await p.waitForTimeout(700);
log.length = 0;
await p.click("#cats .chip:has-text('Video Games')"); await p.waitForTimeout(700);
ok("a category is answered by the database", log.some(l => /^rpc board_page .*"p_cat":"Video Games"/.test(l)) && (await cards()).join(",") === "PS5 Digital Edition");
await b.close();
console.log(res.join("\n"));
