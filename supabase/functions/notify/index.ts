// Dot Trading Post — email notifications, and checking on-chain deliveries.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name it `notify`, paste this
// file, and turn "Verify JWT" OFF (the database calls it, not a signed-in person). Then Edge
// Functions → Secrets → add RESEND_API_KEY (a key from resend.com — the same service your sign-in
// emails go through). Optional: NOTIFY_FROM (default "Dot Trading Post <hello@dottrader.app>"),
// SITE_URL (default https://www.dottrader.app).
//
// The database posts { kind, id } when something happens (notifications.sql). This function trusts
// nothing else in the request: it reads the offer, message or listing itself with the service role,
// works out who should hear about it, skips anyone who switched emails off, and records every email
// in notifications_sent under a key — so the same event can never send twice, and a message thread
// emails each person at most once an hour however busy it gets.
//
// No libraries: the database's REST API and Resend's, both with fetch.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("NOTIFY_FROM") ?? "Dot Trading Post <hello@dottrader.app>";
const SITE = (Deno.env.get("SITE_URL") ?? "https://www.dottrader.app").replace(/\/$/, "");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function db(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: init.prefer ?? "return=representation" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const one = async (path: string) => { const rows = await db(path); return Array.isArray(rows) ? rows[0] ?? null : null; };
const isId = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

// Claim a notification key. True only the first time: the insert is ignored if the key exists.
async function claim(key: string, userId: string, kind: string) {
  const rows = await db("notifications_sent?on_conflict=key", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { key, user_id: userId, kind } });
  return Array.isArray(rows) && rows.length > 0;
}

// Each kind of email answers to one of the settings a trader can switch off in their profile.
const PREF: Record<string, string> = { offer: "offers", accepted: "trades", noshow: "trades", message: "messages", search: "matches", mutual: "matches", shipby: "reminders" };

async function recipient(userId: string, kind: string) {
  const p = await one(`profiles?id=eq.${userId}&select=name,email_notify,email_prefs`);
  if (p && p.email_notify === false) return null;
  const prefs = (p?.email_prefs ?? {}) as Record<string, unknown>;
  if (PREF[kind] && prefs[PREF[kind]] === false) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.email ? { email: String(u.email), name: (p?.name as string) || "" } : null;
}
const nameOf = async (userId: string) => ((await one(`profiles?id=eq.${userId}&select=name`))?.name as string) || "Someone";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function page(headline: string, lines: string[], cta: string, href: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3ead3;padding:28px 12px;">
<tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#fffcf4;border:3px solid #121212;border-radius:8px;">
<tr><td style="padding:22px 26px 0;"><img src="${SITE}/icon-192.png?v=5" width="32" height="32" alt="" style="display:block;border:0;"></td></tr>
<tr><td style="padding:16px 26px 0;font-family:Helvetica,Arial,sans-serif;font-size:21px;line-height:1.2;font-weight:bold;color:#121212;">${esc(headline)}</td></tr>
${lines.map((l) => `<tr><td style="padding:10px 26px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#4b4740;">${l}</td></tr>`).join("")}
<tr><td style="padding:20px 26px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#ffd23f;border:3px solid #121212;border-radius:999px;">
<a href="${href}" style="display:inline-block;padding:11px 22px;font-family:Helvetica,Arial,sans-serif;font-size:12.5px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#121212;text-decoration:none;">${esc(cta)}</a></td></tr></table></td></tr>
<tr><td style="padding:20px 26px 22px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#8c867a;">You get these because you trade on Dot Trading Post. <a href="${SITE}/app#profile" style="color:#8c867a;">Choose which emails you get</a>.</td></tr>
</table></td></tr></table>`;
}

async function send(to: { email: string }, subject: string, html: string, text: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to.email], subject, html, text }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// One email: claim the key first, so two racing calls can't both send.
async function tell(userId: string, key: string, kind: string, subject: string, headline: string, lines: string[], cta: string, href: string) {
  const to = await recipient(userId, kind);
  if (!to) return 0;
  if (!(await claim(key, userId, kind))) return 0;
  await send(to, subject, page(headline, lines, cta, href), [headline, ...lines.map((l) => l.replace(/<[^>]+>/g, ""))].join("\n\n") + `\n\n${cta}: ${href}\n\nChoose which emails you get: ${SITE}/app#profile`);
  return 1;
}

