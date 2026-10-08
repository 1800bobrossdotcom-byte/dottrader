// Several wallets per account: a listing counts as held when any wallet its lister linked holds
// it, your own miss says which wallet it is in, a copied signature can't claim someone else's
// wallet, the wallet menu lists them all, and posting an NFT none of them holds is stopped.
import { createRequire } from "module"; const require = createRequire(import.meta.url);
import { chromium, VENDOR, OUT, CSP, legacyBoard } from "./harness.mjs";
const { ethers } = require(VENDOR + "/ethers.js");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const sign = async (w, id) => { const msg = "Dot Trading Post\nLinking this wallet to my account\n" + id + "\n2026-10-08T00:00:00.000Z"; return { address: w.address.toLowerCase(), msg, sig: await w.signMessage(msg) }; };
const A1 = await sign(ethers.Wallet.createRandom(), A), A2 = await sign(ethers.Wallet.createRandom(), A), B2 = await sign(ethers.Wallet.createRandom(), B);
const STRANGER = "0x432d71ba14d2602b566dd9e3e098e24859d166c9";
const linked = [{ owner_id: A, ...A1 }, { owner_id: A, ...A2 }, { owner_id: B, ...B2 },
  // Bob copies Alice's message and signature onto his own account to claim her wallet.
  { owner_id: B, address: A1.address, msg: A1.msg, sig: A1.sig }];
const profiles = [{ id: A, name: "Alice", wallet_address: A1.address, wallet_msg: A1.msg, wallet_sig: A1.sig }, { id: B, name: "Bob" }];
// Who holds each token (ERC-721 ownerOf), by token id.
const owner = { 1: A2.address, 2: STRANGER, 3: B2.address, 4: A1.address, 77: STRANGER, 78: A2.address };
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: A, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const sess = { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id: A, email: "a@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const now = new Date().toISOString(), C = "0x5555555555555555555555555555555555555555";
const nft = (n, who, title) => ({ id: "bbbbbbbb-0000-4000-8000-00000000000" + n, owner_id: who, title, want: "", want_cats: [], open_to_offers: true, cat: "NFTs", status: "open", photos: [], created_at: now,
  asset_kind: "erc721", asset_chain: 1, asset_contract: C, asset_token_id: String(n) });
const items = [nft(1, A, "In Alice's second wallet"), nft(2, A, "In someone else's wallet"), nft(3, B, "In Bob's second wallet"), nft(4, B, "In Alice's main wallet")];
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));

const b = await chromium.launch({});
const ctx = await b.newContext({ viewport: { width: 1100, height: 1400 } });
const p = await ctx.newPage(); const writes = [];
p.on("pageerror", e => res.push("PAGEERROR " + e.message));
p.on("console", m => { if (/Content Security Policy/i.test(m.text())) res.push("CSPVIOLATION " + m.text().slice(0, 200)); });
const hdr = { "access-control-allow-origin": "*" };
await p.route(/127\.0\.0\.1:8765\/app\.html/, async r => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, r => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, r => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
await p.route(/fonts\.|functions\/v1/, r => r.fulfill({ status: 404, body: "" }));
await p.route(/api\/nft/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Token", collection: "Tokens", image: null, description: "" }) }));
await p.route(/publicnode|mainnet\.base|rpc\./, r => {
  const body = JSON.parse(r.request().postData() || "{}");
  const one = (q) => {
    let result = "0x";
    if (q.method === "eth_getCode") result = /ethereum-rpc/.test(r.request().url()) ? "0x6080" : "0x";
    if (q.method === "eth_call" && q.params[0].data.startsWith("0x6352211e")) result = "0x" + (owner[Number(BigInt("0x" + q.params[0].data.slice(10)))] || "0x" + "0".repeat(40)).slice(2).padStart(64, "0");
    return { jsonrpc: "2.0", id: q.id, result };
  };
  r.fulfill({ status: 200, contentType: "application/json", headers: hdr, body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
});
await p.route(/supabase\.co\/rest\/v1\/(\w+)/, r => {
  const req = r.request(), t = req.url().match(/rest\/v1\/(\w+)/)[1];
  if (req.method() !== "GET" && req.method() !== "HEAD") { writes.push(t + " " + req.method() + " " + (req.postData() || decodeURIComponent(req.url().split("?")[1] || ""))); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, offers: [], offer_signals: [], profiles, linked_wallets: linked }[t] || []) });
});
await p.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ my_matches: [], wanted_counts: [] }[r.request().url().match(/rpc\/(\w+)/)[1]] ?? null) }));
await p.route(/supabase\.co\/(auth|realtime)/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sess.user) }));
await legacyBoard(p); await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
await p.evaluate(([s]) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), [sess]);
await p.goto("about:blank"); await legacyBoard(p); await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(2200);

