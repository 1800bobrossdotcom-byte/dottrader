import { createRequire } from "module"; const require = createRequire(import.meta.url);
import { chromium, VENDOR, OUT, ROOT, CSP, legacyBoard } from "./harness.mjs";
const { ethers } = require(VENDOR + "/ethers.js");
globalThis.window = globalThis; globalThis.window.ethers = ethers; require(ROOT + "/site/swap.js");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
// Throwaway wallets made fresh each run, each with a signed link message, as the board makes them.
const W = {};
for (const id of [A, B]) {
  const w = ethers.Wallet.createRandom(), msg = "Dot Trading Post\nLinking this wallet to my account\n" + id + "\n2026-10-06T00:00:00.000Z";
  W[id] = { addr: w.address.toLowerCase(), key: w.privateKey, msg, sig: await w.signMessage(msg) };
}
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = id => b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: id, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s" }) + ".sig";
const sess = id => ({ access_token: jwt(id), token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "r", user: { id, email: "x@x.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));
const now = new Date().toISOString(), past = new Date(Date.now() - 3600e3).toISOString(), soon = new Date(Date.now() + 3 * 86400e3).toISOString();
const profiles = [{ id: A, name: "Alice", wallet_address: W[A].addr, wallet_msg: W[A].msg, wallet_sig: W[A].sig }, { id: B, name: "Bob", wallet_address: W[B].addr, wallet_msg: W[B].msg, wallet_sig: W[B].sig }];
const NFT_A = { asset_kind: "erc721", asset_chain: 1, asset_contract: "0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270", asset_token_id: "98000632" };
const NFT_B = { asset_kind: "erc1155", asset_chain: 1, asset_contract: "0x495f947276749ce646f68ac8c248420045cb7b5e", asset_token_id: "30385253887073932100288315104104098490583734846307282327082016686926955806721" };

// a fake injected wallet that really signs, with the key for whoever is "using" it
const FAKE = key => `
  (function () {
    var key = ${JSON.stringify(key)}; var sent = window.__sent = [];
    var p = { isMetaMask: true, on: function () {}, removeListener: function () {},
      request: async function (a) {
        var m = a.method, w = new window.ethers.Wallet(key);
        if (m === "eth_requestAccounts" || m === "eth_accounts") return [w.address];
        if (m === "eth_chainId") return "0x1";
        if (m === "net_version") return "1";
        if (m === "wallet_switchEthereumChain") return null;
        if (m === "eth_signTypedData_v4") { var d = JSON.parse(a.params[1]); delete d.types.EIP712Domain; return w._signTypedData(d.domain, d.types, d.message); }
        if (m === "eth_call") { var data = a.params[0].data;
          if (data.indexOf("0xe985e9c5") === 0) return "0x" + "0".repeat(63) + "1";            // isApprovedForAll -> true
          if (data.indexOf("0xf07ec373") === 0) return "0x" + "0".repeat(64);                 // getCounter -> 0
          return "0x"; }
        if (m === "eth_estimateGas") return "0x30000";
        if (m === "eth_gasPrice" || m === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
        if (m === "eth_blockNumber") return "0x10";
        if (m === "eth_getBlockByNumber") return { number: "0x10", baseFeePerGas: "0x3b9aca00", timestamp: "0x1", hash: "0x" + "1".repeat(64), parentHash: "0x" + "0".repeat(64), gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: [] };
        if (m === "eth_getTransactionCount") return "0x0";
        if (m === "eth_sendTransaction") { sent.push(a.params[0]); return "0x" + "ab".repeat(32); }
        if (m === "eth_getTransactionByHash") { var t = sent[sent.length - 1] || {}; return { hash: a.params[0], from: t.from, to: t.to, input: t.data, value: t.value || "0x0", nonce: "0x0", gas: "0x30000", gasPrice: "0x3b9aca00", chainId: "0x1", blockNumber: "0x10", blockHash: "0x" + "1".repeat(64), transactionIndex: "0x0", r: "0x1", s: "0x1", v: "0x25", type: "0x0" }; }
        if (m === "eth_getTransactionReceipt") return { transactionHash: a.params[0], status: "0x1", blockNumber: "0x10", blockHash: "0x" + "1".repeat(64), transactionIndex: "0x0", from: "0x" + "1".repeat(40), to: "0x0000000000000068f116a894984e2db1123eb395", gasUsed: "0x1", cumulativeGasUsed: "0x1", logs: [], logsBloom: "0x" + "0".repeat(512), contractAddress: null, effectiveGasPrice: "0x1", type: "0x0" };
        throw new Error("fake wallet: unsupported " + m);
      } };
    Object.defineProperty(window, "ethereum", { value: p, configurable: true });
  })();`;

async function open(browser, as, offers, { bondState = [], query = "" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1400 } });
  const p = await ctx.newPage(); const rpcs = [], bondCalls = [];
  await p.route(/127\.0\.0\.1:8765\/app\.html/, async r => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
  p.on("console", m => { if (/Content Security Policy/i.test(m.text())) res.push("CSPVIOLATION " + m.text().slice(0, 200)); });
  p.on("console", m => { if (m.type() === "error") res.push("CONSOLE " + m.text().slice(0, 300)); });
  p.on("pageerror", e => res.push("PAGEERROR " + e.message));
  p.on("dialog", d => d.accept());
  await p.addInitScript(FAKE(W[as].key));
  await p.route(/cdn\.jsdelivr\.net\/.*supabase\.js/, r => r.fulfill({ path: VENDOR + "/supabase.js", contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } }));
  await p.route(/cdnjs\.cloudflare\.com\/.*ethers/, r => r.fulfill({ path: VENDOR + "/ethers.js", contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } }));
  await p.route(/fonts\.|publicnode|\/api\/nft/, r => r.abort());
  await p.route(/checkout\.stripe\.com/, r => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>stripe checkout</h1>" }));
  await p.route(/functions\/v1\/(verify-item|swift-processor)/, r => r.fulfill({ status: 401, body: "{}", headers: { "access-control-allow-origin": "*" } }));
  await p.route(/functions\/v1\/bond/, async r => {
    const req = r.request();
    if (req.method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ bond_cents: 2500, fee_cents: 300, handling_cents: 250, hold_days: 7 }), headers: { "access-control-allow-origin": "*" } });
    if (req.method() === "OPTIONS") return r.fulfill({ status: 200, body: "ok", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type" } });
    const body = JSON.parse(req.postData()); bondCalls.push(body);
    const out = body.action === "start" ? { url: "https://checkout.stripe.com/c/pay/cs_test_9" } : body.action === "confirm" ? { status: "held" } : { settled: 1 };
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out), headers: { "access-control-allow-origin": "*" } });
  });
  await p.route(/supabase\.co\/rest\/v1\/(\w+)/, r => {
    const t = r.request().url().match(/rest\/v1\/(\w+)/)[1];
    const items = [{ id: "i1", owner_id: A, title: "Alice lamp", cat: "Home & Kitchen", status: "pledged", created_at: now }, { id: "i2", owner_id: A, title: "sail-o-bots #632", cat: "Art", status: "pledged", created_at: now, ...NFT_A }];
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, offers, profiles, offer_signals: offers, verification_badges: [], messages: [], bonds: bondState, payouts: [], swap_fees: [{ chain: 1, recipient: "0x8455cf296e1265b494605207e97884813de21950", wei: "500000000000000" }] }[t] || []) });
  });
  await p.route(/supabase\.co\/rest\/v1\/rpc\/(\w+)/, r => { const fn = r.request().url().match(/rpc\/(\w+)/)[1]; rpcs.push({ fn, body: JSON.parse(r.request().postData() || "{}") }); r.fulfill({ status: 200, contentType: "application/json", body: "null" }); });
  await p.route(/supabase\.co\/(auth|realtime)/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sess(as).user) }));
  await legacyBoard(p); await p.goto("http://127.0.0.1:8765/app.html", { waitUntil: "domcontentloaded" });
  await p.evaluate(([s]) => localStorage.setItem("sb-yujxwfghmauajrpduagl-auth-token", JSON.stringify(s)), [sess(as)]);
  await legacyBoard(p); await p.goto("http://127.0.0.1:8765/app.html" + query, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(1500);
  await p.click("#t-mine"); await p.waitForTimeout(300);
  return { p, ctx, rpcs, bondCalls };
}
const browser = await chromium.launch({}).catch(() => chromium.launch());
const base = { owner_id: A, from_id: B, msg: "", confirm_owner: false, confirm_from: false, created_at: now, status: "agreed" };

