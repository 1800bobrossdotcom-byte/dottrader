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
  { id: SD, owner_id: B, local_only: true, title: "Steam Deck 512GB", want: "a Nintendo Switch", want_cats: [], open_to_offers: false, cat: "Consoles & Retro", status: "open", photos: [], created_at: now },
  { id: PK, owner_id: B, title: "Pikachu promo", want: "", want_cats: [], open_to_offers: true, cat: "Trading Cards", status: "open", photos: [PIC], created_at: now }];
const offers = [{ id: "cccccccc-0000-4000-8000-000000000009", item_id: SD, owner_id: B, from_id: A, give: "Switch", give_items: [], msg: "", status: "agreed", ship_by: new Date(Date.now() + 3 * 864e5).toISOString(), created_at: now },{ id: "cccccccc-0000-4000-8000-000000000001", item_id: GB, owner_id: A, from_id: B, give: "Pikachu promo + cash", give_items: [PK], msg: "", status: "pending", created_at: now },
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
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, offers, offer_signals: offers, profiles: [{ id: A, name: "Alice" }, { id: B, name: "Bob", area: "Rochester, NY" }] }[t] || []) });
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
  ok("local pickup tag on the card", /Local pickup/.test(await p.textContent("#feed .item:has(h3:text-is('Steam Deck 512GB')) .foot")));
  ok("…not on others", !/Local pickup/.test(await p.textContent("#feed .item:has(h3:text-is('Pikachu promo')) .foot")));
  await p.click("#t-post"); await p.waitForTimeout(100);
  ok("post form offers local pickup only", await p.isVisible("#f-local"));
  await p.click("label:has(#f-isasset)"); await p.waitForTimeout(100);
  ok("…but not for an NFT", await p.isHidden("#f-localwrap"));
  await p.click("label:has(#f-isthing)"); await p.fill("#f-title", "Old sofa"); await p.check("#f-local");
  await p.click("#postBtn"); await p.waitForTimeout(500);
  const post = posts.find(x => /^items /.test(x));
  ok("posting saves local_only", post && /"local_only":true/.test(post), post && post.slice(0, 200));
  await p.click("#t-mine"); await p.waitForTimeout(300);
  const sendBtn = await p.$("button:has-text('Mark your side sent'), button:has-text('Mark sent'), button:has-text('sent')");
  if (sendBtn) { await sendBtn.click(); await p.waitForTimeout(200);
    const radios = await p.$$eval(".sheet input[name=how]", x => x.map(e => e.value + (e.checked ? "*" : "")));
    ok("marking a local trade sent: no Posted option, in person chosen", !radios.includes("post") && radios.includes("in_person*"), radios.join(","));
    await p.keyboard.press("Escape"); } else ok("found the mark-sent button", false);
  await b.close(); }
{ const { b, p } = await run();
  await p.evaluate(() => { const it = items.filter(x => x.title === "Steam Deck 512GB")[0]; it.status = "open"; openOffer(it); }); await p.waitForTimeout(200);
  ok("offer sheet says it's a meet-up, and where", /Local pickup only\. Bob won’t post it — you’ll meet up to swap, around Rochester, NY/.test(await p.textContent(".sheet .localnote")), await p.textContent(".sheet .localnote").catch(() => ""));
  await b.close(); }
console.log(res.join("\n"));
