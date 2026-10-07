// The board itself in Spanish, Japanese and Portuguese: every screen and sheet walked, and any
// sentence still showing in English (when it has a translation), or any {placeholder} left
// unfilled, is a failure. Also: the picker, the footer links, and the profile remembering it.
import fs from "node:fs";
import { createRequire } from "module"; const require = createRequire(import.meta.url);
import { chromium, VENDOR, OUT, ROOT, CSP, legacyBoard } from "./harness.mjs";
const { ethers } = require(VENDOR + "/ethers.js");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const w = ethers.Wallet.createRandom(), msg = "Dot Trading Post\nLinking this wallet to my account\n" + A + "\n2026-10-06T00:00:00.000Z";
const wallet = { wallet_address: w.address.toLowerCase(), wallet_msg: msg, wallet_sig: await w.signMessage(msg) };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: A, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const sess = { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id: A, email: "a@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const now = new Date().toISOString(), soon = new Date(Date.now() + 3 * 864e5).toISOString();
const PIC = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#2F56D6"/></svg>');
const SW = "aaaaaaaa-0000-4000-8000-000000000001", GB = "bbbbbbbb-0000-4000-8000-000000000002", PK = "bbbbbbbb-0000-4000-8000-000000000003";
const items = [
  { id: SW, owner_id: A, title: "Nintendo Switch OLED", want: "", want_cats: ["Trading Cards"], open_to_offers: true, cat: "Video Games", status: "open", photos: [PIC, PIC], created_at: now },
  { id: GB, owner_id: B, title: "Game Boy Color", want: "a Switch", want_cats: [], open_to_offers: true, cat: "Consoles & Retro", status: "pledged", photos: [PIC], created_at: now, local_only: true },
  { id: PK, owner_id: B, title: "Pikachu promo", want: "", want_cats: [], open_to_offers: true, cat: "Trading Cards", status: "open", photos: [], created_at: now }];
const offers = [
  { id: "cccccccc-0000-4000-8000-000000000001", item_id: SW, owner_id: A, from_id: B, give: "Pikachu promo", give_items: [PK], msg: "hi", status: "pending", created_at: now },
  { id: "cccccccc-0000-4000-8000-000000000002", item_id: GB, owner_id: B, from_id: A, give: "Nintendo Switch OLED", give_items: [], msg: "", status: "agreed", ship_by: soon, created_at: now }];
const profiles = [{ id: A, name: "Alice", area: "Rochester, NY", ...wallet }, { id: B, name: "Bob", area: "Rochester, NY" }];

// Every English sentence that has a translation in this language; seeing one on screen is a leak.
const strings = (() => { const ctx = {}; new Function("window", fs.readFileSync(ROOT + "/site/js/strings.js", "utf8"))(ctx); return ctx.DTP_I18N.strings; })();
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));
const b = await chromium.launch({});

async function open(lang, signedIn, posts) {
  const ctx = await b.newContext({ viewport: { width: 1100, height: 1300 }, locale: "en-US" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => res.push("PAGEERROR " + lang + " " + e.message));
  p.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) res.push("CSPVIOLATION " + m.text().slice(0, 200)); });
  const hdr = { "access-control-allow-origin": "*" };
  await p.route(/127\.0\.0\.1:8765\/app\.html/, async (r) => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
  await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, (r) => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, (r) => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/fonts\.|functions\/v1|api\/nft|publicnode|mainnet\.base|rpc\./, (r) => r.fulfill({ status: 404, body: "" }));
  await p.route(/supabase\.co\/rest\/v1\/(\w+)/, (r) => {
    const req = r.request(), t = req.url().match(/rest\/v1\/(\w+)/)[1];
    if (req.method() === "POST") { posts.push(t + " " + req.postData()); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, offers, offer_signals: offers, profiles, messages: [{ offer_id: offers[1].id, from_id: B, body: "See you Saturday", created_at: now }] }[t] || []) });
  });
  await p.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    const out = { my_matches: [{ my_item: SW, their_item: PK, they_want_mine: false, i_want_theirs: true, score: 40 }], wanted_counts: [{ item_id: SW, listings: 2, searches: 1 }], note_visit: [{ visits: 4321, members: 25 }] }[fn];
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out === undefined ? null : out) });
  });
  await p.route(/supabase\.co\/(auth|realtime)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sess.user) }));
  await legacyBoard(p);
  await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
  await p.evaluate(([s, si]) => { localStorage.clear(); if (si) localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)); }, [sess, signedIn]);
  await p.goto("about:blank"); await legacyBoard(p);
  await p.goto("http://127.0.0.1:8765/app.html?lang=" + lang, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(1800);
  return { ctx, p };
}
// The visible text on screen right now, as the phrases it is made of.
const seen = (p) => p.evaluate(() => {
  const out = [], walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) { const n = walk.currentNode, el = n.parentElement; if (!el || el.closest("script,style,[hidden]") || !el.getClientRects().length) continue; const s = n.nodeValue.replace(/\s+/g, " ").trim(); if (s) out.push(s); }
  document.querySelectorAll("input[placeholder],textarea[placeholder]").forEach((e) => { if (e.getClientRects().length) out.push(e.placeholder); });
  return out;
});
function leaks(lang, texts) {
  const S = strings[lang];
  return texts.filter((s) => (S[s] && S[s] !== s) || /\{\w+\}/.test(s));
}