// 1. physical trade, Bob marks sent, sees bond offer
{ const offers = [{ ...base, id: "o1", item_id: "i1", give: "Bob vinyl", ship_by: soon }];
  const { p, ctx, rpcs, bondCalls } = await open(browser, B, offers);
  const panel = await p.$eval("#offersOut .protect", e => e.innerText).catch(() => "");
  ok("agreed trade shows ship-by date and both sides", /SEND BY/i.test(panel) && /not sent yet/.test(panel), panel.split("\n").slice(0, 3).join(" | "));
  ok("bond price comes from the bond function", /\$25 each/i.test(panel) && /\$3 fee/i.test(panel), panel.split(String.fromCharCode(10)).join(" | ").slice(0, 160));
  await p.click("#offersOut button:has-text('Mark my side sent')"); await p.waitForTimeout(150);
  await p.selectOption("#s-car", "UPS"); await p.fill("#s-ref", "1Z999AA10123456784"); await p.click(".sheet button[type=submit]"); await p.waitForTimeout(400);
  const ms = rpcs.find(x => x.fn === "mark_sent");
  ok("mark sent records carrier and tracking", ms && ms.body.p_how === "post" && ms.body.p_carrier === "UPS" && ms.body.p_ref === "1Z999AA10123456784");
  await p.click("#offersOut button:has-text('Hold $28 on my card')"); await p.waitForTimeout(1200);
  ok("Hold $28 (bond + fee) opens Stripe checkout", bondCalls.some(c => c.action === "start" && c.offer_id === "o1") && /checkout\.stripe\.com/.test(p.url()));
  await ctx.close(); }