const board = `${SITE}/app#mine`;
const item = (id: string) => `${SITE}/item/${id}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

async function handle(kind: string, id: string | null) {
  if (kind === "offer" && isId(id)) {
    const o = await one(`offers?id=eq.${id}&select=*`); if (!o || o.status !== "pending") return 0;
    const it = await one(`items?id=eq.${o.item_id}&select=title`); const from = await nameOf(o.from_id);
    return tell(o.owner_id, `offer:${o.id}`, kind, `New offer on ${it?.title ?? "your listing"}`, `${from} wants to trade for your ${it?.title ?? "listing"}`,
      [`They're offering: <b>${esc(o.give)}</b>`, ...(o.msg ? [`“${esc(o.msg)}”`] : [])], "See the offer", board);
  }
  if (kind === "accepted" && isId(id)) {
    const o = await one(`offers?id=eq.${id}&select=*`); if (!o || o.status !== "agreed") return 0;
    const it = await one(`items?id=eq.${o.item_id}&select=title`); const owner = await nameOf(o.owner_id);
    return tell(o.from_id, `accepted:${o.id}`, kind, `${owner} accepted your offer`, `It's a trade: your ${o.give} for their ${it?.title ?? "item"}`,
      [o.ship_by ? `Send your side by <b>${day(o.ship_by)}</b> and mark it sent. Sort out the details in your messages.` : "Sort out the details in your messages."], "Open the trade", board);
  }
  if (kind === "noshow" && isId(id)) {
    const o = await one(`offers?id=eq.${id}&select=*`); if (!o || !o.defaulted_by) return 0;
    const it = await one(`items?id=eq.${o.item_id}&select=title`);
    return tell(o.defaulted_by, `noshow:${o.id}`, kind, "A trade was closed as a no-show", `Your trade for ${it?.title ?? "an item"} was closed`,
      ["The ship-by date passed without your side being marked sent, so the other trader closed it. It shows on your profile as a no-show."], "See your trades", board);
  }
  if (kind === "message" && isId(id)) {
    const m = await one(`messages?id=eq.${id}&select=*`); if (!m) return 0;
    const o = await one(`offers?id=eq.${m.offer_id}&select=owner_id,from_id,item_id`); if (!o) return 0;
    const to = m.from_id === o.owner_id ? o.from_id : o.owner_id;
    const sender = await nameOf(m.from_id); const hour = new Date().toISOString().slice(0, 13);
    return tell(to, `message:${m.offer_id}:${to}:${hour}`, kind, `${sender} sent you a message`, `${sender} wrote:`,
      [`“${esc(String(m.body).slice(0, 280))}${String(m.body).length > 280 ? "…" : ""}”`], "Reply", board);
  }
  if (kind === "listing" && isId(id)) {
    const it = await one(`items?id=eq.${id}&select=id,title,owner_id,status`); if (!it || it.status !== "open") return 0;
    const targets = await db("rpc/listing_alert_targets", { method: "POST", body: { p_item: id } }) as Array<{ user_id: string; kind: string; label: string; other_item: string | null }>;
    let n = 0;
    for (const t of targets ?? []) {
      if (t.kind === "search") n += await tell(t.user_id, `search:${id}:${t.user_id}`, "search", `New: ${it.title}`, `Something you're looking for just went up`,
        [`<b>${esc(it.title)}</b> fits your saved search “${esc(t.label)}”.`], "Take a look", item(id));
      else n += await tell(t.user_id, `mutual:${id}:${t.other_item}`, "mutual", `A mutual match for your ${t.label}`, `Someone has what you want, and wants what you have`,
        [`<b>${esc(it.title)}</b> was just listed by someone who'd take your <b>${esc(t.label)}</b> — and you said you'd take theirs.`], "Make an offer", item(id));
    }
    return n;
  }
  if (kind === "shipby_sweep") {
    const soon = new Date(Date.now() + 26 * 3600e3).toISOString(), now = new Date().toISOString();
    const due = await db(`offers?status=eq.agreed&ship_by=gt.${now}&ship_by=lt.${soon}&select=*`) as Array<Record<string, any>>;
    let n = 0;
    for (const o of due ?? []) {
      const it = await one(`items?id=eq.${o.item_id}&select=title`);
      for (const side of ["owner", "from"] as const) {
        if (o[`${side}_sent_at`] || (side === "owner" ? o.confirm_owner : o.confirm_from) || o.swap_tx) continue;
        n += await tell(o[`${side}_id`], `shipby:${o.id}:${side}`, "shipby", "Your trade's ship-by date is tomorrow", `Send by ${day(o.ship_by)}`,
          [`Your side of the trade for <b>${esc(it?.title ?? "an item")}</b> isn't marked sent yet. After the date, the other trader can close it as a no-show.`], "Mark it sent", board);
      }
    }
    return n;
  }
  return 0;
}

