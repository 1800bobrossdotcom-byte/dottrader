import { createRequire } from "module"; const require = createRequire(import.meta.url);
import { chromium, VENDOR, OUT, ROOT, CSP, legacyBoard } from "./harness.mjs";
const A = "11111111-1111-4111-8111-111111111111"; const now = new Date().toISOString();
const svg = c => '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="' + c + '"/><text x="400" y="330" font-size="90" text-anchor="middle" font-family="sans-serif" fill="#121212">' + c + '</text></svg>';
const items = [{ id: "i1", owner_id: A, title: "Desultor 2023 Fake Scientist Card sealed", want: "Open to offers", cat: "Trading Cards", status: "open", created_at: now, photos: ["https://img.test/front", "https://img.test/back", "https://img.test/side"] },
               { id: "i2", owner_id: A, title: "Single photo lamp", want: "", cat: "Home & Kitchen", status: "open", created_at: now, photos: ["https://img.test/lamp"] }];
const colors = { front: "#27B2E8", back: "#1DB36A", side: "#F2518F", lamp: "#FFD23F" };
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));
const b = await chromium.launch({}).catch(() => chromium.launch());
for (const [w, h, mobile] of [[1100, 900, false], [390, 900, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage(); p.on("pageerror", e => res.push("PAGEERROR " + e.message));
  await p.route(/127\.0\.0\.1:8765\/app\.html/, async r => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
  p.on("console", m => { if (/Content Security Policy/i.test(m.text())) res.push("CSPVIOLATION " + m.text().slice(0, 200)); });
  const hdr = { "access-control-allow-origin": "*" };
  await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, r => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, r => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/fonts\./, r => r.fulfill({ status: 404, body: "" }));
  await p.route(/img\.test\/(\w+)/, r => r.fulfill({ status: 200, contentType: "image/svg+xml", body: svg(colors[r.request().url().split("/").pop()]) }));
  await p.route(/functions\/v1|api\/nft/, r => r.fulfill({ status: 404, body: "" }));
  await p.route(/supabase\.co\/rest\/v1\/(\w+)/, r => { const t = r.request().url().match(/rest\/v1\/(\w+)/)[1]; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, profiles: [{ id: A, name: "gianniaronestudio" }] }[t] || []) }); });
  await p.route(/supabase\.co\/(auth|realtime)/, r => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await legacyBoard(p); await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(1500);
  const g = "#feed .item:has-text('Desultor') .gallery";
  const visible = () => p.$eval(g + " .track", t => { const r = t.getBoundingClientRect(); return [...t.querySelectorAll("img")].filter(i => { const b = i.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1; }).map(i => i.alt.split(" — ")[1]); });
  ok((mobile ? "phone" : "desktop") + ": shows only the first photo", JSON.stringify(await visible()) === '["photo 1 of 3"]');
  if (!mobile) {
    await p.click(g + " .next"); await p.waitForTimeout(700);
    ok("desktop: arrow moves to photo 2, dots follow", JSON.stringify(await visible()) === '["photo 2 of 3"]' && (await p.$$eval(g + " .gdots s", d => d.findIndex(x => x.className === "on"))) === 1);
    ok("desktop: back arrow appears", !(await p.$eval(g + " .prev", e => e.hidden)));
    await p.screenshot({ path: OUT + "/gallery-desktop.png", clip: { x: 0, y: 330, width: 1100, height: 560 } });
  } else {
    await p.$eval(g + " .track", t => t.scrollTo({ left: t.clientWidth * 2 }));  // what a swipe does
    await p.waitForTimeout(500);
    ok("phone: swiping lands on whole photos and the dots follow", JSON.stringify(await visible()) === '["photo 3 of 3"]' && (await p.$$eval(g + " .gdots s", d => d.findIndex(x => x.className === "on"))) === 2);
    ok("phone: no arrow buttons, swipe only", !(await p.$eval(g + " .next", e => e.offsetParent)));
    await p.screenshot({ path: OUT + "/gallery-phone.png", fullPage: false });
  }
  ok((mobile ? "phone" : "desktop") + ": single photo has no arrows or dots", !(await p.$("#feed .item:has-text('Single photo') .gnav")) && !(await p.$("#feed .item:has-text('Single photo') .gdots")));
  await ctx.close();
}
await b.close(); console.log(res.join("\n"));
