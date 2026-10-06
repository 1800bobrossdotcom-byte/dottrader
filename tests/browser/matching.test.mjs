import { chromium, VENDOR, OUT, ROOT, CSP, legacyBoard } from "./harness.mjs";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: A, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const sess = { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id: A, email: "a@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const now = new Date().toISOString();
const items = [
  { id: "sw", owner_id: A, title: "Nintendo Switch OLED", want: "Steam Deck", want_cats: ["Consoles & Retro"], open_to_offers: true, cat: "Video Games", status: "open", created_at: now },
  { id: "sd", owner_id: B, title: "Steam Deck 512GB", want: "a Nintendo Switch", want_cats: [], open_to_offers: false, cat: "Consoles & Retro", status: "open", created_at: now },
  { id: "ch", owner_id: C, title: "Charizard holo", want: "", want_cats: ["Video Games"], open_to_offers: true, cat: "Trading Cards", status: "open", created_at: now }];
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));
async function run(matching, noPairs) {
  const b = await chromium.launch({}).catch(() => chromium.launch());
  const p = await (await b.newContext({ viewport: { width: 1100, height: 1300 } })).newPage();
  const posts = []; let saved = [{ id: "w1", user_id: A, label: "pokemon cards", cats: ["Trading Cards"], terms: ["pokemon", "card"], created_at: now }];
  p.on("pageerror", e => res.push("PAGEERROR " + e.message));
  const hdr = { "access-control-allow-origin": "*" };
  await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, r => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, r => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/fonts\.|functions\/v1|api\/nft/, r => r.fulfill({ status: 404, body: "" }));
  await p.route(/supabase\.co\/rest\/v1\/(\w+)/, r => {
    const req = r.request(), url = req.url(), t = url.match(/rest\/v1\/(\w+)/)[1];
    if ((t === "items" && /select=want_cats/.test(url) || t === "profiles" && /select=email_notify/.test(url)) && !matching) return r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "42703", message: "column items.want_cats does not exist" }) });
    if (req.method() === "POST" || req.method() === "DELETE") { posts.push(t + " " + req.method() + " " + (req.postData() || url.split("?")[1]));
      if (t === "saved_wants" && req.method() === "POST") { const bd = JSON.parse(req.postData()); saved.unshift({ id: "w" + (saved.length + 1), ...bd, terms: [], created_at: now }); }
      return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, profiles: [{ id: A, name: "Alice", email_notify: false }, { id: B, name: "Bob" }, { id: C, name: "Cara" }], saved_wants: saved }[t] || []) });
  });
  await p.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, r => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    const out = { wanted_counts: [{ item_id: "sw", listings: 2, searches: 1 }, { item_id: "ch", listings: 0, searches: 1 }],
      my_matches: noPairs ? [] : [{ my_item: "sw", their_item: "ch", they_want_mine: true, i_want_theirs: false, score: 52, nearby: true }, { my_item: "sw", their_item: "sd", they_want_mine: true, i_want_theirs: true, score: 140, nearby: false }],
      my_search_hits: [{ want_id: "w1", item_id: "ch" }], listings_wanting: ["sd", "ch"] }[fn];
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out === undefined ? null : out) });
  });
  await p.route(/supabase\.co\/(auth|realtime)/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sess.user) }));
  await legacyBoard(p); await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
  await p.evaluate(([s]) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), [sess]);
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(1800);
  return { b, p, posts };
}
{ const { b, p, posts } = await run(true);
  const tags = await p.$$eval("#matchBox .mtag", t => t.map(x => x.textContent));
  ok("matches strip: best score first, with a Nearby chip where it applies", tags.join(",") === "Both ways,Wants yours,Nearby" && /1 mutual match/.test(await p.$eval("#matchBox .sub", e => e.textContent)), tags.join(","));
  await p.click("#matchBox .mcard:first-of-type button"); await p.waitForTimeout(150);
  ok("Offer it opens the offer pre-filled with my item", (await p.inputValue("#o-give")) === "Nintendo Switch OLED" && /Steam Deck/.test(await p.$eval(".sheet", e => e.textContent)));
  await p.keyboard.press("Escape");
  const wa = await p.$eval("#feed .item:has(h3:text-is('Steam Deck 512GB')) .side.w .v", e => e.textContent), wb = await p.$eval("#feed .item:has-text('Charizard') .side.w .v", e => e.textContent);
  ok("Wants box reads structured wants", wa === "a Nintendo Switch" && wb === "Any Video Games · open to other offers", wa + " / " + wb);
  ok("cards show how many want them", (await p.$eval("#feed .item:has-text('Charizard') .tag.want", e => e.textContent)) === "1 want this");
  await p.fill("#q", "pokemon"); await p.waitForTimeout(150);
  ok("Save search appears while searching", !(await p.$eval("#saveSearch", e => e.hidden)));
  await p.click("#saveSearch"); await p.waitForTimeout(400);
  ok("…and saves what was searched", posts.some(x => /^saved_wants POST .*"label":"pokemon"/.test(x)));
  await p.fill("#q", ""); await p.click("#t-mine"); await p.waitForTimeout(300);
  ok("My items: 3 want this, with See who wants it", (await p.$eval("#myItems .tag.want", e => e.textContent)) === "3 want this" && !!(await p.$("#myItems button:has-text('See who wants it')")));
  await p.click("#myItems button:has-text('See who wants it')"); await p.waitForTimeout(500);
  const who = await p.$$eval("#wantList button", bs => bs.map(x => x.textContent));
  ok("See who lists the listings that want it", who.length === 2 && /Steam Deck/.test(who[0]), who.join(" | ").slice(0, 120));
  await p.click("#wantList button:first-child"); await p.waitForTimeout(200);
  ok("…and one tap offers it to them", (await p.inputValue("#o-give")) === "Nintendo Switch OLED");
  await p.keyboard.press("Escape");
  ok("Looking for lists saved searches with their hits", /pokemon cards/.test(await p.$eval("#lookList", e => e.textContent)) && /1 listing fits/.test(await p.$eval("#lookList", e => e.textContent)));
  await p.fill("#look-q", "game boy color"); await p.selectOption("#look-cat", "Consoles & Retro"); await p.click("#lookForm button"); await p.waitForTimeout(400);
  ok("Looking for: saving with a category", posts.some(x => /^saved_wants POST .*"label":"game boy color".*"cats":\["Consoles & Retro"\]/.test(x)));
  await p.click("#t-post"); await p.waitForTimeout(100);
  await p.fill("#f-title", "Game Boy Color"); await p.click("#f-wantcats .chip:has-text('Trading Cards')"); await p.click("#f-open");
  await p.click("#postBtn"); await p.waitForTimeout(500);
  const post = posts.find(x => /^items POST/.test(x));
  ok("posting saves the categories they'd take and the open flag", post && /"want_cats":\["Trading Cards"\]/.test(post) && /"open_to_offers":false/.test(post), post && post.slice(0, 160));
  await p.click("#profBtn"); await p.waitForTimeout(200);
  ok("the header's profile button opens the profile page", await p.isVisible("#profile") && await p.isVisible("#profForm"));
  ok("email switch shows, reflecting the saved choice", await p.isVisible("#p-notify") && !(await p.isChecked("#p-notify")) && await p.isDisabled("#p-kinds input[data-pref=offers]"));
  await p.check("#p-notify"); await p.waitForTimeout(300);
  await p.uncheck("#p-kinds input[data-pref=messages]"); await p.waitForTimeout(400);
  const prof = posts.filter(x => /^profiles POST/.test(x)).pop();
  ok("…ticking saves straight away, kind by kind", prof && /"email_notify":true/.test(prof) && /"messages":false/.test(prof) && /"offers":true/.test(prof), prof && prof.slice(0, 200));
  await b.close(); }
{ const { b, p } = await run(true, true);
  ok("no matches yet: the strip says what to do instead of disappearing", await p.isVisible("#matchBox .mempty") && /No matches yet/.test(await p.textContent("#matchBox .mempty")));
  await b.close(); }
{ const { b, p } = await run(false);
  ok("without notifications.sql: no email settings", await p.$eval("#p-notifywrap", e => e.hidden));
  await p.click("#t-post");
  ok("without matching.sql: no category picker, no strip, no saved searches", (await p.$eval("#f-wantwrap", e => e.hidden)) && (await p.$eval("#matchBox", e => e.hidden)) && (await p.$eval("#lookWrap", e => e.hidden)));
  await b.close(); }
console.log(res.join("\n"));