// ---------------------------------------------------------------- on-chain delivery
//
// "Sent on chain" is a claim until the chain confirms it. For each side marked that way and still
// "checking", read the transaction from that chain's public RPC and confirm it succeeded, happened
// after the trade was agreed, and moved exactly that NFT (contract + token id) to the OTHER side's
// linked wallet. It doesn't insist the NFT came from the sender's linked wallet: if the right token
// reached the right person, the side was delivered. The verdict goes to record_delivery, which only
// the service role may call; a rejected send is undone so the person can mark it again.

const RPC: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com", 8453: "https://mainnet.base.org", 42161: "https://arbitrum-one-rpc.publicnode.com",
  10: "https://optimism-rpc.publicnode.com", 137: "https://polygon-bor-rpc.publicnode.com", 56: "https://bsc-rpc.publicnode.com",
  43114: "https://avalanche-c-chain-rpc.publicnode.com", 7777777: "https://rpc.zora.energy",
};
const CHAIN_NAME: Record<number, string> = { 1: "Ethereum", 8453: "Base", 42161: "Arbitrum", 10: "Optimism", 137: "Polygon", 56: "BNB Chain", 43114: "Avalanche", 7777777: "Zora" };
const T721 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";   // Transfer(from, to, id)
const T1155 = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";  // TransferSingle(op, from, to, id, value)
const T1155B = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb"; // TransferBatch(op, from, to, ids, values)
const STALE_MS = 24 * 3600e3;  // a transaction the chain still doesn't know after a day isn't coming

async function rpc(chain: number, method: string, params: unknown[]) {
  const r = await fetch(RPC[chain], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`rpc ${method}: ${j.error.message ?? "error"}`);
  return j.result;
}
const addrOf = (topic: string) => "0x" + String(topic).slice(-40).toLowerCase();
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
function words(data: string) { const h = String(data || "0x").slice(2); const w: bigint[] = []; for (let i = 0; i + 64 <= h.length; i += 64) w.push(BigInt("0x" + h.slice(i, i + 64))); return w; }
// TransferBatch data: offset(ids), offset(values), then each array as length + items.
function batch(data: string) {
  const w = words(data); if (w.length < 2) return { ids: [] as bigint[], values: [] as bigint[] };
  const arr = (off: bigint) => { const i = Number(off / 32n), n = Number(w[i] ?? 0n); return w.slice(i + 1, i + 1 + n); };
  return { ids: arr(w[0]), values: arr(w[1]) };
}

type Verdict = { state: "verified" | "rejected" | "pending"; note: string };
export async function checkTransfer(a: { chain: number; contract: string; tokenId: string; kind: string }, tx: string, to: string, notBefore: number, whoTo: string): Promise<Verdict> {
  if (!RPC[a.chain]) return { state: "rejected", note: "that chain isn't one the board can check" };
  const receipt = await rpc(a.chain, "eth_getTransactionReceipt", [tx]);
  if (!receipt) return { state: "pending", note: `not on ${CHAIN_NAME[a.chain]} yet` };
  if (receipt.status !== "0x1") return { state: "rejected", note: "that transaction failed on chain, so nothing moved" };
  const block = await rpc(a.chain, "eth_getBlockByNumber", [receipt.blockNumber, false]);
  if (block && Number(BigInt(block.timestamp)) * 1000 < notBefore) return { state: "rejected", note: "that transaction happened before this trade was agreed" };
  const contract = a.contract.toLowerCase(), id = BigInt(a.tokenId), want = to.toLowerCase();
  let elsewhere = "", otherToken = false;
  for (const l of receipt.logs ?? []) {
    const t = (l.topics ?? []).map((x: string) => String(x).toLowerCase()), here = String(l.address).toLowerCase() === contract;
    let rcpt = "", ids: bigint[] = [], amounts: bigint[] = [];
    if (t[0] === T721 && t.length === 4) { rcpt = addrOf(t[2]); ids = [BigInt(t[3])]; amounts = [1n]; }
    else if (t[0] === T1155 && t.length === 4) { const w = words(l.data); rcpt = addrOf(t[3]); ids = [w[0]]; amounts = [w[1] ?? 0n]; }
    else if (t[0] === T1155B && t.length === 4) { const b = batch(l.data); rcpt = addrOf(t[3]); ids = b.ids; amounts = b.values; }
    else continue;
    const i = ids.findIndex((x) => x === id);
    if (here && i >= 0 && amounts[i] > 0n) {
      if (rcpt === want) return { state: "verified", note: `NFT #${a.tokenId.length > 12 ? short(a.tokenId) : a.tokenId} reached ${whoTo}'s wallet ${short(want)} on ${CHAIN_NAME[a.chain]}` };
      elsewhere = rcpt;
    } else if (rcpt === want) otherToken = true;
  }
  if (elsewhere) return { state: "rejected", note: `that NFT went to ${short(elsewhere)}, not ${whoTo}'s linked wallet` };
  if (otherToken) return { state: "rejected", note: `a different token was sent to ${whoTo} — not the one in this trade` };
  return { state: "rejected", note: `no transfer of this NFT to ${whoTo}'s linked wallet in that transaction` };
}

