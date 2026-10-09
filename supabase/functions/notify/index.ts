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
const PREF: Record<string, string> = { offer: "offers", accepted: "trades", noshow: "trades", message: "messages", search: "matches", mutual: "matches", shipby: "reminders", bondclaim: "reminders", bondfee: "trades" };

// Each email goes out in the language on the recipient's profile (profiles.lang: en, es, ja, pt),
// written to the same glossary as the board (i18n/GLOSSARY.md).
type Lang = "en" | "es" | "ja" | "pt";
const LANGS: Lang[] = ["en", "es", "ja", "pt"];
const LOCALE: Record<Lang, string> = { en: "en-US", es: "es-ES", ja: "ja-JP", pt: "pt-BR" };

async function recipient(userId: string, kind: string) {
  const p = await one(`profiles?id=eq.${userId}&select=*`);
  if (p && p.email_notify === false) return null;
  const prefs = (p?.email_prefs ?? {}) as Record<string, unknown>;
  if (PREF[kind] && prefs[PREF[kind]] === false) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const lang = (LANGS.includes(p?.lang as Lang) ? p?.lang : "en") as Lang;
  return u?.email ? { email: String(u.email), name: (p?.name as string) || "", lang } : null;
}
const nameOf = async (userId: string) => ((await one(`profiles?id=eq.${userId}&select=name`))?.name as string) || "";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// Where the links go, in the recipient's language.
const boardUrl = (l: Lang) => `${SITE}/app${l === "en" ? "" : "?lang=" + l}#mine`;
const prefsUrl = (l: Lang) => `${SITE}/app${l === "en" ? "" : "?lang=" + l}#profile`;
const itemUrl = (id: string, l: Lang) => `${SITE}${l === "en" ? "" : "/" + l}/item/${id}`;
const day = (iso: string, l: Lang) => new Date(iso).toLocaleDateString(LOCALE[l], { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

type Mail = { subject: string; headline: string; lines: string[]; cta: string; href: string };
// The words of every email. Names and titles arrive already escaped where they go into HTML lines;
// subjects and headlines are plain text (the page escapes the headline).
const W = {
  en: {
    why: "You get these because you trade on Dot Trading Post.", choose: "Choose which emails you get", someone: "Someone", listing: "listing", item: "an item", theItem: "item",
    delivered: (sender: string, note: string) => ({ subject: `${sender}'s NFT arrived`, headline: `${sender}'s NFT is in your wallet`,
      lines: [`Checked on chain: ${note}.`, "Once you've received everything, press your dot to finish the trade."], cta: "Open the trade" }),
    offer: (from: string, title: string, give: string, msg: string): Omit<Mail, "href"> => ({ subject: `New offer on ${title || "your listing"}`, headline: `${from} wants to trade for your ${title || "listing"}`,
      lines: [`They're offering: <b>${give}</b>`, ...(msg ? [`“${msg}”`] : [])], cta: "See the offer" }),
    accepted: (owner: string, give: string, title: string, by: string) => ({ subject: `${owner} accepted your offer`, headline: `It's a trade: your ${give} for their ${title || "item"}`,
      lines: [by ? `Send your side by <b>${by}</b> and mark it sent. Sort out the details in your messages.` : "Sort out the details in your messages."], cta: "Open the trade" }),
    noshow: (title: string) => ({ subject: "A trade was closed as a no-show", headline: `Your trade for ${title || "an item"} was closed`,
      lines: ["The ship-by date passed without your side being marked sent, so the other trader closed it. It shows on your profile as a no-show."], cta: "See your trades" }),
    message: (sender: string, body: string) => ({ subject: `${sender} sent you a message`, headline: `${sender} wrote:`, lines: [`“${body}”`], cta: "Reply" }),
    search: (title: string, label: string) => ({ subject: `New: ${title}`, headline: "Something you're looking for just went up",
      lines: [`<b>${esc(title)}</b> fits your saved search “${esc(label)}”.`], cta: "Take a look" }),
    mutual: (title: string, label: string) => ({ subject: `A mutual match for your ${label}`, headline: "Someone has what you want, and wants what you have",
      lines: [`<b>${esc(title)}</b> was just listed by someone who'd take your <b>${esc(label)}</b> — and you said you'd take theirs.`], cta: "Make an offer" }),
    shipby: (by: string, title: string) => ({ subject: "Your trade's ship-by date is tomorrow", headline: `Send by ${by}`,
      lines: [`Your side of the trade for <b>${title}</b> isn't marked sent yet. After the date, the other trader can close it as a no-show.`], cta: "Mark it sent" }),
    bondclaim: (who: string, title: string, amount: string, by: string) => ({ subject: `${who} hasn't sent — close the no-show by ${by}`, headline: `Their ${amount} bond lapses on ${by}`,
      lines: [`The ship-by date for <b>${title}</b> has passed and ${who} hasn't marked their side sent. You have, so you can close the trade as a no-show and their bond is paid to you.`,
        `Card holds last seven days: close it before <b>${by}</b>, or the hold lapses and there is nothing to pay out.`], cta: "Open the trade" }),
    bondfee: (fee: string, title: string) => ({ subject: `Your ${fee} fee was taken — the hold is released`, headline: `Your bond on ${title} has done its job`,
      lines: [`You marked your side sent, so the <b>${fee}</b> fee was taken from your card hold and the rest released. Card holds only last seven days, which is why it doesn't wait for the trade to finish.`,
        "If the other side never sends and you close the trade as a no-show, the fee comes back to you."], cta: "See the trade" }),
  },
  es: {
    why: "Recibes estos correos porque intercambias en Dot Trading Post.", choose: "Elige qué correos recibes", someone: "Alguien", listing: "anuncio", item: "un artículo", theItem: "artículo",
    delivered: (sender: string, note: string) => ({ subject: `Llegó el NFT de ${sender}`, headline: `El NFT de ${sender} ya está en tu wallet`,
      lines: [`Comprobado en la cadena: ${note}.`, "Cuando hayas recibido todo, pulsa tu punto para terminar el intercambio."], cta: "Abrir el intercambio" }),
    offer: (from: string, title: string, give: string, msg: string) => ({ subject: `Nueva oferta por ${title || "tu anuncio"}`, headline: `${from} quiere intercambiar por tu ${title || "anuncio"}`,
      lines: [`Ofrece: <b>${give}</b>`, ...(msg ? [`«${msg}»`] : [])], cta: "Ver la oferta" }),
    accepted: (owner: string, give: string, title: string, by: string) => ({ subject: `${owner} aceptó tu oferta`, headline: `Trato hecho: tu ${give} por su ${title || "artículo"}`,
      lines: [by ? `Envía tu parte antes del <b>${by}</b> y márcala como enviada. Concreten los detalles por mensajes.` : "Concreten los detalles por mensajes."], cta: "Abrir el intercambio" }),
    noshow: (title: string) => ({ subject: "Un intercambio se cerró como plantón", headline: `Se cerró tu intercambio por ${title || "un artículo"}`,
      lines: ["Pasó la fecha límite de envío sin que marcaras tu parte como enviada, así que la otra persona lo cerró. Aparece en tu perfil como un plantón."], cta: "Ver tus intercambios" }),
    message: (sender: string, body: string) => ({ subject: `${sender} te envió un mensaje`, headline: `${sender} escribió:`, lines: [`«${body}»`], cta: "Responder" }),
    search: (title: string, label: string) => ({ subject: `Nuevo: ${title}`, headline: "Acaban de publicar algo que buscas",
      lines: [`<b>${esc(title)}</b> encaja con tu búsqueda guardada «${esc(label)}».`], cta: "Echar un vistazo" }),
    mutual: (title: string, label: string) => ({ subject: `Una coincidencia mutua para tu ${label}`, headline: "Alguien tiene lo que quieres, y quiere lo que tienes",
      lines: [`Alguien que aceptaría tu <b>${esc(label)}</b> acaba de publicar <b>${esc(title)}</b>, y tú dijiste que aceptarías lo suyo.`], cta: "Hacer una oferta" }),
    bondclaim: (who: string, title: string, amount: string, by: string) => ({ subject: `${who} no ha enviado: cierra la incomparecencia antes del ${by}`, headline: `Su fianza de ${amount} caduca el ${by}`,
      lines: [`La fecha límite de envío de <b>${title}</b> ya pasó y ${who} no ha marcado su parte como enviada. Tú sí, así que puedes cerrar el intercambio como incomparecencia y su fianza se te paga a ti.`,
        `Las retenciones en tarjeta duran siete días: ciérralo antes del <b>${by}</b>, o la retención caduca y no queda nada que pagar.`], cta: "Abrir el intercambio" }),
    bondfee: (fee: string, title: string) => ({ subject: `Se ha cobrado tu comisión de ${fee}: la retención queda liberada`, headline: `Tu fianza por ${title} ya cumplió su función`,
      lines: [`Marcaste tu parte como enviada, así que la comisión de <b>${fee}</b> se cobró de la retención de tu tarjeta y el resto quedó liberado. Las retenciones solo duran siete días, por eso no espera a que termine el intercambio.`,
        "Si la otra parte nunca envía y cierras el intercambio como incomparecencia, la comisión se te devuelve."], cta: "Ver el intercambio" }),
    shipby: (by: string, title: string) => ({ subject: "Mañana vence la fecha límite de envío de tu intercambio", headline: `Envía antes del ${by}`,
      lines: [`Tu parte del intercambio por <b>${title}</b> todavía no está marcada como enviada. Pasada la fecha, la otra persona puede cerrarlo como plantón.`], cta: "Marcar como enviado" }),
  },
  ja: {
    why: "Dot Trading Postで交換をしているため、このメールをお送りしています。", choose: "受け取るメールを選ぶ", someone: "誰か", listing: "出品", item: "品物", theItem: "品物",
    delivered: (sender: string, note: string) => ({ subject: `${sender}さんのNFTが届きました`, headline: `${sender}さんのNFTがあなたのウォレットに届きました`,
      lines: [`オンチェーンで確認済み：${note}。`, "すべて受け取ったら、ドットを押して交換を完了しましょう。"], cta: "取引を開く" }),
    offer: (from: string, title: string, give: string, msg: string) => ({ subject: `${title || "あなたの出品"}に新しいオファー`, headline: `${from}さんが${title || "あなたの出品"}との交換を希望しています`,
      lines: [`オファー内容：<b>${give}</b>`, ...(msg ? [`「${msg}」`] : [])], cta: "オファーを見る" }),
    accepted: (owner: string, give: string, title: string, by: string) => ({ subject: `${owner}さんがオファーを承認しました`, headline: `交換成立：あなたの${give}と相手の${title || "品物"}`,
      lines: [by ? `<b>${by}</b>までに自分の分を送り、発送済みにしてください。詳細はメッセージで決めましょう。` : "詳細はメッセージで決めましょう。"], cta: "取引を開く" }),
    noshow: (title: string) => ({ subject: "交換が「未発送」として終了しました", headline: `${title || "品物"}の交換が終了しました`,
      lines: ["発送期限までにあなたの分が発送済みにならなかったため、相手が取引を終了しました。プロフィールに未発送として表示されます。"], cta: "取引を見る" }),
    message: (sender: string, body: string) => ({ subject: `${sender}さんからメッセージが届きました`, headline: `${sender}さんより：`, lines: [`「${body}」`], cta: "返信する" }),
    search: (title: string, label: string) => ({ subject: `新着：${title}`, headline: "探しているものが出品されました",
      lines: [`<b>${esc(title)}</b>が、保存した検索「${esc(label)}」に一致しました。`], cta: "見てみる" }),
    mutual: (title: string, label: string) => ({ subject: `あなたの${label}に相互マッチ`, headline: "欲しいものを持っていて、あなたのものを欲しがっている人がいます",
      lines: [`あなたの<b>${esc(label)}</b>を欲しがっている人が<b>${esc(title)}</b>を出品しました。あなたもそれを希望しています。`], cta: "オファーする" }),
    bondclaim: (who: string, title: string, amount: string, by: string) => ({ subject: `${who}さんが未発送です。${by}までに不履行として締めてください`, headline: `相手の${amount}の保証金は${by}に失効します`,
      lines: [`<b>${title}</b>の発送期限を過ぎましたが、${who}さんはまだ発送済みにしていません。あなたは発送済みなので、この交換を不履行として締めることができ、相手の保証金があなたに支払われます。`,
        `カードの仮押さえは7日間だけです。<b>${by}</b>より前に締めてください。過ぎると仮押さえが失効し、支払えるものがなくなります。`], cta: "交換を開く" }),
    bondfee: (fee: string, title: string) => ({ subject: `${fee}の手数料を受け取りました。仮押さえは解除されました`, headline: `${title}の保証金は役目を終えました`,
      lines: [`発送済みにしていただいたので、カードの仮押さえから<b>${fee}</b>の手数料を受け取り、残りは解除しました。仮押さえは7日間しか続かないため、交換の完了を待たずに行います。`,
        "相手が最後まで発送せず、あなたが不履行として締めた場合、手数料はお返しします。"], cta: "交換を見る" }),
    shipby: (by: string, title: string) => ({ subject: "明日が交換の発送期限です", headline: `${by}までに発送`,
      lines: [`<b>${title}</b>の交換で、あなたの分がまだ発送済みになっていません。期限を過ぎると、相手が「未発送」として終了できます。`], cta: "発送済みにする" }),
  },
  pt: {
    why: "Você recebe estes e-mails porque troca no Dot Trading Post.", choose: "Escolha quais e-mails receber", someone: "Alguém", listing: "anúncio", item: "um item", theItem: "item",
    delivered: (sender: string, note: string) => ({ subject: `O NFT de ${sender} chegou`, headline: `O NFT de ${sender} está na sua carteira`,
      lines: [`Conferido na blockchain: ${note}.`, "Quando você tiver recebido tudo, aperte seu ponto para concluir a troca."], cta: "Abrir a troca" }),
    offer: (from: string, title: string, give: string, msg: string) => ({ subject: `Nova proposta por ${title || "seu anúncio"}`, headline: `${from} quer trocar pelo seu ${title || "anúncio"}`,
      lines: [`A proposta: <b>${give}</b>`, ...(msg ? [`“${msg}”`] : [])], cta: "Ver a proposta" }),
    accepted: (owner: string, give: string, title: string, by: string) => ({ subject: `${owner} aceitou sua proposta`, headline: `Troca fechada: seu ${give} pelo ${title || "item"}`,
      lines: [by ? `Envie a sua parte até <b>${by}</b> e marque como enviada. Combinem os detalhes pelas mensagens.` : "Combinem os detalhes pelas mensagens."], cta: "Abrir a troca" }),
    noshow: (title: string) => ({ subject: "Uma troca foi encerrada como furo", headline: `Sua troca por ${title || "um item"} foi encerrada`,
      lines: ["O prazo de envio passou sem a sua parte ser marcada como enviada, então a outra pessoa encerrou a troca. Isso aparece no seu perfil como um furo."], cta: "Ver suas trocas" }),
    message: (sender: string, body: string) => ({ subject: `${sender} te mandou uma mensagem`, headline: `${sender} escreveu:`, lines: [`“${body}”`], cta: "Responder" }),
    search: (title: string, label: string) => ({ subject: `Novo: ${title}`, headline: "Acabou de aparecer algo que você procura",
      lines: [`<b>${esc(title)}</b> combina com sua busca salva “${esc(label)}”.`], cta: "Dar uma olhada" }),
    mutual: (title: string, label: string) => ({ subject: `Uma combinação mútua para seu ${label}`, headline: "Alguém tem o que você quer, e quer o que você tem",
      lines: [`<b>${esc(title)}</b> acabou de ser anunciado por alguém que aceitaria seu <b>${esc(label)}</b> — e você disse que aceitaria o dela.`], cta: "Fazer uma proposta" }),
    bondclaim: (who: string, title: string, amount: string, by: string) => ({ subject: `${who} não enviou — feche a falta até ${by}`, headline: `A caução de ${amount} da pessoa expira em ${by}`,
      lines: [`O prazo de envio de <b>${title}</b> passou e ${who} não marcou o lado dela como enviado. Você marcou, então pode fechar a troca como falta e a caução vai para você.`,
        `A reserva no cartão dura sete dias: feche antes de <b>${by}</b>, ou a reserva expira e não sobra nada para pagar.`], cta: "Abrir a troca" }),
    bondfee: (fee: string, title: string) => ({ subject: `Sua taxa de ${fee} foi cobrada — a reserva foi liberada`, headline: `Sua caução em ${title} cumpriu o papel dela`,
      lines: [`Você marcou o seu lado como enviado, então a taxa de <b>${fee}</b> foi cobrada da reserva no seu cartão e o restante foi liberado. Reservas no cartão duram só sete dias, por isso não esperam a troca terminar.`,
        "Se a outra pessoa nunca enviar e você fechar a troca como falta, a taxa volta para você."], cta: "Ver a troca" }),
    shipby: (by: string, title: string) => ({ subject: "O prazo de envio da sua troca é amanhã", headline: `Envie até ${by}`,
      lines: [`A sua parte da troca por <b>${title}</b> ainda não está marcada como enviada. Depois do prazo, a outra pessoa pode encerrar como furo.`], cta: "Marcar como enviada" }),
  },
};

function page(l: Lang, m: Mail) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3ead3;padding:28px 12px;">
<tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#fffcf4;border:3px solid #121212;border-radius:8px;" lang="${l === "pt" ? "pt-BR" : l}">
<tr><td style="padding:22px 26px 0;"><img src="${SITE}/icon-192.png?v=5" width="32" height="32" alt="" style="display:block;border:0;"></td></tr>
<tr><td style="padding:16px 26px 0;font-family:Helvetica,Arial,sans-serif;font-size:21px;line-height:1.2;font-weight:bold;color:#121212;">${esc(m.headline)}</td></tr>
${m.lines.map((x) => `<tr><td style="padding:10px 26px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#4b4740;">${x}</td></tr>`).join("")}
<tr><td style="padding:20px 26px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#ffd23f;border:3px solid #121212;border-radius:999px;">
<a href="${m.href}" style="display:inline-block;padding:11px 22px;font-family:Helvetica,Arial,sans-serif;font-size:12.5px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#121212;text-decoration:none;">${esc(m.cta)}</a></td></tr></table></td></tr>
<tr><td style="padding:20px 26px 22px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#8c867a;">${esc(W[l].why)} <a href="${prefsUrl(l)}" style="color:#8c867a;">${esc(W[l].choose)}</a>.</td></tr>
</table></td></tr></table>`;
}

async function send(to: { email: string }, subject: string, html: string, text: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to.email], subject, html, text }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// One email, written in the recipient's language: claim the key first, so two racing calls can't both send.
async function tell(userId: string, key: string, kind: string, build: (l: Lang) => Mail | Promise<Mail>) {
  const to = await recipient(userId, kind);
  if (!to) return 0;
  if (!(await claim(key, userId, kind))) return 0;
  const m = await build(to.lang);
  await send(to, m.subject, page(to.lang, m), [m.headline, ...m.lines.map((l) => l.replace(/<[^>]+>/g, ""))].join("\n\n") + `\n\n${m.cta}: ${m.href}\n\n${W[to.lang].choose}: ${prefsUrl(to.lang)}`);
  return 1;
}

async function handle(kind: string, id: string | null) {
  if (kind === "offer" && isId(id)) {
    const o = await one(`offers?id=eq.${id}&select=*`); if (!o || o.status !== "pending") return 0;
    const it = await one(`items?id=eq.${o.item_id}&select=title`); const from = await nameOf(o.from_id);
    return tell(o.owner_id, `offer:${o.id}`, kind, (l) => ({ ...W[l].offer(from || W[l].someone, it?.title ?? "", esc(o.give), o.msg ? esc(o.msg) : ""), href: boardUrl(l) }));
  }
  if (kind === "accepted" && isId(id)) {
    const o = await one(`offers?id=eq.${id}&select=*`); if (!o || o.status !== "agreed") return 0;
    const it = await one(`items?id=eq.${o.item_id}&select=title`); const owner = await nameOf(o.owner_id);
    return tell(o.from_id, `accepted:${o.id}`, kind, (l) => ({ ...W[l].accepted(owner || W[l].someone, o.give, it?.title ?? "", o.ship_by ? day(o.ship_by, l) : ""), href: boardUrl(l) }));
  }
  if (kind === "noshow" && isId(id)) {
    const o = await one(`offers?id=eq.${id}&select=*`); if (!o || !o.defaulted_by) return 0;
    const it = await one(`items?id=eq.${o.item_id}&select=title`);
    return tell(o.defaulted_by, `noshow:${o.id}`, kind, (l) => ({ ...W[l].noshow(it?.title ?? ""), href: boardUrl(l) }));
  }
  if (kind === "message" && isId(id)) {
    const m = await one(`messages?id=eq.${id}&select=*`); if (!m) return 0;
    const o = await one(`offers?id=eq.${m.offer_id}&select=owner_id,from_id,item_id`); if (!o) return 0;
    const to = m.from_id === o.owner_id ? o.from_id : o.owner_id;
    const sender = await nameOf(m.from_id); const hour = new Date().toISOString().slice(0, 13);
    const body = esc(String(m.body).slice(0, 280)) + (String(m.body).length > 280 ? "…" : "");
    return tell(to, `message:${m.offer_id}:${to}:${hour}`, kind, (l) => ({ ...W[l].message(sender || W[l].someone, body), href: boardUrl(l) }));
  }
  if (kind === "listing" && isId(id)) {
    const it = await one(`items?id=eq.${id}&select=id,title,owner_id,status`); if (!it || it.status !== "open") return 0;
    const targets = await db("rpc/listing_alert_targets", { method: "POST", body: { p_item: id } }) as Array<{ user_id: string; kind: string; label: string; other_item: string | null }>;
    let n = 0;
    for (const t of targets ?? []) {
      if (t.kind === "search") n += await tell(t.user_id, `search:${id}:${t.user_id}`, "search", (l) => ({ ...W[l].search(it.title, t.label), href: itemUrl(id!, l) }));
      else n += await tell(t.user_id, `mutual:${id}:${t.other_item}`, "mutual", (l) => ({ ...W[l].mutual(it.title, t.label), href: itemUrl(id!, l) }));
    }
    return n;
  }
  if (kind === "bond_sweep") {
    const now = new Date().toISOString(), DAYMS = 86400e3;
    let n = 0;
    // The ship-by date passed, one side sent, the other holds a bond and hasn't: tell the honest
    // side they can close it now, and by when, because the hold lapses seven days after it began.
    const late = await db(`offers?status=eq.agreed&ship_by=lt.${now}&select=*`) as Array<Record<string, any>>;
    for (const o of late ?? []) {
      const sent = (side: "owner" | "from") => !!o[`${side}_sent_at`] || !!(side === "owner" ? o.confirm_owner : o.confirm_from);
      const honest = sent("owner") && !sent("from") ? "owner" : sent("from") && !sent("owner") ? "from" : null;
      if (!honest) continue;
      const other = honest === "owner" ? "from" : "owner";
      const b = await one(`bonds?offer_id=eq.${o.id}&user_id=eq.${o[`${other}_id`]}&status=eq.held&select=*`);
      if (!b) continue;
      const by = new Date(new Date(b.held_at || b.created_at).getTime() + 7 * DAYMS).toISOString();
      const it = await one(`items?id=eq.${o.item_id}&select=title`);
      const who = await nameOf(o[`${other}_id`]);
      n += await tell(o[`${honest}_id`], `bondclaim:${o.id}`, "bondclaim", (l) => ({ ...W[l].bondclaim(esc(who || W[l].someone), esc(it?.title ?? W[l].item), `$${(b.amount_cents / 100).toFixed(2)}`, day(by, l)), href: boardUrl(l) }));
    }
    // A fee taken on day six, while the trade is still going: say so, once.
    const since = new Date(Date.now() - 2 * DAYMS).toISOString();
    const taken = await db(`bonds?status=eq.released&fee_captured_cents=gt.0&settled_at=gt.${since}&select=*`) as Array<Record<string, any>>;
    for (const b of taken ?? []) {
      const o = await one(`offers?id=eq.${b.offer_id}&select=*`);
      if (!o || o.status !== "agreed") continue;
      const it = await one(`items?id=eq.${o.item_id}&select=title`);
      n += await tell(b.user_id, `bondfee:${b.id}`, "bondfee", (l) => ({ ...W[l].bondfee(`$${(b.fee_captured_cents / 100).toFixed(2)}`, esc(it?.title ?? W[l].item)), href: boardUrl(l) }));
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
        n += await tell(o[`${side}_id`], `shipby:${o.id}:${side}`, "shipby", (l) => ({ ...W[l].shipby(day(o.ship_by, l), esc(it?.title ?? W[l].item)), href: boardUrl(l) }));
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
// `to` is every wallet the recipient has linked: arriving in any of them counts.
export async function checkTransfer(a: { chain: number; contract: string; tokenId: string; kind: string }, tx: string, to: string | string[], notBefore: number, whoTo: string): Promise<Verdict> {
  if (!RPC[a.chain]) return { state: "rejected", note: "that chain isn't one the board can check" };
  const receipt = await rpc(a.chain, "eth_getTransactionReceipt", [tx]);
  if (!receipt) return { state: "pending", note: `not on ${CHAIN_NAME[a.chain]} yet` };
  if (receipt.status !== "0x1") return { state: "rejected", note: "that transaction failed on chain, so nothing moved" };
  const block = await rpc(a.chain, "eth_getBlockByNumber", [receipt.blockNumber, false]);
  if (block && Number(BigInt(block.timestamp)) * 1000 < notBefore) return { state: "rejected", note: "that transaction happened before this trade was agreed" };
  const contract = a.contract.toLowerCase(), id = BigInt(a.tokenId), wants = (Array.isArray(to) ? to : [to]).map((x) => x.toLowerCase());
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
      if (wants.includes(rcpt)) return { state: "verified", note: `NFT #${a.tokenId.length > 12 ? short(a.tokenId) : a.tokenId} reached ${whoTo}'s wallet ${short(rcpt)} on ${CHAIN_NAME[a.chain]}` };
      elsewhere = rcpt;
    } else if (wants.includes(rcpt)) otherToken = true;
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
    const whoTo = String(p(recipient).name || "the other trader");
    // The main wallet and any others they've linked (linked_wallets is missing until wallets.sql is re-run).
    const more = await db(`linked_wallets?owner_id=eq.${recipient}&select=address`).catch(() => []) as Array<{ address: string }>;
    const to = [String(p(recipient).wallet_address ?? "")].concat((Array.isArray(more) ? more : []).map((x) => String(x.address))).filter((x) => /^0x[0-9a-fA-F]{40}$/.test(x));
    let v: Verdict;
    if (!asset || !asset.asset_contract || !["erc721", "erc1155"].includes(asset.asset_kind)) v = { state: "rejected", note: "this side of the trade isn't an NFT" };
    else if (!to.length) v = { state: "rejected", note: `${whoTo} has no wallet linked, so there's nowhere to check it arrived` };
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
      await tell(recipient, `delivered:${o.id}:${side}`, "accepted", (l) => ({ ...W[l].delivered(sender || W[l].someone, esc(v.note)), href: boardUrl(l) })).catch(() => 0);
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
