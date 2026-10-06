import { createRequire } from "module"; const require = createRequire(import.meta.url);
import { chromium, VENDOR, OUT, ROOT, CSP } from "./harness.mjs";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 86400;
const jwtFor = id => b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: id, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const userFor = id => ({ id, email: id === A ? "alice@x.com" : "bob@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, identities: [{ id }], created_at: new Date().toISOString() });
const sessFor = id => ({ access_token: jwtFor(id), token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: userFor(id) });
const now = new Date().toISOString();
const results = [];
const check = (name, ok, extra) => { results.push((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };

async function page(browser, { as, caps = {}, hash = "", data = {}, onPost }) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  await p.route(/127\.0\.0\.1:8765\/app\.html/, async r => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
  p.on("console", m => { if (/Content Security Policy/i.test(m.text())) res.push("CSPVIOLATION " + m.text().slice(0, 200)); });
  p.on("pageerror", e => results.push("PAGEERROR " + e.message));
  await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, r => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } }));
  await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, r => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } }));
  await p.route(/fonts\./, r => r.abort());
  await p.route(/functions\/v1\/(verify-item|swift-processor)/, r => r.fulfill({ status: caps.verify === false ? 404 : 401, contentType: "application/json", body: "{}", headers: { "access-control-allow-origin": "*" } }));
  await p.route(/supabase\.co\/rest\/v1\/(\w+)/, route => {
    const req = route.request(), url = req.url(), t = url.match(/rest\/v1\/(\w+)/)[1];
    if (req.method() !== "GET") { onPost && onPost(t, req.method(), req.postData()); 
      if (t === "messages") { const b = JSON.parse(req.postData()); (data.messages = data.messages || []).push({ ...b, id: "m" + Date.now(), created_at: new Date().toISOString() }); }
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
    if (t === "items" && /select=photos/.test(url) && caps.photos === false) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "42703", message: "column items.photos does not exist" }) });
    if (t === "messages" && caps.messages === false) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST205", message: "Could not find the table" }) });
    const anon = !(req.headers()["authorization"] || "").includes(jwtFor(A).slice(0, 40)) && !(req.headers()["authorization"] || "").includes(jwtFor(B).split(".")[1].slice(0, 20));
    const rows = { items: data.items || [], offers: anon ? [] : (data.offers || []), profiles: data.profiles || [], offer_signals: data.offers || [], verification_badges: [], messages: data.messages || [] }[t] || [];
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
  await p.route(/supabase\.co\/auth\/v1\/(\w+)/, route => {
    const req = route.request(), url = req.url(), ep = url.match(/auth\/v1\/(\w+)/)[1];
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    if (ep === "token" && /grant_type=password/.test(url)) {
      if (body.password !== "correct-horse") return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessFor(B)) });
    }
    if (ep === "otp") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    if (ep === "verify") { if (body.token !== "123456") return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessFor(B)) }); }
    if (ep === "user") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(userFor(as || B)) });
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await p.route(/supabase\.co\/realtime/, r => r.abort());
  await p.goto("http://127.0.0.1:8765/app.html" + hash, { waitUntil: "domcontentloaded" });
  if (as) {
    await p.evaluate(([s]) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), [sessFor(as)]);
    await p.reload({ waitUntil: "domcontentloaded" });
  }
  await p.waitForTimeout(1300);
  return { p, ctx };
}
const vis = (p, sel) => p.$eval(sel, e => !e.hidden && e.offsetParent !== null).catch(() => false);

const browser = await chromium.launch({}).catch(() => chromium.launch());
const items = [{ id: "i1", owner_id: A, title: "Alice lamp", want: "vinyl", cat: "Home & Kitchen", status: "open", created_at: now },
               { id: "i2", owner_id: A, title: "Alice bike", want: "", cat: "Bikes", status: "pledged", created_at: now },
               { id: "i3", owner_id: B, title: "Bob camera", want: "", cat: "Cameras", status: "open", created_at: now }];
const profiles = [{ id: A, name: "Alice" }, { id: B, name: "Bob" }];

// 1. visitor
{ const { p, ctx } = await page(browser, { data: { items, profiles } });
  check("visitor sees the welcome", await vis(p, "#gate"));
  check("visitor sees the board", await vis(p, "#browse"), (await p.$$eval("#feed .item", x => x.length)) + " cards");
  check("visitor has a Sign in button, and the tabs (posting asks for an account)", await vis(p, "#signInTop") && await vis(p, "#tabs"));
  await p.click("#feed .item:has-text('Alice lamp') button:has-text('Offer a trade')"); await p.waitForTimeout(150);
  check("Offer as visitor opens Create account with a reason", (await p.$eval(".sheet h3", h => h.textContent)) === "Create an account", await p.$eval(".sheet .hint", h => h.textContent.slice(0, 50)));
  await p.click("[data-mode=signin]"); await p.fill("#a-email", "bob@x.com"); await p.fill("#a-pass", "wrong-pass1"); await p.click(".sheet button[type=submit]"); await p.waitForTimeout(400);
  check("wrong password explains the no-password case", /only ever signed in with email links/.test(await p.$eval("#a-msg", m => m.textContent)));
  await p.fill("#a-pass", "correct-horse"); await p.click(".sheet button[type=submit]"); await p.waitForTimeout(1500);
  check("right password signs in", await vis(p, "#tabs"));
  check("…and continues to the offer they wanted", (await p.$eval(".sheet h3", h => h.textContent).catch(() => "")) === "Offer a trade");
  await ctx.close(); }

