import { chromium, VENDOR, OUT, ROOT, CSP } from "./harness.mjs";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: A, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const sess = { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id: A, email: "a@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const PIC = (c) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${c}"/></svg>`);
const I = (n) => "aaaaaaaa-0000-4000-8000-00000000000" + n;
const items = [
  { id: I(1), owner_id: B, title: "Charizard holo", cat: "Trading Cards", status: "traded", photos: [PIC("#F2518F")], created_at: ago(90) },
  { id: I(2), owner_id: C, title: "N64 + 4 games", cat: "Consoles & Retro", status: "traded", photos: [PIC("#2F56D6")], created_at: ago(90) },
  { id: I(3), owner_id: B, title: "Steam Deck", cat: "Video Games", status: "traded", photos: [], created_at: ago(90) },
  { id: I(4), owner_id: B, title: "Open lamp", cat: "Home & Kitchen", status: "open", photos: [], created_at: ago(1) }];
const hist = [
  { id: "h1", item_id: I(1), owner_id: B, from_id: C, give: "N64 + 4 games", give_items: [I(2)], done_at: ago(2), swapped: false, tracked: true },
  { id: "h2", item_id: I(3), owner_id: B, from_id: A, give: "Switch OLED", give_items: [], done_at: ago(30), swapped: false, tracked: false }];
const myOffers = [{ id: "h2", item_id: I(3), owner_id: B, from_id: A, give: "Switch OLED", give_items: [], status: "done", done_at: ago(30), created_at: ago(40) }];
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));
async function run(signedIn, noHistory) {
  const b = await chromium.launch({});
  const p = await (await b.newContext({ viewport: { width: 1000, height: 1200 } })).newPage();
  p.on("pageerror", e => res.push("PAGEERROR " + e.message));
  const hdr = { "access-control-allow-origin": "*" };
  await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, r => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, r => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/fonts\.|functions\/v1|api\/nft/, r => r.fulfill({ status: 404, body: "" }));
  await p.route(/supabase\.co\/rest\/v1\/(\w+)/, r => {
    const url = decodeURIComponent(r.request().url()), t = url.match(/rest\/v1\/(\w+)/)[1];
    if (t === "trade_history" && noHistory) return r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "42P01", message: "relation does not exist" }) });
    const ids = (url.match(/id=in\.\(([^)]*)\)/) || [])[1];
    if (t === "items" && ids) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(items.filter(x => ids.split(",").map(s => s.replace(/"/g, "")).includes(x.id))) });
    const data = { items: items.filter(x => x.status === "open"), trade_history: hist, offers: signedIn ? myOffers : [], offer_signals: [], profiles: [{ id: A, name: "Alice" }, { id: B, name: "Bob" }, { id: C, name: "Cara" }] }[t] || [];
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await p.route(/supabase\.co\/rest\/v1\/rpc\//, r => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await p.route(/supabase\.co\/(auth|realtime)/, r => r.fulfill({ status: signedIn ? 200 : 401, contentType: "application/json", body: JSON.stringify(signedIn ? sess.user : {}) }));
  await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
  if (signedIn) { await p.evaluate(([s]) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), [sess]); await p.reload({ waitUntil: "domcontentloaded" }); }
  await p.waitForTimeout(1800);
  return { b, p };
}
{ const { b, p } = await run(true);
  await p.click("#t-activity"); await p.waitForTimeout(300);
  const all = await p.$$eval("#allHist .tline", x => x.map(e => e.textContent));
  ok("Activity lists finished trades, newest first", all.length === 2 && all[0] === "Bob swapped Charizard holo with Cara for N64 + 4 games", all.join(" | "));
  ok("…told from my side when it was mine", all[1] === "You swapped Switch OLED with Bob for Steam Deck", all[1]);
  ok("…with both sides' pictures, fetched when not on the board", (await p.$$eval("#allHist .trow:first-child .tp img", x => x.length)) === 2);
  ok("…and how it was verified", /Tracked both ways/.test(await p.textContent("#allHist .trow:first-child .tmeta")));
  const mine = await p.$$eval("#myHist .tline", x => x.map(e => e.textContent));
  ok("Your finished trades: only mine", mine.length === 1 && /^You swapped Switch OLED/.test(mine[0]), mine.join(" | "));
  ok("stats line counts trades and traders", /2 trades finished between 3 traders/.test(await p.textContent("#actStats")), await p.textContent("#actStats"));
  ok("item titles link to their public pages", (await p.getAttribute("#allHist .trow:first-child .tline a", "href")) === "/item/charizard-holo-" + I(1));
  await p.screenshot({ path: OUT + "/activity.png", fullPage: false });
  await b.close(); }
{ const { b, p } = await run(false);
  ok("visitors see the tabs, Activity included", await p.isVisible("#t-activity") && await p.isVisible("#t-browse"));
  await p.click("#t-activity"); await p.waitForTimeout(300);
  ok("a visitor sees the board's trades, without a personal section", (await p.$$("#allHist .trow")).length === 2 && await p.$eval("#myHistWrap", e => e.hidden));
  await p.click("#t-post"); await p.waitForTimeout(300);
  ok("a visitor pressing + Post is asked to make an account", await p.isHidden("#post") && /account/i.test(await p.evaluate(() => (document.querySelector(".sheet, .veil") || {}).textContent || "")));
  await b.close(); }
{ const { b, p } = await run(true, true);
  ok("without history.sql: no Activity tab", await p.isHidden("#t-activity"));
  await b.close(); }
console.log(res.join("\n"));
