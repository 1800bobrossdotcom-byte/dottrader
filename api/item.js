// Dot Trading Post — one listing's own page: /item/<id>
//
// What a shared link opens, what a search engine indexes, and what an email notification points
// at. It shows the listing, who listed it and what they want, with one button into the board to
// make an offer. Listings that are taken down answer 404; finished ones stay readable but ask
// search engines not to list them.

const L = require("./_lib.js");
const nft = require("./nft.js");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Artwork for a digital listing with no photo of its own — but a link preview won't wait long.
function artOf(it) {
  if (!it.asset_kind || it.asset_kind === "erc20" || !nft.validToken(Number(it.asset_chain), String(it.asset_contract), String(it.asset_token_id), it.asset_kind)) return Promise.resolve(null);
  return Promise.race([
    nft.lookup(Number(it.asset_chain), it.asset_contract, String(it.asset_token_id), it.asset_kind).catch(() => null),
    new Promise((r) => setTimeout(() => r(null), 3500)),
  ]);
}

function assetLine(it, lang) {
  const t = (k, v) => L.I.t(lang, k, v);
  if (!it.asset_kind) return "";
  const c = L.CHAINS[it.asset_chain] || ["Chain " + it.asset_chain, null];
  const addr = String(it.asset_contract || "");
  const short = addr.slice(0, 6) + "…" + addr.slice(-4);
  const path = it.asset_kind === "erc20" ? "/token/" + addr : "/nft/" + addr + "/" + it.asset_token_id;
  return '<p class="asset"><span class="tag">' + L.esc(t("asset.on", { kind: t("kind." + it.asset_kind), chain: c[0] })) + "</span> " +
    (c[1] ? '<a href="' + L.esc(c[1] + path) + '" rel="nofollow noopener" target="_blank">' : "") + L.esc(short) +
    (it.asset_kind !== "erc20" ? " #" + L.esc(L.clip(it.asset_token_id, 24)) : "") + (c[1] ? "</a>" : "") +
    ' <span class="fine">' + L.esc(t("asset.checks")) + "</span></p>";
}

