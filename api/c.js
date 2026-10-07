// Dot Trading Post — category pages: /c/<category> lists what is up for trade in it, /c lists the
// categories. Plain links all the way down, so a search engine can reach every open listing.

const L = require("./_lib.js");
const PER = 48;

module.exports = async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const s = String(q.cat || "").toLowerCase();
  const lang = L.I.langOf(q), P = L.I.prefix(lang), t = (k, v) => L.I.t(lang, k, v), cn = (c) => L.I.catName(lang, c);
  const pageNo = Math.max(1, Math.min(200, parseInt(q.page, 10) || 1));

  if (!s) {
    let rows = [];
    try { rows = await L.rest("items?select=cat&status=eq.open&limit=10000"); } catch (e) { rows = []; }
    const n = {}; rows.forEach((r) => { n[r.cat] = (n[r.cat] || 0) + 1; });
    const body = '<section class="head"><h1>' + L.esc(t("c.allH1")) + '</h1><p class="lede">' + L.esc(t("c.allLede")) + "</p></section>" +
      L.GROUPS.map((g) => '<section class="group"><h2>' + L.esc(L.I.groupName(lang, g[0])) + '</h2><div class="cats">' +
        g[1].map((c) => '<a class="catlink" href="' + P + "/c/" + L.slug(c) + '" style="--c:' + L.hueOf(c) + '">' + L.esc(cn(c)) + (n[c] ? " <b>" + n[c] + "</b>" : "") + "</a>").join("") +
        "</div></section>").join("");
    return L.send(res, 200, L.page({ lang, path: "/c", title: t("c.allTitle"), desc: t("c.allDesc"), body }), 300);
  }

  const cat = L.catBySlug(s);
  if (!cat) return L.notFound(res, t("nf.category"), lang);

  let rows;
  try {
    rows = await L.rest("items?select=*&status=eq.open&cat=eq." + encodeURIComponent(cat) +
      "&order=created_at.desc&limit=" + (PER + 1) + "&offset=" + (pageNo - 1) * PER);
  } catch (e) { rows = []; }
  const next = rows.length > PER; rows = rows.slice(0, PER);
  const path = "/c/" + s + (pageNo > 1 ? "?page=" + pageNo : "");
  const lower = cat === "Other" ? t("c.other") : cn(cat), base = P + "/c/" + s;

  const body =
    '<nav class="crumbs" aria-label="Breadcrumb"><a href="' + P + '/">' + L.esc(t("crumb.home")) + '</a> <span aria-hidden="true">›</span> <a href="' + P + '/c">' + L.esc(t("crumb.all")) + "</a></nav>" +
    '<section class="head" style="--c:' + L.hueOf(cat) + '"><h1>' + L.esc(t("c.h1", { cat: cn(cat) })) + "</h1>" +
      '<p class="lede">' + (cat === "NFTs" ? L.esc(t("c.nftLede", { n: Object.keys(L.CHAINS).length })) : "") + L.esc(rows.length ? t("c.lede") : t("c.empty", { cat: lower })) + "</p>" +
      '<p><a class="btn" href="' + L.appHref(lang, "#cat=" + encodeURIComponent(cat)) + '">' + L.esc(rows.length ? t("c.open") : t("c.list")) + "</a></p></section>" +
    (rows.length ? '<div class="grid">' + rows.map((m) => L.miniCard(m, null, lang)).join("") + "</div>" : "") +
    (pageNo > 1 || next ? '<nav class="pager" aria-label="Pages">' +
      (pageNo > 1 ? '<a class="btn ghost" rel="prev" href="' + base + (pageNo > 2 ? "?page=" + (pageNo - 1) : "") + '">' + L.esc(t("c.newer")) + "</a>" : "") +
      (next ? '<a class="btn ghost" rel="next" href="' + base + "?page=" + (pageNo + 1) + '">' + L.esc(t("c.older")) + "</a>" : "") + "</nav>" : "");

  const ld = [
    { "@context": "https://schema.org", "@type": "CollectionPage", name: t("c.h1", { cat: cn(cat) }), url: L.SITE + P + path, inLanguage: L.I.META[lang].hreflang,
      mainEntity: { "@type": "ItemList", itemListElement: rows.map((m, i) => ({ "@type": "ListItem", position: (pageNo - 1) * PER + i + 1, url: L.SITE + P + L.itemPath(m), name: m.title })) } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Dot Trading Post", item: L.SITE + P + "/" },
      { "@type": "ListItem", position: 2, name: cn(cat), item: L.SITE + base } ] },
  ];
  L.send(res, 200, L.page({
    lang, path, title: t("c.title", { cat: cn(cat) }),
    desc: L.clip((cat === "NFTs" ? t("c.descNft") : t("c.desc", { cat: lower })) + (rows.length ? t("c.descN", { n: rows.length + (next ? "+" : "") }) : "") + t("c.descEnd"), 158),
    image: (rows.find((m) => m.photos && m.photos.length) || { photos: [null] }).photos[0],
    noindex: !rows.length, ld, body,
  }), 300);
};
