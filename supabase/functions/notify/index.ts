// Dot Trading Post — email notifications.
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

async function recipient(userId: string) {
  const p = await one(`profiles?id=eq.${userId}&select=name,email_notify`);
  if (p && p.email_notify === false) return null;
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
<tr><td style="padding:20px 26px 22px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#8c867a;">You get these because you trade on Dot Trading Post. Turn them off under My trades → Your profile.</td></tr>
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
  const to = await recipient(userId);
  if (!to) return 0;
  if (!(await claim(key, userId, kind))) return 0;
  await send(to, subject, page(headline, lines, cta, href), [headline, ...lines.map((l) => l.replace(/<[^>]+>/g, ""))].join("\n\n") + `\n\n${cta}: ${href}`);
  return 1;
}

const board = `${SITE}/app`;
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: true, live: !!RESEND_KEY });
  if (!RESEND_KEY) return json({ error: "notifications are not switched on yet" }, 503);
  let body: { kind?: string; id?: string | null };
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  try { return json({ sent: await handle(String(body.kind ?? ""), body.id ?? null) }); }
  catch (e) { console.error("[notify]", (e as Error).message); return json({ error: "notify failed" }, 502); }
});