module.exports = async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  // /item/<words>-<uuid> or the older /item/<uuid>: only the id at the end counts.
  const asked = String(q.id || "").toLowerCase();
  const lang = L.I.langOf(q), P = L.I.prefix(lang), t = (k, v) => L.I.t(lang, k, v), cn = (c) => L.I.catName(lang, c);
  const day = (d) => new Date(d).toLocaleDateString(L.I.META[lang].date, { month: "short", day: "numeric", year: "numeric" });
  const id = (asked.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/) || [])[1] || "";
  if (!UUID.test(id)) return L.notFound(res, t("nf.listing"), lang);

  let it;
  try { it = (await L.rest("items?select=*&id=eq." + id))[0]; } catch (e) { return L.send(res, 503, L.page({ lang, path: "/", title: "Dot Trading Post", desc: "", noindex: true, body: '<section class="empty"><h1>' + L.esc(t("busy.h")) + "</h1><p>" + L.esc(t("busy.p")) + "</p></section>" })); }
  if (!it || it.status === "removed") return L.notFound(res, t(it ? "nf.removed" : "nf.listing"), lang);

  const [prof, badge, more, art, done] = await Promise.all([
    L.rest("profiles?select=id,name,area&id=eq." + it.owner_id).then((r) => r[0] || null, () => null),
    L.rest("verification_badges?select=verified_at,summary&status=eq.verified&item_id=eq." + id).then((r) => r[0] || null, () => null),
    L.rest("items?select=*&status=eq.open&cat=eq." + encodeURIComponent(it.cat) + "&id=neq." + id + "&order=created_at.desc&limit=6").catch(() => []),
    it.photos && it.photos.length ? Promise.resolve(null) : artOf(it),
    it.status === "traded" ? L.rest("trade_history?select=give,from_id,done_at&item_id=eq." + id).then((r) => r[0] || null, () => null) : Promise.resolve(null),
  ]);
  const doneWith = done ? await L.rest("profiles?select=name&id=eq." + done.from_id).then((r) => (r[0] && r[0].name) || t("i.another"), () => t("i.another")) : null;

  const photos = (it.photos || []).slice(0, 4);
  const pics = photos.length ? photos : art && art.image ? [art.image] : [];
  const name = (prof && prof.name) || t("i.aTrader");
  const want = L.wantText(it, lang);
  const open = it.status === "open";
  const state = open ? [t("state.open"), ""] : it.status === "pledged" ? [t("state.pledged"), "hold"] : [t("state.traded"), "ok"];
  const path = L.itemPath(it);
  // Any other spelling of the address (an old link, an edited title) goes to the current one.
  if ("/item/" + asked !== path) { res.statusCode = 301; res.setHeader("location", P + path); res.setHeader("cache-control", "public, s-maxage=300"); return res.end(); }
  const catPath = P + "/c/" + L.slug(it.cat);

  const desc = L.clip(t("i.desc", { title: it.title }) + (want === t("want.open") ? t("i.descOpen") : t("i.descWants", { want: lang === "en" ? want.replace(/^Any /, "any ") : want })) + (it.descr ? " " + it.descr : ""), 158);
  const ld = [
    {
      "@context": "https://schema.org", "@type": "Product", name: it.title, description: it.descr || desc,
      category: cn(it.cat), url: L.SITE + P + path, image: pics.filter((u) => /^https?:/.test(u)).concat(L.SITE + "/og/item/" + id + ".png"),
    },
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Dot Trading Post", item: L.SITE + P + "/" },
        { "@type": "ListItem", position: 2, name: cn(it.cat), item: L.SITE + catPath },
        { "@type": "ListItem", position: 3, name: it.title, item: L.SITE + P + path },
      ],
    },
  ];

  const body =
    '<nav class="crumbs" aria-label="Breadcrumb"><a href="' + P + '/">' + L.esc(t("crumb.home")) + '</a> <span aria-hidden="true">›</span> <a href="' + catPath + '">' + L.esc(cn(it.cat)) + "</a></nav>" +
    '<article class="listing" style="--c:' + L.hueOf(it.cat) + '">' +
      '<div class="media">' + (pics.length
        ? '<div class="pics' + (pics.length > 1 ? " many" : "") + '" tabindex="0" aria-label="' + L.esc(t("i.photos", { title: it.title })) + '">' +
            pics.map((u, i) => '<img src="' + L.esc(u) + '" alt="' + L.esc(pics.length > 1 ? t("i.photoN", { title: it.title, i: i + 1, n: pics.length }) : it.title) + '"' + (i ? ' loading="lazy"' : "") + ">").join("") +
          "</div>" + (pics.length > 1 ? '<p class="fine swipe">' + L.esc(pics.length === 2 ? t("i.swipe1") : t("i.swipeN", { n: pics.length - 1 })) + "</p>" : "")
        : '<div class="pics none" aria-hidden="true"><span>' + L.esc(it.title.charAt(0).toUpperCase()) + "</span></div>") + "</div>" +
      '<div class="info">' +
        '<p class="state"><span class="tag ' + state[1] + '">' + L.esc(state[0]) + '</span> <a class="tag cat" href="' + catPath + '">' + L.esc(cn(it.cat)) + "</a>" +
          (it.local_only ? ' <span class="tag local" title="' + L.esc(t("i.localTitle")) + '">' + L.esc(t("i.local")) + "</span>" : "") +
          (badge ? ' <span class="tag proof" title="' + L.esc(t("i.proofTitle")) + '"><s></s>' + L.esc(t("i.proof")) + "</span>" : "") + "</p>" +
        "<h1>" + L.esc(it.title) + "</h1>" +
        '<div class="sides"><div class="side h"><span class="k">' + L.esc(t("i.offering")) + '</span><span class="v">' + L.esc(it.title) + '</span></div><div class="arrow" aria-hidden="true"></div>' +
          '<div class="side w"><span class="k">' + L.esc(t("mini.wants")) + '</span><span class="v">' + L.esc(want) + "</span></div></div>" +
        (it.descr ? '<p class="desc">' + L.esc(it.descr) + "</p>" : "") +
        assetLine(it, lang) +
        (done ? '<p class="traded">' + t("i.traded", { give: L.esc(done.give), who: L.esc(doneWith) }) + " · " + day(done.done_at) + "</p>" : "") +
        '<p class="by">' + t("i.listedBy", { name: L.esc(name) }) + (prof && prof.area ? " · " + L.esc(prof.area) : "") +
          ' · <time datetime="' + L.esc(it.created_at) + '">' + day(it.created_at) + "</time></p>" +
        '<div class="acts">' +
          (open ? '<a class="btn" href="' + L.appHref(lang, "#item=" + id) + '">' + L.esc(t("i.offer")) + "</a>" : '<a class="btn" href="' + L.appHref(lang, "#cat=" + encodeURIComponent(it.cat)) + '">' + L.esc(t("i.seeElse")) + "</a>") +
          '<button class="btn ghost" type="button" data-share hidden>' + L.esc(t("share")) + "</button></div>" +
        '<p class="fine">' + L.esc(t("i.fine")) + ' <a href="' + P + '/#safe">' + L.esc(t("i.safely")) + "</a></p>" +
      "</div></article>" +
    (more.length ? '<section class="more"><h2>' + L.esc(t("i.more", { cat: cn(it.cat) })) + '</h2><div class="grid">' + more.map((m) => L.miniCard(m, null, lang)).join("") +
      '</div><p><a class="btn ghost" href="' + catPath + '">' + L.esc(t("i.all", { cat: cn(it.cat) })) + "</a></p></section>" : "");

  // The link preview is a card drawn for this listing (api/og.js): previews can't use an NFT's
  // on-chain SVG or most IPFS links directly. The version changes whenever what it shows does, so
  // services that cache previews fetch the new one.
  const v = require("crypto").createHash("sha1").update([it.title, want, it.status, (it.photos || [])[0] || "", it.asset_contract || "", it.asset_token_id || "", prof && prof.name || ""].join("|")).digest("hex").slice(0, 10);
  L.send(res, 200, L.page({
    lang, path, title: t("i.title", { title: L.clip(it.title, 70) }) + " | Dot Trading Post", ogTitle: t("i.title", { title: it.title }), desc,
    image: L.SITE + "/og/item/" + id + ".png?v=" + v, imageSize: [1200, 630], imageAlt: it.title, noindex: !open, ld, body,
  }));
};
