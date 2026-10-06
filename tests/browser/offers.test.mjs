import { chromium, VENDOR, OUT, ROOT, CSP, legacyBoard } from "./harness.mjs";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const SW = "aaaaaaaa-0000-4000-8000-000000000001", GB = "aaaaaaaa-0000-4000-8000-000000000002", SD = "bbbbbbbb-0000-4000-8000-000000000001", PK = "bbbbbbbb-0000-4000-8000-000000000002";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: A, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const sess = { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id: A, email: "a@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const now = new Date().toISOString();
const PIC = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#2F56D6"/></svg>');
const items = [
  { id: SW, owner_id: A, title: "Nintendo Switch OLED", want: "Steam Deck", want_cats: [], open_to_offers: true, cat: "Video Games", status: "open", photos: [PIC], created_at: now },
  { id: GB, owner_id: A, title: "Game Boy Color", want: "", want_cats: [], open_to_offers: true, cat: "Consoles & Retro", status: "open", photos: [], created_at: now },
  { id: SD, owner_id: B, title: "Steam Deck 512GB", want: "a Nintendo Switch", want_cats: [], open_to_offers: false, cat: "Consoles & Retro", status: "open", photos: [], created_at: now },
  { id: PK, owner_id: B, title: "Pikachu promo", want: "", want_cats: [], open_to_offers: true, cat: "Trading Cards", status: "open", photos: [PIC], created_at: now }];
const offers = [{ id: "cccccccc-0000-4000-8000-000000000001", item_id: GB, owner_id: A, from_id: B, give: "Pikachu promo + cash", give_items: [PK], msg: "", status: "pending", created_at: now },
  { id: "cccccccc-0000-4000-8000-000000000002", item_id: SW, owner_id: A, from_id: B, give: "5150_001 2/2", give_items: [], msg: "<3", status: "pending", created_at: now,
    asset_kind: "erc1155", asset_chain: 1, asset_contract: "0x2fe3000000000000000000000000000000ae4a", asset_token_id: "2" }];
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));
async function run(hash, old) {
  const b = await chromium.launch({});
  const ctx = await b.newContext({ viewport: { width: 1100, height: 1300 } });
  const p = await ctx.newPage(); const posts = [];
  p.on("pageerror", e => res.push("PAGEERROR " + e.message));
  const hdr = { "access-control-allow-origin": "*" };
  await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, r => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, r => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/fonts\.|functions\/v1/, r => r.fulfill({ status: 404, body: "" }));
  await p.route(/api\/nft/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "5150_001 #2/2", collection: "5150_001", image: PIC, description: "" }) }));
  await p.route(/publicnode|mainnet\.base|rpc\./, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" }) }));
  await p.route(/supabase\.co\/rest\/v1\/(\w+)/, r => {
    const req = r.request(), url = req.url(), t = url.match(/rest\/v1\/(\w+)/)[1];
    if (old && t === "offers" && /select=give_items/.test(url)) return r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "42703", message: "column offers.give_items does not exist" }) });
    if (req.method() === "POST") { posts.push(t + " " + req.postData()); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, offers, offer_signals: offers, profiles: [{ id: A, name: "Alice" }, { id: B, name: "Bob" }] }[t] || []) });
  });
  await p.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, r => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    const out = { my_matches: [{ my_item: SW, their_item: SD, they_want_mine: true, i_want_theirs: true }], wanted_counts: [] }[fn];
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out === undefined ? null : out) });
  });
  await p.route(/supabase\.co\/(auth|realtime)/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sess.user) }));
  await legacyBoard(p); await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
  await p.evaluate(([s]) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), [sess]);
  await p.goto("about:blank"); await legacyBoard(p); await p.goto("http://127.0.0.1:8765/app.html" + (hash || ""), { waitUntil: "domcontentloaded" }); await p.waitForTimeout(1800);
  return { b, p, posts };
}
{ const { b, p, posts } = await run();
  await p.click("#feed .item:has(h3:text-is('Pikachu promo')) button:has-text('Offer a trade')"); await p.waitForTimeout(200);
  const pms = await p.$$eval(".sheet .pm span:last-child", x => x.map(e => e.textContent));
  ok("the offer sheet lists my open posts", pms.length === 2 && pms.includes("Nintendo Switch OLED") && pms.includes("Game Boy Color"), pms.join("|"));
  await p.click(".sheet .pm:has-text('Nintendo Switch OLED')");
  ok("tapping one fills in the offer", (await p.inputValue("#o-give")) === "Nintendo Switch OLED");
  await p.click(".sheet .pm:has-text('Game Boy Color')");
  ok("tapping another adds it", (await p.inputValue("#o-give")) === "Nintendo Switch OLED + Game Boy Color");
  await p.screenshot({ path: OUT + "/offermine.png", clip: { x: 250, y: 150, width: 640, height: 720 } });
  await p.click(".sheet .pm:has-text('Game Boy Color')");
  ok("tapping again takes it out", (await p.inputValue("#o-give")) === "Nintendo Switch OLED" && (await p.getAttribute(".sheet .pm:has-text('Game Boy Color')", "aria-pressed")) === "false");
  await p.click(".sheet .pm:has-text('Game Boy Color')");
  await p.click(".sheet button[type=submit]"); await p.waitForTimeout(400);
  const o = posts.find(x => /^offers /.test(x));
  ok("an offer doesn't name the listing's owner — the database looks that up", o && !("owner_id" in JSON.parse(o.slice(7))));
  ok("sending puts both listings in the offer", o && JSON.stringify(JSON.parse(o.slice(7)).give_items) === JSON.stringify([SW, GB]), o && o.slice(0, 200));
  await p.click("#matchBox .mcard button"); await p.waitForTimeout(200);
  ok("Offer it from a match comes with my listing already picked", (await p.getAttribute(".sheet .pm:has-text('Nintendo Switch OLED')", "aria-pressed")) === "true" && (await p.inputValue("#o-give")) === "Nintendo Switch OLED");
  await p.keyboard.press("Escape");
  ok("cards spell out each trader's record", (await p.$$eval("#feed .item .who .rec", x => x.map(e => e.textContent))).every(t => t === "No trades yet"));
  ok("cards have a Share button", (await p.$$("#feed .item .linkbtn.share")).length === 4);
  await p.click("#t-mine"); await p.waitForTimeout(300);
  const chips = await p.$$eval(".offer .gitems a", x => x.map(e => e.textContent + " -> " + e.getAttribute("href")));
  await p.waitForTimeout(600);
  const art = await p.$$eval(".offer .opics .otile img", x => x.map(e => e.getAttribute("alt")));
  ok("offers show what is on offer as pictures: the NFT's artwork and the listing's photo", art.length === 2 && art.includes("5150_001 #2/2") && art.includes("Pikachu promo"), art.join("|"));
  await p.$eval(".offer:has-text('5150_001 2/2')", e => e.scrollIntoView());
  await p.screenshot({ path: OUT + "/offer-art.png", fullPage: false });
  ok("an incoming offer shows the listings put in, linked to their pages", chips.length === 1 && chips[0] === "Pikachu promo -> /item/pikachu-promo-" + PK, chips.join("|"));
  await p.screenshot({ path: OUT + "/offermine-in.png", fullPage: false });
  await b.close(); }
{ const { b, p } = await run("#item=" + SD);
  ok("/app#item=<id> opens an offer on that listing", /Steam Deck 512GB/.test(await p.$eval(".sheet", e => e.textContent).catch(() => "")));
  ok("…and clears the address", await p.evaluate(() => location.hash === ""));
  await b.close(); }
{ const { b, p } = await run("#cat=" + encodeURIComponent("Trading Cards"));
  const t = await p.$$eval("#feed .item h3", x => x.map(e => e.textContent));
  ok("/app#cat=<category> filters the board", t.length === 1 && t[0] === "Pikachu promo", t.join("|"));
  await b.close(); }
{ const { b, p } = await run("#mine");
  ok("an email's /app#mine link opens My trades", await p.isVisible("#mine") && await p.isHidden("#browse"));
  await p.click("button[data-go=profile]"); await p.waitForTimeout(200);
  ok("My trades has a way into the profile", await p.isVisible("#profile"));
  await b.close(); }
{ const { b, p } = await run("#profile");
  ok("an email's /app#profile link opens the profile", await p.isVisible("#profile") && (await p.textContent("#profName")) === "Alice" && (await p.textContent("#profAv")) === "A");
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + "/profile-phone.png", fullPage: true });
  ok("on a phone the profile button stays on screen", await p.isVisible("#profBtn"));
  await b.close(); }
{ const { b, p } = await run("", true);
  await p.click("#feed .item:has(h3:text-is('Pikachu promo')) button:has-text('Offer a trade')"); await p.waitForTimeout(200);
  ok("before setup.sql is re-run: no picker, just words", !(await p.$(".sheet .pm")) && (await p.textContent("label[for=o-give]")) === "What you are offering");
  await b.close(); }
console.log(res.join("\n"));
