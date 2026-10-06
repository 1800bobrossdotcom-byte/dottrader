// Sending an NFT side of a trade: only an NFT side can be "sent on chain", the sheet explains what
// is checked, and the card shows checking / delivered / couldn't-confirm as the chain answers.
import { chromium, VENDOR, legacyBoard } from "./harness.mjs";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const sess = (id) => { const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: id, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
  return { access_token: jwt, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id, email: "x@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }; };
const now = new Date().toISOString(), soon = new Date(Date.now() + 3 * 86400e3).toISOString();
const item = { id: "item1", owner_id: A, title: "Charizard holo", want: "an NFT", cat: "Trading Cards", status: "pledged", photos: [], created_at: now };
const base = { id: "o1", item_id: "item1", owner_id: A, from_id: B, give: "Base NFT #7", msg: "", status: "agreed", ship_by: soon, created_at: now,
  asset_kind: "erc721", asset_chain: 8453, asset_contract: "0x" + "11".repeat(20), asset_token_id: "7" };
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));
const b = await chromium.launch();
async function open(as, offer) {
  const p = await (await b.newContext({ viewport: { width: 1100, height: 1300 } })).newPage(); const rpcs = [];
  p.on("pageerror", e => res.push("PAGEERROR " + e.message));
  const hdr = { "access-control-allow-origin": "*" }, J = (r, d, s = 200) => r.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(d) });
  await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, r => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, r => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: hdr }));
  await p.route(/fonts\.|functions\/v1|api\/nft|publicnode|mainnet\.base/, r => r.fulfill({ status: 404, body: "" }));
  await p.route(/supabase\.co\/rest\/v1\/(\w+)/, r => { const t = r.request().url().match(/rest\/v1\/(\w+)/)[1];
    J(r, { items: [item], offers: [offer], offer_signals: [offer], profiles: [{ id: A, name: "Alice" }, { id: B, name: "Bob" }] }[t] || []); });
  await p.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, r => { const fn = r.request().url().match(/rpc\/(\w+)/)[1]; rpcs.push({ fn, body: JSON.parse(r.request().postData() || "{}") }); J(r, fn === "my_matches" || fn === "wanted_counts" ? [] : null); });
  await p.route(/supabase\.co\/(auth|realtime)/, r => J(r, sess(as).user));
  await legacyBoard(p); await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
  await p.evaluate(([s]) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), [sess(as)]);
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(1600);
  await p.click("#t-mine"); await p.waitForTimeout(300);
  return { p, rpcs };
}
{ const { p, rpcs } = await open(B, base);
  await p.click("button:has-text('Mark my side sent')"); await p.waitForTimeout(200);
  const radios = await p.$$eval(".sheet input[name=how]", x => x.map(e => e.value + (e.checked ? "*" : "")));
  ok("Bob's side is an NFT: the only way to send it is on chain", radios.join(",") === "onchain*", radios.join(","));
  ok("…and the sheet says what gets checked, and that no bridge is needed", /Alice’s linked wallet on Base/.test(await p.textContent(".sheet")) && /No bridge needed/.test(await p.textContent(".sheet")));
  await p.fill("#s-tx", "0x" + "ab".repeat(32)); await p.click(".sheet button[type=submit]"); await p.waitForTimeout(400);
  const ms = rpcs.find(x => x.fn === "mark_sent");
  ok("marking it sends the transaction to the database", ms && ms.body.p_how === "onchain" && ms.body.p_ref === "0x" + "ab".repeat(32));
}
{ const { p } = await open(A, base);
  await p.click("button:has-text('Mark my side sent')"); await p.waitForTimeout(200);
  const radios = await p.$$eval(".sheet input[name=how]", x => x.map(e => e.value));
  ok("Alice's side is a card: posted or handed over, never 'on chain'", radios.join(",") === "post,in_person", radios.join(","));
}
const sentB = { from_sent_at: now, from_sent_how: "onchain", from_ref: "0x" + "ab".repeat(32) };
{ const { p } = await open(A, { ...base, ...sentB, from_tx_status: "checking" });
  ok("while the chain is being read, the card says so", /sent on chain · checking the chain…/.test(await p.textContent("#offersIn .protect")));
}
{ const { p } = await open(A, { ...base, ...sentB, from_tx_status: "verified", from_tx_note: "NFT #7 reached Alice's wallet 0xa1a1…a1a1 on Base" });
  const t = await p.textContent("#offersIn .protect");
  ok("once confirmed: NFT delivered on chain, with the transaction on Base's explorer", /✓ NFT delivered on chain/.test(t) && (await p.getAttribute("#offersIn .protect .sideline .ok a", "href")) === "https://basescan.org/tx/0x" + "ab".repeat(32));
}
{ const { p } = await open(B, { ...base, from_tx_status: "rejected", from_tx_note: "that NFT went to 0xc3c3…c3c3, not Alice's linked wallet" });
  const t = await p.textContent("#offersOut .protect");
  ok("if it couldn't be confirmed, the sender sees why and can mark it again", /couldn’t confirm on chain — that NFT went to 0xc3c3…c3c3, not Alice's linked wallet/.test(t) && !!(await p.$("button:has-text('Mark my side sent')")), t.slice(0, 200));
}
await b.close();
console.log(res.join("\n"));
