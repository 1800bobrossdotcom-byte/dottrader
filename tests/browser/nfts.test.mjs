// NFTs first-class: posting starts with "a physical thing or an NFT", an NFT files under NFTs and
// fills its own name from the chain, ERC-20 is gone from the forms, and offering an NFT says
// plainly that no bridge is needed.
import { createRequire } from "module"; const require = createRequire(import.meta.url);
import { chromium, VENDOR, OUT, CSP, legacyBoard } from "./harness.mjs";
const { ethers } = require(VENDOR + "/ethers.js");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const w = ethers.Wallet.createRandom(), msg = "Dot Trading Post\nLinking this wallet to my account\n" + A + "\n2026-10-06T00:00:00.000Z";
const wallet = { wallet_address: w.address.toLowerCase(), wallet_msg: msg, wallet_sig: await w.signMessage(msg) };
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: A, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const sess = { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id: A, email: "a@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const now = new Date().toISOString();
const PIC = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#7B4FD6"/></svg>');
const NFT = "bbbbbbbb-0000-4000-8000-000000000001", GB = "bbbbbbbb-0000-4000-8000-000000000002";
const items = [
  { id: NFT, owner_id: B, title: "Wiiide #8240", want: "", want_cats: [], open_to_offers: true, cat: "NFTs", status: "open", photos: [], created_at: now,
    asset_kind: "erc721", asset_chain: 1, asset_contract: "0x72a94e6c51cb06453b84c049ce1e1312f7c05e2c", asset_token_id: "8240" },
  { id: GB, owner_id: B, title: "Game Boy Color", want: "an NFT on Base", want_cats: [], open_to_offers: true, cat: "Consoles & Retro", status: "open", photos: [PIC], created_at: now }];
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));

const b = await chromium.launch({});
const ctx = await b.newContext({ viewport: { width: 1100, height: 1300 } });
const p = await ctx.newPage(); const posts = [];
p.on("pageerror", e => res.push("PAGEERROR " + e.message));
p.on("console", m => { if (/Content Security Policy/i.test(m.text())) res.push("CSPVIOLATION " + m.text().slice(0, 200)); });
const hdr = { "access-control-allow-origin": "*" };
await p.route(/127\.0\.0\.1:8765\/app\.html/, async r => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, r => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, r => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
await p.route(/fonts\.|functions\/v1/, r => r.fulfill({ status: 404, body: "" }));
await p.route(/api\/nft/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Based Punk #12", collection: "Based Punks", image: PIC, description: "" }) }));
// The contract exists only on Base, whichever chain is picked first.
await p.route(/publicnode|mainnet\.base|rpc\./, r => {
  const body = JSON.parse(r.request().postData() || "{}"), base = /mainnet\.base/.test(r.request().url());
  const one = (q) => ({ jsonrpc: "2.0", id: q.id, result: q.method === "eth_getCode" ? (base ? "0x6080604052" : "0x") : "0x" });
  r.fulfill({ status: 200, contentType: "application/json", headers: hdr, body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
});
await p.route(/supabase\.co\/rest\/v1\/(\w+)/, r => {
  const req = r.request(), t = req.url().match(/rest\/v1\/(\w+)/)[1];
  if (req.method() === "POST") { posts.push(t + " " + req.postData()); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, offers: [], offer_signals: [], profiles: [{ id: A, name: "Alice", ...wallet }, { id: B, name: "Bob" }] }[t] || []) });
});
await p.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ my_matches: [], wanted_counts: [] }[r.request().url().match(/rpc\/(\w+)/)[1]] ?? null) }));
await p.route(/supabase\.co\/(auth|realtime)/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sess.user) }));
await legacyBoard(p); await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
await p.evaluate(([s]) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), [sess]);
await p.goto("about:blank"); await legacyBoard(p); await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(1800);

// The board
ok("NFTs is a quick category on the board", await p.isVisible("#cats button[data-cat='NFTs']"));
await p.click("#cats button[data-cat='NFTs']"); await p.waitForTimeout(300);
const shown = await p.$$eval("#feed .item h3", x => x.map(e => e.textContent));
ok("…and shows only NFTs", shown.length === 1 && shown[0] === "Wiiide #8240", shown.join(", "));
await p.click("#cats button[data-cat='NFTs']");

// Posting
await p.click("#t-post"); await p.waitForTimeout(150);
ok("posting starts with a choice, a physical thing picked", await p.isChecked("#f-isthing") && await p.isVisible(".kindpick"));
ok("a thing has no NFT fields, and can't file under NFTs", await p.isHidden("#f-assetfields") && await p.$eval('#f-cat option[value="NFTs"]', o => o.hidden));
ok("ERC-20 tokens are gone from the form", !(await p.$('#f-kind option[value="erc20"]')));
await p.click("label:has(#f-isasset)"); await p.waitForTimeout(100);
ok("an NFT shows its fields up front, no pickup", await p.isVisible("#f-contract") && await p.isHidden("#f-localwrap"));
ok("…and files under NFTs, fixed", (await p.inputValue("#f-cat")) === "NFTs" && await p.isDisabled("#f-cat"));
ok("…and is asked to be named", (await p.textContent("#f-titlelbl")) === "Name it");
await p.fill("#f-contract", "0x1111111111111111111111111111111111111111"); await p.fill("#f-tokid", "12");
await p.waitForFunction(() => document.getElementById("f-title").value !== "", null, { timeout: 8000 }).catch(() => {});
ok("the chain is found and the name filled in", (await p.inputValue("#f-chain")) === "8453" && (await p.inputValue("#f-title")) === "Based Punk #12", (await p.inputValue("#f-chain")) + " / " + (await p.inputValue("#f-title")));
await p.screenshot({ path: OUT + "/nft-post.png" });
await p.click("#postBtn"); await p.waitForTimeout(500);
const post = posts.find(x => /^items /.test(x)) || "";
const rec = post ? JSON.parse(post.slice(6)) : {};
ok("posting sends an NFT under NFTs", rec.cat === "NFTs" && rec.asset_kind === "erc721" && rec.asset_chain === 8453 && rec.asset_token_id === "12" && rec.local_only !== true, post.slice(0, 220));
await p.click("#t-post"); await p.waitForTimeout(150);
ok("after posting, the form is back to a physical thing", await p.isChecked("#f-isthing") && await p.isHidden("#f-assetfields") && !(await p.isDisabled("#f-cat")) && (await p.inputValue("#f-cat")) === "Other");
await p.click("label:has(#f-isasset)"); await p.click("label:has(#f-isthing)");
ok("switching back to a thing frees the category", !(await p.isDisabled("#f-cat")) && (await p.inputValue("#f-cat")) === "Other");

// Offering an NFT
await p.evaluate(() => openOffer(items.filter(x => x.title === "Wiiide #8240")[0])); await p.waitForTimeout(200);
ok("ERC-20 tokens are gone from offers", !(await p.$('.sheet #o-kind option[value="erc20"]')));
await p.check(".sheet #o-isasset"); await p.waitForTimeout(100);
const note = await p.textContent(".sheet .bridgenote");
ok("offering an NFT says no bridge is needed, and where theirs is", /no bridge/i.test(note) && /Theirs is on Ethereum/.test(note), note);
await p.screenshot({ path: OUT + "/nft-offer.png" });
await b.close();
console.log(res.join("\n"));
process.exit(res.some(r => !r.startsWith("PASS")) ? 1 : 0);