for (const [lang, h, word] of [["ja", "ja", "ボード"], ["es", "es", "Tablón"], ["pt", "pt-BR", "Mural"]]) {
  const posts = [];
  const { ctx, p } = await open(lang, true, posts);
  const bad = [];
  const look = async (where) => { const l = leaks(lang, await seen(p)); if (l.length) bad.push(where + ": " + l.slice(0, 3).join(" | ")); };
  ok(lang + ": the header's language menu names it", (await p.textContent("#langTop summary")).includes({ ja: "日本語", es: "Español", pt: "Português" }[lang]) && (await p.getAttribute('#langTop a[data-lang="' + lang + '"]', "aria-current")) === "true");
  ok(lang + ": the board opens in " + h, (await p.evaluate(() => document.documentElement.lang)) === h && (await p.textContent("#t-browse")).includes(word), await p.textContent("#t-browse"));
  await look("board");
  await p.click("#t-post"); await p.waitForTimeout(150); await look("post a thing");
  await p.click("label:has(#f-isasset)"); await p.waitForTimeout(150); await look("post an NFT");
  await p.click("#t-mine"); await p.waitForTimeout(300); await look("my trades");
  await p.click("#t-activity"); await p.waitForTimeout(200); await look("activity");
  await p.click("#profBtn"); await p.waitForTimeout(200); await look("profile");
  ok(lang + ": the language picker shows " + lang, (await p.inputValue("#p-lang")) === lang);
  await p.click("#t-browse"); await p.waitForTimeout(150);
  await p.evaluate(() => openOffer(items.filter((x) => x.title === "Pikachu promo")[0])); await p.waitForTimeout(150);
  await p.check(".sheet #o-isasset"); await look("offer sheet"); await p.keyboard.press("Escape");
  await p.evaluate(() => openEdit(items.filter((x) => x.title === "Nintendo Switch OLED")[0])); await p.waitForTimeout(150); await look("edit sheet"); await p.keyboard.press("Escape");
  await p.evaluate(() => openSent(offers[1])); await p.waitForTimeout(150); await look("mark sent sheet"); await p.keyboard.press("Escape");
  ok(lang + ": the foot shows visits and members in " + h, (await p.textContent("#siteStats")) === { ja: "4,321 回の訪問25 人のメンバー", es: "4321 visitas25 miembros", pt: "4.321 visitas25 membros" }[lang], await p.textContent("#siteStats"));
  await p.screenshot({ path: OUT + "/app-" + lang + ".png", fullPage: true });
  ok(lang + ": no English or unfilled {placeholders} on any screen", !bad.length, bad.join(" || "));
  ok(lang + ": the profile is told the language, for emails", posts.some((x) => /^profiles /.test(x) && x.includes('"lang":"' + lang + '"')), posts.filter((x) => /^profiles/.test(x)).join(" ").slice(0, 200));
  await ctx.close();
}
{
  const posts = [];
  const { ctx, p } = await open("es", false, posts);
  const bad = leaks("es", await seen(p));
  await p.click("#signInTop"); await p.waitForTimeout(150);
  bad.push(...leaks("es", await seen(p)));
  ok("es, signed out: the welcome and the sign-in sheet are in Spanish", !bad.length && /Iniciar sesión|Crear una cuenta/.test(await p.textContent(".sheet h3")), bad.slice(0, 3).join(" | "));
  await p.keyboard.press("Escape");
  await p.click('#langLinks a[data-lang="ja"]'); await p.waitForTimeout(1500);
  ok("the footer switches the board to Japanese, and it sticks", (await p.evaluate(() => document.documentElement.lang)) === "ja" && (await p.evaluate(() => localStorage.getItem("dtp-lang"))) === "ja");
  await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(800);
  ok("…even without ?lang= next time", (await p.evaluate(() => document.documentElement.lang)) === "ja");
  await ctx.close();
}
await b.close();
console.log(res.join("\n"));
process.exit(res.some((r) => !r.startsWith("PASS")) ? 1 : 0);
