// "Make a text graphic": a listing for something a photo can't show (here, building a website)
// gets a picture drawn from the trader's words, uploaded like a photo. And web addresses in a
// listing's details become links, without ever linking an email or a script.
import fs from "node:fs";
import { chromium, VENDOR, OUT, CSP, legacyBoard } from "./harness.mjs";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: A, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const sess = { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id: A, email: "a@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const now = new Date().toISOString();
const items = [{ id: "bbbbbbbb-0000-4000-8000-000000000001", owner_id: B, title: "Logo design", descr: "See my work at gianniarone.com, or https://dottrader.app/app. Email me@example.com. javascript:alert(1) <b>hi</b>", want: "Open to offers", want_cats: [], open_to_offers: true, cat: "Services & Skills", status: "open", photos: [], created_at: now }];
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (c || !x ? "" : "  [" + x + "]"));
const hdr = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

async function open(browser, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage(), uploads = [];
  p.on("pageerror", (e) => res.push("PAGEERROR " + e.message));
  p.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) res.push("CSPVIOLATION " + m.text().slice(0, 200)); });
  await p.route(/127\.0\.0\.1:8765\/app\.html/, async (r) => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
  await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, (r) => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, (r) => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/functions\/v1/, (r) => r.fulfill({ status: 404, body: "", headers: hdr }));
  await p.route(/supabase\.co\/storage\/v1\/object\/photos\//, (r) => { uploads.push({ type: r.request().headers()["content-type"], size: (r.request().postDataBuffer() || []).length }); r.fulfill({ status: 200, contentType: "application/json", headers: hdr, body: JSON.stringify({ Key: "photos/x.png" }) }); });
  await p.route(/supabase\.co\/rest\/v1\/(\w+)/, (r) => {
    const q = r.request(), t = q.url().match(/rest\/v1\/(\w+)/)[1];
    if (q.method() !== "GET" && q.method() !== "HEAD") return r.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, offers: [], offer_signals: [], profiles: [{ id: A, name: "Gianni" }, { id: B, name: "Bob" }] }[t] || []) });
  });
  await p.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ my_matches: [], wanted_counts: [] }[r.request().url().match(/rpc\/(\w+)/)[1]] ?? null) }));
  await p.route(/supabase\.co\/(auth|realtime)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sess.user) }));
  await legacyBoard(p);
  await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), sess);
  await p.goto("about:blank"); await legacyBoard(p);
  await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1800);
  return { ctx, p, uploads };
}

const browser = await chromium.launch({});
for (const [viewport, mobile] of [[{ width: 1100, height: 1000 }, false], [{ width: 390, height: 844 }, true]]) {
  const who = mobile ? "phone: " : "desktop: ";
  const { ctx, p, uploads } = await open(browser, viewport, mobile);
  // links in details
  if (mobile) { await p.click("#feed .item .peek"); await p.waitForTimeout(300); }
  const links = await p.$$eval("#feed .item .desc a", (x) => x.map((a) => [a.textContent, a.getAttribute("href"), a.rel, a.target]));
  ok(who + "web addresses in the details are links that open in a new tab", links.length === 2 && links[0][0] === "gianniarone.com" && links[0][1] === "https://gianniarone.com" && links[1][1] === "https://dottrader.app/app" && links.every((l) => /nofollow/.test(l[2]) && /ugc/.test(l[2]) && l[3] === "_blank"), JSON.stringify(links));
  const text = await p.textContent("#feed .item .desc");
  ok(who + "…but an email, a script: address and markup stay plain text", /me@example\.com/.test(text) && /javascript:alert\(1\)/.test(text) && /<b>hi<\/b>/.test(text) && !(await p.$("#feed .item .desc b")));
  // the graphic
  await p.click("#t-post"); await p.waitForTimeout(200);
  await p.selectOption("#f-cat", "Other");
  await p.click("#f-makeart"); await p.waitForTimeout(200);
  ok(who + "Make a text graphic opens a sheet with a preview", await p.isVisible(".artsheet canvas"));
  await p.fill("#a-head", "I'll build your website");
  await p.fill("#a-foot", "gianniarone.com");
  await p.click(".swatches .sw[data-i='1']"); await p.waitForTimeout(300);
  const px = await p.$eval(".artsheet canvas", (c) => { const d = c.getContext("2d"); const at = (x, y) => Array.from(d.getImageData(x, y, 1, 1).data.slice(0, 3)); return { corner: at(20, 450), panel: at(600, 120), w: c.width, h: c.height, url: c.toDataURL("image/png") }; });
  ok(who + "the preview draws the chosen color around a paper panel", px.w === 1200 && px.h === 900 && JSON.stringify(px.corner) !== JSON.stringify(px.panel) && px.panel[0] > 240, JSON.stringify([px.corner, px.panel]));
  if (!mobile) fs.writeFileSync(OUT + "/textart-graphic.png", Buffer.from(px.url.split(",")[1], "base64"));
  await p.screenshot({ path: OUT + "/textart-" + (mobile ? "phone" : "desktop") + ".png" });
  await p.click(".artsheet button[type=submit]"); await p.waitForTimeout(800);
  ok(who + "Use this graphic uploads it as a picture", uploads.length === 1 && uploads[0].size > 5000, JSON.stringify(uploads));
  ok(who + "…which becomes the listing's first photo", (await p.$$("#f-thumbs .thumb")).length === 1 && await p.isHidden(".artsheet"));
  ok(who + "…and fills an empty title and the Services & Skills category", (await p.inputValue("#f-title")) === "I'll build your website" && (await p.inputValue("#f-cat")) === "Services & Skills", await p.inputValue("#f-cat"));
  await ctx.close();
}
await browser.close();
console.log(res.join("\n"));
process.exit(res.some((r) => !r.startsWith("PASS")) ? 1 : 0);