// 2. deadline passed, Bob sent, Alice didn't: Bob can close as a no-show; settle follows
{ const offers = [{ ...base, id: "o1", item_id: "i1", give: "Bob vinyl", ship_by: past, from_sent_at: past, from_sent_how: "post", from_carrier: "USPS", from_ref: "9400111" }];
  const { p, ctx, rpcs, bondCalls } = await open(browser, B, offers, { bondState: [{ id: "b1", offer_id: "o1", user_id: A, amount_cents: 2500, fee_cents: 300, handling_cents: 250, status: "held" }] });
  const panel = await p.$eval("#offersOut .protect", e => e.innerText);
  ok("tracking shows as a carrier link", (await p.$eval("#offersOut .protect a", a => a.href)).includes("usps.com") && /SHIP-BY DATE PASSED/i.test(panel));
  ok("can't cancel after sending", !(await p.$("#offersOut button:has-text('Cancel trade')")));
  await p.click("#offersOut button:has-text('close as a no-show')"); await p.waitForTimeout(800);
  ok("no-show claim goes to the database", rpcs.some(x => x.fn === "claim_no_show" && x.body.p_offer === "o1"));
  ok("…and the bonds are settled straight after", bondCalls.some(c => c.action === "settle" && c.offer_id === "o1"));
  await ctx.close(); }

// 3. back from Stripe
{ const offers = [{ ...base, id: "o1", item_id: "i1", give: "Bob vinyl", ship_by: soon }];
  const { p, ctx, bondCalls } = await open(browser, B, offers, { query: "?bond=ok&session_id=cs_test_9" });
  await p.waitForTimeout(500);
  ok("returning from Stripe confirms the hold and cleans the URL", bondCalls.some(c => c.action === "confirm" && c.session_id === "cs_test_9") && !p.url().includes("session_id"));
  await ctx.close(); }

