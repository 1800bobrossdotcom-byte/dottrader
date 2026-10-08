// Checking on-chain deliveries (the notify Edge Function's verify_tx / verify_sweep), with the
// database, the chains' RPCs and Resend replaced by fakes. Run: npm run test:delivery
const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", RESEND_API_KEY: "re_test" };
let handler; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
const A = "a0000000-0000-0000-0000-000000000001", B = "b0000000-0000-0000-0000-000000000002";
const WA = "0x" + "a1".repeat(20), WB = "0x" + "b2".repeat(20), OTHER = "0x" + "c3".repeat(20);
const WA2 = "0x" + "d4".repeat(20);  // a second wallet Alice has linked
let aliceLinked = [{ address: WA }, { address: WA2 }];
const NFT = "0x" + "11".repeat(20), NFT2 = "0x" + "22".repeat(20);
const T721 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const T1155 = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const T1155B = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";
const pad = (x) => "0x" + BigInt(x).toString(16).padStart(64, "0");
const topicAddr = (a) => "0x" + a.slice(2).padStart(64, "0");
const hex = (...ws) => "0x" + ws.map((w) => BigInt(w).toString(16).padStart(64, "0")).join("");
const agreed = Date.now() - 2 * 86400e3, shipBy = new Date(agreed + 4 * 86400e3).toISOString();
const blockAfter = "0x" + Math.floor((agreed + 3600e3) / 1000).toString(16), blockBefore = "0x" + Math.floor((agreed - 86400e3) / 1000).toString(16);
const tx = (n) => "0x" + String(n).repeat(64).slice(0, 64);

// Chain state: tx hash → receipt (null = not mined) and block time.
const chain = {}, rpcCalls = [];
const mined = (hash, logs, { status = "0x1", ts = blockAfter } = {}) => { chain[hash] = { receipt: { status, blockNumber: "0x10", logs }, ts }; };
const transfer721 = (contract, to, id) => ({ address: contract, topics: [T721, topicAddr(WB), topicAddr(to), pad(id)], data: "0x" });
mined(tx(1), [transfer721(NFT, WA, 7)]);
mined(tx(2), [transfer721(NFT, WA, 8)]);
mined(tx(3), [transfer721(NFT, OTHER, 7)]);
mined(tx(4), [transfer721(NFT2, WA, 7)]);
mined(tx(5), [transfer721(NFT, WA, 7)], { status: "0x0" });
mined(tx(6), [transfer721(NFT, WA, 7)], { ts: blockBefore });
mined("0x" + "cd".repeat(32), [transfer721(NFT, WA2, 7)]);
chain[tx(7)] = null;  // not mined yet
chain[tx(8)] = null;  // never mined, sent long ago
mined(tx(9), [{ address: NFT, topics: [T1155, topicAddr(WB), topicAddr(WB), topicAddr(WA)], data: hex(7, 1) }]);
mined("0x" + "ab".repeat(32), [{ address: NFT, topics: [T1155B, topicAddr(WB), topicAddr(WB), topicAddr(WA)], data: hex(64, 160, 2, 5, 7, 2, 1, 1) }]);

const offers = {}, recorded = [], emails = [];
const offer = (id, ref, extra = {}) => { offers[id] = { id, item_id: "item1", owner_id: A, from_id: B, status: "agreed", ship_by: shipBy,
  asset_kind: "erc721", asset_chain: 8453, asset_contract: NFT, asset_token_id: "7",
  from_sent_how: "onchain", from_sent_at: new Date(Date.now() - 3600e3).toISOString(), from_ref: ref, from_tx_status: "checking", owner_sent_how: null, owner_tx_status: null, ...extra }; return id; };
const profiles = [{ id: A, name: "Alice", wallet_address: WA, email_notify: true }, { id: B, name: "Bob", wallet_address: WB, email_notify: true }];
const sent = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const R = (b, s = 200) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status: s });
  if (/publicnode|mainnet\.base|rpc\.zora/.test(url)) {
    const { method, params } = JSON.parse(init.body); rpcCalls.push(method);
    if (params[0] === "0x" + "ee".repeat(32)) return R({ jsonrpc: "2.0", id: 1, error: { message: "rate limited" } });
    if (method === "eth_getTransactionReceipt") return R({ jsonrpc: "2.0", id: 1, result: chain[params[0]] ? chain[params[0]].receipt : null });
    // Every fake receipt is in the same block number, so the block's time comes from the transaction being checked.
    if (method === "eth_getBlockByNumber") return R({ jsonrpc: "2.0", id: 1, result: { timestamp: chain[lastTx].ts } });
  }
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return R({ id: "em" }); }
  if (/\/auth\/v1\/admin\/users\//.test(url)) return R({ email: url.endsWith(A) ? "alice@x.com" : "bob@x.com" });
  const u = new URL(url), t = u.pathname.split("/").pop(), q = u.searchParams;
  if (t === "record_delivery") { const b = JSON.parse(init.body); recorded.push(b); return R(""); }
  if (t === "notifications_sent") { const row = JSON.parse(init.body); if (sent.includes(row.key)) return R([], 201); sent.push(row.key); return R([row], 201); }
  if (t === "offers") {
    if (q.get("or")) return R(Object.values(offers).filter((o) => o.owner_tx_status === "checking" || o.from_tx_status === "checking").map((o) => ({ id: o.id })));
    return R([offers[q.get("id").slice(3)]].filter(Boolean));
  }
  if (t === "items") return R([{ title: "Charizard", asset_kind: null }]);
  if (t === "linked_wallets") return R(q.get("owner_id") === "eq." + A ? aliceLinked : []);
  if (t === "profiles") {
    if (q.get("id") && q.get("id").startsWith("in.")) return R(profiles.filter((p) => q.get("id").includes(p.id)));
    return R(profiles.filter((p) => q.get("id") === "eq." + p.id));
  }
  throw new Error("unexpected " + url);
};
let lastTx = null;
await import(new URL("../supabase/functions/notify/index.ts", import.meta.url).href);
const verify = async (id) => { lastTx = offers[id].from_ref; const r = await handler(new Request("https://x/functions/v1/notify", { method: "POST", body: JSON.stringify({ kind: "verify_tx", id }) })); return r.json(); };
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (c || !x ? "" : "  [" + x + "]"));
const last = () => recorded[recorded.length - 1];
const id = (n) => "f0000000-0000-0000-0000-" + String(n).padStart(12, "0");

