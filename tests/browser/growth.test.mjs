// Getting people onto the board: listings show on a visitor's first screen, the Wanted strip and
// "I have one", starting a listing from a photo, the invite link, and crediting a sign-up to the
// link that brought it.
import { chromium, VENDOR, OUT, CSP, legacyBoard } from "./harness.mjs";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: A, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const sess = { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id: A, email: "a@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const now = new Date().toISOString();
const PIC = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#2F56D6"/></svg>');
const items = [{ id: "bbbbbbbb-0000-4000-8000-000000000001", owner_id: B, title: "Sega Saturn", want: "N64 games", want_cats: [], open_to_offers: true, cat: "Consoles & Retro", status: "open", photos: [PIC], created_at: now }];
const wants = [{ id: "w1", user_id: B, label: "Pokémon base set holo", cats: ["Trading Cards"], public: true, created_at: now }];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (c || !x ? "" : "  [" + x + "]"));
const hdr = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

async function open(browser, { signedIn, query = "", profile = {} }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p = await ctx.newPage(), writes = [], visits = [], describes = [];
  p.on("pageerror", (e) => res.push("PAGEERROR " + e.message));
  await p.route(/127\.0\.0\.1:8765\/app\.html/, async (r) => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
  await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, (r) => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, (r) => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/fonts\./, (r) => r.fulfill({ status: 404, body: "" }));
  await p.route(/functions\/v1\/(bond|notify|clever-function)/, (r) => r.fulfill({ status: 404, body: "", headers: hdr }));
  await p.route(/functions\/v1\/swift-processor/, async (r) => {
    const q = r.request();
    if (q.method() === "OPTIONS") return r.fulfill({ status: 200, body: "ok", headers: hdr });
    if (q.method() === "GET") return r.fulfill({ status: 405, body: "{}", headers: hdr });
    describes.push(JSON.parse(q.postData()));
    r.fulfill({ status: 200, contentType: "application/json", headers: hdr, body: JSON.stringify({ title: "Game Boy Color, Atomic Purple", category: "Consoles & Retro", details: "Shell scuffed on the back.", sure: true }) });
  });
  await p.route(/supabase\.co\/storage\/v1\/object\/photos\//, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: hdr, body: JSON.stringify({ Key: "photos/x.png" }) }));
  await p.route(/supabase\.co\/rest\/v1\/(\w+)/, (r) => {
    const q = r.request(), t = q.url().match(/rest\/v1\/(\w+)/)[1];
    if (q.method() !== "GET" && q.method() !== "HEAD") { writes.push(t + " " + q.method() + " " + (q.postData() || "")); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
    const url = decodeURIComponent(q.url());
    const data = { items, offers: [], offer_signals: [], profiles: [{ id: A, name: "Alice", ...profile }, { id: B, name: "Bob" }], saved_wants: /public=eq\.true/.test(url) ? wants : [] }[t] || [];
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await p.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    if (fn === "note_visit") { visits.push(JSON.parse(r.request().postData() || "{}")); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ visits: 9, members: 4 }]) }); }
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ my_matches: [], wanted_counts: [] }[fn] ?? null) });
  });
  await p.route(/supabase\.co\/(auth|realtime)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sess.user) }));
  await legacyBoard(p);
  await p.goto("http://127.0.0.1:8765/app.html" + query, { waitUntil: "domcontentloaded" });
  if (signedIn) {
    await p.evaluate((s) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), sess);
    await p.goto("about:blank"); await legacyBoard(p);
    await p.goto("http://127.0.0.1:8765/app.html" + query, { waitUntil: "domcontentloaded" });
  }
  await p.waitForTimeout(2000);
  return { ctx, p, writes, visits, describes };
}

const browser = await chromium.launch({});

// A visitor, arriving from a sticker
{
  const { ctx, p, visits } = await open(browser, { signedIn: false, query: "?ref=sticker" });
  const first = await p.$eval("#feed .item", (e) => e.getBoundingClientRect().top).catch(() => 9999);
  ok("a visitor on a phone sees a listing within the first two screens", first < 844 * 2, String(Math.round(first)));
  ok("…with the how-it-works steps folded away", await p.isHidden(".gate .steps"));
  ok("the visit is counted with where it came from", visits.some((v) => v.p_ref === "sticker"), JSON.stringify(visits));
  ok("…and the source is kept for a later sign-up", (await p.evaluate(() => localStorage.getItem("dtp-ref"))) === "sticker");
  const wanted = await p.$$eval("#wantedBox .wcard", (x) => x.map((e) => e.textContent));
  ok("the Wanted strip shows what people are looking for", wanted.length === 1 && /Pokémon base set holo/.test(wanted[0]) && /Bob/.test(wanted[0]), wanted.join(" | "));
  await p.screenshot({ path: OUT + "/growth-visitor.png", fullPage: false });
  await ctx.close();
}