// 2. emailed code, then the set-a-password prompt
{ const { p, ctx } = await page(browser, { data: { items, profiles } });
  await p.click("#signInTop"); await p.click("[data-mode=signin]"); await p.click("[data-mode=code]");
  await p.fill("#a-email", "bob@x.com"); await p.click(".sheet button[type=submit]"); await p.waitForTimeout(300);
  check("code is sent and asked for", (await p.$eval(".sheet h3", h => h.textContent)) === "Enter your code");
  await p.fill("#a-code", "999999"); await p.click(".sheet button[type=submit]"); await p.waitForTimeout(300);
  check("wrong code is explained", /wrong or has expired/.test(await p.$eval("#a-msg", m => m.textContent)));
  await p.fill("#a-code", "123456"); await p.click(".sheet button[type=submit]"); await p.waitForTimeout(1500);
  check("right code signs in and offers a password", await vis(p, "#tabs") && /Make next time one step/.test(await p.$eval(".sheet h3", h => h.textContent).catch(() => "")));
  await ctx.close(); }

// 3. expired email link
{ const { p, ctx } = await page(browser, { hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid", data: { items, profiles } });
  check("expired link explains itself and offers a code", /expired or was already used/.test(await p.$eval(".sheet .hint", h => h.textContent).catch(() => "")));
  await ctx.close(); }

// 4. messages on an agreed trade; draft survives re-render; withdrawn and Offer sent tags
{ const offers = [{ id: "o1", item_id: "i2", owner_id: A, from_id: B, give: "Bob vinyl", msg: "", status: "agreed", confirm_owner: false, confirm_from: false, created_at: now },
                  { id: "o2", item_id: "i1", owner_id: A, from_id: B, give: "Bob tent", msg: "", status: "withdrawn", confirm_owner: false, confirm_from: false, created_at: now },
                  { id: "o3", item_id: "i1", owner_id: A, from_id: B, give: "Bob lens", msg: "", status: "pending", confirm_owner: false, confirm_from: false, created_at: now }];
  const posted = [];
  const { p, ctx } = await page(browser, { as: B, data: { items, profiles, offers, messages: [{ id: "m0", offer_id: "o1", from_id: A, body: "Saturday at noon?", created_at: now }] }, onPost: (t, m, b) => posted.push(t + " " + b) });
  await p.click("#t-mine"); await p.waitForTimeout(200);
  check("agreed trade opens its thread", await vis(p, "#m-o1"), (await p.$$eval(".bub", b => b.map(x => x.childNodes[0].textContent))).join(" | "));
  check("withdrawn offer says so", (await p.$$eval(".tag", t => t.map(x => x.textContent))).includes("you withdrew this"));
  await p.fill("#m-o1", "Saturday works"); await p.click("#t-browse"); await p.click("#t-mine"); await p.waitForTimeout(150);
  check("half-typed message survives a re-render", (await p.inputValue("#m-o1")) === "Saturday works");
  await p.click("#offersOut .msgform button"); await p.waitForTimeout(900);
  check("send writes the message", posted.some(x => /^messages .*Saturday works/.test(x)) && (await p.$$eval(".bub", b => b.length)) === 2);
  await p.click("#t-browse"); await p.waitForTimeout(150);
  check("item with my pending offer shows Offer sent, no second offer", (await p.$eval("#feed .item:has-text('Alice lamp')", e => e.textContent)).includes("Offer sent") && !(await p.$("#feed .item:has-text('Alice lamp') button:has-text('Offer a trade')")));
  await ctx.close(); }

// 5. a project without photos, messages or the checker: those features are not offered
{ const offers = [{ id: "o1", item_id: "i3", owner_id: B, from_id: A, give: "x", msg: "", status: "agreed", confirm_owner: false, confirm_from: false, created_at: now }];
  const { p, ctx } = await page(browser, { as: B, caps: { photos: false, messages: false, verify: false }, data: { items, profiles, offers } });
  await p.click("#t-post"); await p.waitForTimeout(100);
  check("no photo picker when storage isn't set up", !(await vis(p, "#f-photowrap")));
  await p.click("#t-mine"); await p.waitForTimeout(150);
  check("no Prove button when the checker isn't deployed", !(await p.$("button:has-text('Prove you have it')")));
  check("no message box when messages aren't set up", !(await p.$(".thread")));
  await ctx.close(); }

await browser.close();
console.log(results.join("\n"));