await verify(offer(id(1), tx(1)));
ok("the right NFT to the right wallet is confirmed", last().p_ok === true && last().p_side === "from" && /NFT #7 reached Alice's wallet 0xa1a1…a1a1 on Base/.test(last().p_note), last().p_note);
ok("…and Alice is told it arrived", emails.length === 1 && emails[0].to[0] === "alice@x.com" && /Bob's NFT arrived/.test(emails[0].subject));
await verify(offer(id(30), "0x" + "cd".repeat(32)));
ok("…and so is one sent to another wallet Alice has linked", last().p_ok === true && /reached Alice's wallet 0xd4d4…d4d4/.test(last().p_note), last().p_note);
await verify(offer(id(2), tx(2)));
ok("a different token from the same collection is rejected", last().p_ok === false && /different token/.test(last().p_note), last().p_note);
await verify(offer(id(3), tx(3)));
ok("the right token sent to someone else is rejected", last().p_ok === false && /went to 0xc3c3…c3c3, not Alice's linked wallet/.test(last().p_note), last().p_note);
await verify(offer(id(4), tx(4)));
ok("the same token id from a different contract is rejected", last().p_ok === false && /different token/.test(last().p_note), last().p_note);
await verify(offer(id(5), tx(5)));
ok("a failed transaction is rejected", last().p_ok === false && /failed on chain/.test(last().p_note), last().p_note);
await verify(offer(id(6), tx(6)));
ok("a transfer from before the trade was agreed is rejected", last().p_ok === false && /before this trade was agreed/.test(last().p_note), last().p_note);
let before = recorded.length;
await verify(offer(id(7), tx(7)));
ok("a transaction not mined yet is left to check again", recorded.length === before);
await verify(offer(id(8), tx(8), { from_sent_at: new Date(Date.now() - 2 * 86400e3).toISOString() }));
ok("…but after a day it's rejected as not on that chain", last().p_ok === false && /isn't on Base/.test(last().p_note), last().p_note);
await verify(offer(id(9), tx(9), { asset_kind: "erc1155" }));
ok("an ERC-1155 TransferSingle is confirmed", last().p_ok === true, last().p_note);
await verify(offer(id(10), "0x" + "ab".repeat(32), { asset_kind: "erc1155" }));
ok("an ERC-1155 TransferBatch containing it is confirmed", last().p_ok === true, last().p_note);
profiles[0].wallet_address = null; aliceLinked = [];
await verify(offer(id(11), tx(1)));
ok("with no wallet linked on the receiving side, it's rejected and says why", last().p_ok === false && /Alice has no wallet linked/.test(last().p_note), last().p_note);
profiles[0].wallet_address = WA;
before = recorded.length;
await verify(offer(id(12), "0x" + "ee".repeat(32)));
ok("if the chain's RPC errors, nothing is recorded and the sweep tries again", recorded.length === before);
await verify(offer(id(13), tx(1), { asset_kind: null, asset_contract: null }));
ok("a side that isn't an NFT can't be confirmed on chain", last().p_ok === false && /isn't an NFT/.test(last().p_note), last().p_note);
before = recorded.length; offers[id(7)].from_tx_status = "checking";
mined(tx(7), [transfer721(NFT, WA, 7)]); lastTx = tx(7);
const sw = await (await handler(new Request("https://x/", { method: "POST", body: JSON.stringify({ kind: "verify_sweep" }) }))).json();
ok("the sweep picks up what was waiting, once the chain has it", recorded.slice(before).some((r) => r.p_offer === id(7) && r.p_ok === true), JSON.stringify(sw));
// Without an email key the checks still run.
env.RESEND_API_KEY = ""; handler = null;
await import(new URL("../supabase/functions/notify/index.ts?nokey", import.meta.url).href);
const r = await handler(new Request("https://x/", { method: "POST", body: JSON.stringify({ kind: "verify_tx", id: id(1) }) }));
ok("checks don't need email switched on", r.status === 200);

console.log(res.join("\n"));
const failed = res.filter((x) => x.startsWith("FAIL")).length;
console.log(failed ? failed + " failed" : res.length + " passed");
process.exit(failed ? 1 : 0);