const held = async (title) => p.$eval(`#feed .item:has(h3:text-is("${title}")) .held`, e => ({ text: e.textContent, title: e.title })).catch(() => ({ text: "(no card)" }));
let h = await held("In Alice's second wallet");
ok("your listing in your second wallet counts as held", /^held by/.test(h.text), h.text);
h = await held("In Bob's second wallet");
ok("…and so does someone else's in theirs", /^held by/.test(h.text), h.text);
h = await held("In someone else's wallet");
ok("your own miss says it isn't in your linked wallets", h.text === "not in your linked wallets", h.text);
await p.waitForTimeout(400); h = await held("In someone else's wallet");
ok("…and which wallet it is in, so you can link it", h.title.includes(STRANGER), h.title);
h = await held("In Alice's main wallet");
ok("a copied signature can't claim another trader's wallet", h.text === "no longer held", h.text);
ok("the wallet button shows the main wallet and how many more", (await p.textContent("#walletState")) === A1.address.slice(0, 6) + "…" + A1.address.slice(-4) + " +1", await p.textContent("#walletState"));

await p.click("#connectBtn"); await p.waitForTimeout(200);
const rows = await p.$$eval(".sheet .wrow", x => x.map(e => e.textContent));
ok("the wallet menu lists every linked wallet, the main one marked", rows.length === 2 && /main/.test(rows[0]) && /Make main/.test(rows[1]), rows.join(" | "));
ok("…with a way to link another", await p.isVisible(".sheet [data-add]"));
await p.screenshot({ path: OUT + "/wallets-menu.png" });
await p.click(".sheet [data-main]"); await p.waitForTimeout(300);
const mk = writes.find(w => /^profiles POST.*wallet_address/.test(w)) || "";
ok("making the second wallet main saves it, with its own signature", mk.includes(A2.address) && mk.includes(JSON.stringify(A2.sig)), mk.slice(0, 160));
writes.length = 0;
await p.click("#connectBtn"); await p.waitForTimeout(200);
await p.click(".sheet .wrow:first-child [data-unlink]"); await p.waitForTimeout(400);
const del = writes.find(w => /^linked_wallets DELETE/.test(w)) || "", promo = writes.find(w => /^profiles POST.*wallet_address/.test(w)) || "";
ok("unlinking the main wallet removes it", del.includes("address=eq." + A1.address) && del.includes("owner_id=eq." + A), del);
ok("…and the next wallet becomes main", promo.includes(A2.address), promo.slice(0, 120));
await p.keyboard.press("Escape");

// Posting an NFT none of your wallets holds
writes.length = 0;
await p.click("#t-post"); await p.waitForTimeout(150);
await p.click("label:has(#f-isasset)"); await p.waitForTimeout(100);
await p.fill("#f-contract", C); await p.fill("#f-tokid", "77");
await p.waitForFunction(() => document.getElementById("f-title").value !== "", null, { timeout: 8000 }).catch(() => {});
await p.click("#postBtn"); await p.waitForTimeout(700);
const tt = await p.textContent(".toast").catch(() => "");
ok("posting an NFT none of your wallets holds is stopped, saying where it is", !writes.some(w => /^items /.test(w)) && /None of your linked wallets/.test(tt) && tt.includes("0x432d"), tt);
await p.fill("#f-tokid", "78"); await p.waitForTimeout(300);
await p.click("#postBtn"); await p.waitForTimeout(700);
ok("one in your second wallet posts", writes.some(w => /^items POST/.test(w) && w.includes('"asset_token_id":"78"')), writes.join(" | ").slice(0, 200));
await b.close();
console.log(res.join("\n"));
process.exit(res.some(r => !r.startsWith("PASS")) ? 1 : 0);