// The same browser after signing up: the source goes on the profile; then "I have one" and a photo
{
  const { ctx, p, writes, describes } = await open(browser, { signedIn: true, query: "?ref=sticker" });
  const refWrite = writes.find((w) => /^profiles POST/.test(w) && /"ref"/.test(w)) || "";
  ok("a new member is credited to the link that brought them", /"ref":"sticker"/.test(refWrite), writes.filter((w) => /^profiles/.test(w)).join(" | "));
  await p.click("#wantedBox .wcard button"); await p.waitForTimeout(300);
  ok("“I have one” opens the post form aimed at that want", await p.isVisible("#postForm") && (await p.inputValue("#f-cat")) === "Trading Cards" && (await p.inputValue("#f-title")) === "Pokémon base set holo", await p.inputValue("#f-title"));
  ok("…and says the person looking will hear about it", /Bob hears about it/.test(await p.$eval(".toast", (t) => t.textContent).catch(() => "")));
  // start a fresh listing from a photo
  await p.fill("#f-title", ""); await p.selectOption("#f-cat", "Other");
  await p.setInputFiles("#f-photos", { name: "gbc.png", mimeType: "image/png", buffer: PNG });
  await p.waitForFunction(() => document.getElementById("f-title").value !== "", null, { timeout: 8000 }).catch(() => {});
  const d = describes[0] || {};
  ok("the first photo is read, in the trader's language, with the board's categories", d.action === "describe" && /\/photos\/11111111/.test(d.photo_url || "") && d.lang === "en" && (d.cats || []).includes("Consoles & Retro") && !(d.cats || []).includes("NFTs"), JSON.stringify(d).slice(0, 160));
  ok("…and fills in the title, category and details", (await p.inputValue("#f-title")) === "Game Boy Color, Atomic Purple" && (await p.inputValue("#f-cat")) === "Consoles & Retro" && (await p.inputValue("#f-desc")) === "Shell scuffed on the back.");
  ok("…saying where they came from, so they get checked", /check it before you post/.test(await p.textContent("#f-photonote")));
  await p.screenshot({ path: OUT + "/growth-photo.png" });
  // a second photo doesn't overwrite what's there
  await p.fill("#f-title", "My own title");
  await p.setInputFiles("#f-photos", { name: "b.png", mimeType: "image/png", buffer: PNG }); await p.waitForTimeout(1200);
  ok("a later photo never overwrites what the trader typed", describes.length === 1 && (await p.inputValue("#f-title")) === "My own title");
  // saving a want for the board
  await p.click("#t-mine"); await p.waitForTimeout(300);
  ok("the Looking-for form offers to show a want on the board, ticked", await p.isVisible("#look-pubwrap") && await p.isChecked("#look-public"));
  await p.fill("#look-q", "Zelda cartridge"); await p.click("#lookForm button[type=submit]"); await p.waitForTimeout(400);
  const saved = writes.find((w) => /^saved_wants POST/.test(w)) || "";
  ok("…and saves it as public", /"label":"Zelda cartridge"/.test(saved) && /"public":true/.test(saved), saved);
  // invite link
  await p.click("#profBtn"); await p.waitForTimeout(300);
  ok("Profile has an invite link carrying the trader's source code", /\?ref=t-11111111$/.test(await p.inputValue("#p-invite")), await p.inputValue("#p-invite"));
  await ctx.close();
}

// A member who already has a source keeps it
{
  const { ctx, writes } = await open(browser, { signedIn: true, query: "?ref=other", profile: { ref: "sticker" } });
  ok("a member's source is never overwritten by a later link", !writes.some((w) => /^profiles POST/.test(w) && /"ref"/.test(w)));
  await ctx.close();
}

await browser.close();
console.log(res.join("\n"));
process.exit(res.some((r) => !r.startsWith("PASS")) ? 1 : 0);