// 4. NFT swap: Alice sets it up
let posted;
{ const offers = [{ ...base, id: "o2", item_id: "i2", give: "LOVEBEING OG #1169", ship_by: soon, ...NFT_B }];
  const { p, ctx, rpcs } = await open(browser, A, offers);
  const panel = await p.$eval("#offersIn .protect", e => e.innerText);
  ok("NFT-for-NFT trade offers an on-chain swap instead of shipping", /SWAP ON CHAIN/i.test(panel) && !(await p.$("#offersIn button:has-text('Mark my side sent')")) && !(await p.$("#offersIn button:has-text('Hold $2')")));
  ok("…and says who pays the board fee before anyone signs", /Bob pays the gas and a 0\.0005 ETH board fee/.test(panel), panel.slice(0, 300));
  await p.click("#offersIn button:has-text('Set up the swap')"); await p.waitForTimeout(2500);
  posted = rpcs.find(x => x.fn === "post_swap");
  ok("lister signs and posts the order", !!posted, posted ? "order from " + posted.body.p_order.offerer.slice(0, 10) : JSON.stringify(rpcs.map(r => r.fn)));
  if (posted) {
    const c = posted.body.p_order;
    const signer = ethers.utils.verifyTypedData({ name: "Seaport", version: "1.6", chainId: 1, verifyingContract: "0x0000000000000068F116a894984e2DB1123eB395" }, globalThis.window.DTP_SWAP.TYPES, c, posted.body.p_sig);
    ok("signature recovers to Alice's linked wallet", signer.toLowerCase() === W[A].addr);
    ok("order: Alice's NFT for Bob's, paid to Alice", c.offer[0].token === NFT_A.asset_contract && c.offer[0].identifierOrCriteria === NFT_A.asset_token_id && c.consideration[0].identifierOrCriteria === NFT_B.asset_token_id && c.consideration[0].recipient === W[A].addr);
    const fee = c.consideration[1];
    ok("…plus the board's fee, 0.0005 ETH to the fee wallet", c.consideration.length === 2 && fee && Number(fee.itemType) === 0 && fee.startAmount === "500000000000000" && fee.endAmount === "500000000000000" && fee.recipient === "0x8455cf296e1265b494605207e97884813de21950", JSON.stringify(fee));
  }
  await ctx.close(); }

// 5. Bob completes it; then a tampered order is refused
if (posted) {
  const good = [{ ...base, id: "o2", item_id: "i2", give: "LOVEBEING OG #1169", ship_by: soon, ...NFT_B, swap_order: posted.body.p_order, swap_sig: posted.body.p_sig }];
  let { p, ctx, rpcs } = await open(browser, B, good);
  await p.click("#offersOut button:has-text('Complete the swap')");
  for (let i = 0; i < 6; i++) { await p.waitForTimeout(2000); res.push("toast@" + (i * 2 + 2) + "s: " + await p.$eval(".toast", t => t.textContent).catch(() => "-")); }
  const sent = await p.evaluate(() => window.__sent);
  const iface = new ethers.utils.Interface(globalThis.window.DTP_SWAP.ABI);
  let decoded = null; try { decoded = iface.parseTransaction({ data: sent[0].data, value: sent[0].value || "0x0" }); } catch (e) {}
  ok("filler sends fulfillOrder to Seaport", sent.length === 1 && sent[0].to.toLowerCase() === "0x0000000000000068f116a894984e2db1123eb395" && decoded && decoded.name === "fulfillOrder");
  ok("…with the order exactly as signed", decoded && decoded.args.order.parameters.offerer.toLowerCase() === W[A].addr && decoded.args.order.signature === posted.body.p_sig);
  ok("…paying the fee as the transaction's value", sent.length === 1 && BigInt(sent[0].value || "0x0") === 500000000000000n, sent[0] && String(sent[0].value));
  ok("the swap is recorded once mined", rpcs.some(x => x.fn === "record_swap" && /^0x(ab){32}$/.test(x.body.p_tx)));
  await ctx.close();
  const evil = JSON.parse(JSON.stringify(posted.body.p_order)); evil.consideration.push({ itemType: 2, token: "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d", identifierOrCriteria: "1", startAmount: "1", endAmount: "1", recipient: W[A].addr });
  ({ p, ctx, rpcs } = await open(browser, B, [{ ...good[0], swap_order: evil }]));
  await p.click("#offersOut button:has-text('Complete the swap')"); await p.waitForTimeout(1200);
  ok("a tampered order is refused before the wallet is touched", (await p.evaluate(() => window.__sent.length)) === 0 && /doesn.t match the trade/.test(await p.$eval(".toast", t => t.textContent).catch(() => "")));
  await ctx.close();
}
await browser.close();
console.log(res.join("\n"));