async function verifyOffer(offerId: string) {
  const o = await one(`offers?id=eq.${offerId}&select=*`); if (!o || o.status !== "agreed" && o.status !== "done") return 0;
  const it = await one(`items?id=eq.${o.item_id}&select=title,asset_kind,asset_chain,asset_contract,asset_token_id`);
  const people = await db(`profiles?id=in.(${o.owner_id},${o.from_id})&select=id,name,wallet_address`) as Array<Record<string, any>>;
  const p = (uid: string) => people.find((x) => x.id === uid) ?? {};
  // Agreeing set the ship-by date four days out; a send can't be older than the agreement.
  const agreedAt = o.ship_by ? new Date(o.ship_by).getTime() - 4 * 86400e3 - 10 * 60e3 : 0;
  let n = 0;
  for (const side of ["owner", "from"] as const) {
    if (o[`${side}_sent_how`] !== "onchain" || o[`${side}_tx_status`] !== "checking") continue;
    const asset = side === "owner" ? it : o, recipient = side === "owner" ? o.from_id : o.owner_id;
    const to = String(p(recipient).wallet_address ?? ""), whoTo = String(p(recipient).name || "the other trader");
    let v: Verdict;
    if (!asset || !asset.asset_contract || !["erc721", "erc1155"].includes(asset.asset_kind)) v = { state: "rejected", note: "this side of the trade isn't an NFT" };
    else if (!/^0x[0-9a-fA-F]{40}$/.test(to)) v = { state: "rejected", note: `${whoTo} has no wallet linked, so there's nowhere to check it arrived` };
    else {
      try { v = await checkTransfer({ chain: Number(asset.asset_chain), contract: asset.asset_contract, tokenId: String(asset.asset_token_id), kind: asset.asset_kind }, o[`${side}_ref`], to, agreedAt, whoTo); }
      catch (e) { console.error("[verify]", (e as Error).message); continue; }  // the RPC hiccupped: the next sweep tries again
    }
    if (v.state === "pending") {
      if (Date.now() - new Date(o[`${side}_sent_at`]).getTime() < STALE_MS) continue;
      v = { state: "rejected", note: `that transaction isn't on ${CHAIN_NAME[Number(asset.asset_chain)] ?? "that chain"} — check the hash and the chain` };
    }
    await db("rpc/record_delivery", { method: "POST", body: { p_offer: o.id, p_side: side, p_ok: v.state === "verified", p_note: v.note } });
    n++;
    if (v.state === "verified" && RESEND_KEY) {
      const sender = await nameOf(o[`${side}_id`]);
      await tell(recipient, `delivered:${o.id}:${side}`, "accepted", `${sender}'s NFT arrived`, `${sender}'s NFT is in your wallet`,
        [`Checked on chain: ${esc(v.note)}.`, "Once you've received everything, press your dot to finish the trade."], "Open the trade", board).catch(() => 0);
    }
  }
  return n;
}

async function verifySweep() {
  const rows = await db(`offers?or=(owner_tx_status.eq.checking,from_tx_status.eq.checking)&select=id&limit=50`) as Array<{ id: string }>;
  let n = 0; for (const r of rows ?? []) n += await verifyOffer(r.id);
  return n;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: true, live: !!RESEND_KEY, checks: true });
  let body: { kind?: string; id?: string | null };
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  // Checking the chain doesn't need email switched on.
  if (body.kind === "verify_tx" || body.kind === "verify_sweep") {
    try { return json({ checked: body.kind === "verify_sweep" ? await verifySweep() : isId(body.id) ? await verifyOffer(String(body.id)) : 0 }); }
    catch (e) { console.error("[verify]", (e as Error).message); return json({ error: "check failed" }, 502); }
  }
  if (!RESEND_KEY) return json({ error: "notifications are not switched on yet" }, 503);
  try { return json({ sent: await handle(String(body.kind ?? ""), body.id ?? null) }); }
  catch (e) { console.error("[notify]", (e as Error).message); return json({ error: "notify failed" }, 502); }
});
