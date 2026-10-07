// Dot Trading Post — ways to trade: /trade lists them, /trade/<page> explains one. Each page answers
// what someone searching for it wants to know (how the swap works, what keeps it safe), then shows
// what is up for trade right now, so it is never a page of words with nothing behind it.

const L = require("./_lib.js");

const TEXT = require("./_trade_text.js");

// What each page shows from the board; its words are in _trade_text.js, one block per language.
const PAGES = {
  "nfts-for-physical-items": { cats: ["NFTs"], also: ["Trading Cards", "Consoles & Retro", "Video Games", "Collectibles"] },
  "nft-swap-cross-chain": { cats: ["NFTs"] },
  "pokemon-cards": { cats: ["Trading Cards"], terms: ["pokemon"] },
  "video-games": { cats: ["Video Games", "Consoles & Retro"] },
  "retro-consoles": { cats: ["Consoles & Retro"], also: ["Video Games"] },
  "barter-online": { cats: null },
};
const ORDER = ["nfts-for-physical-items", "nft-swap-cross-chain", "pokemon-cards", "video-games", "retro-consoles", "barter-online"];

const steps = (list) => '<ol class="steps3">' + list.map((s, i) => '<li><span class="n">' + (i + 1) + "</span><b>" + L.esc(s[0]) + "</b><p>" + L.esc(s[1]) + "</p></li>").join("") + "</ol>";
const others = (slug, T, P) => '<section class="more"><h2>' + L.esc(T.ui.more) + '</h2><div class="cats">' +
  ORDER.filter((s) => s !== slug).map((s) => '<a class="catlink" href="' + P + "/trade/" + s + '">' + L.esc(T.pages[s].short) + "</a>").join("") +
  '<a class="catlink" href="' + P + '/c">' + L.esc(T.ui.all) + "</a></div></section>";

async function listings(p) {
  const q = "items?select=*&status=eq.open&order=created_at.desc&limit=12";
  const get = (extra) => L.rest(q + extra).catch(() => []);
  const inCats = (cats) => "&cat=in.(" + cats.map((c) => '"' + encodeURIComponent(c) + '"').join(",") + ")";
  let rows = await get(p.cats ? inCats(p.cats) + (p.terms ? "&have_terms=cs.{" + p.terms.join(",") + "}" : "") : "");
  if (rows.length < 12 && p.also) rows = rows.concat((await get(inCats(p.also))).slice(0, 12 - rows.length));
  return rows;
}

module.exports = async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const slug = String(q.page || "").toLowerCase();
  const lang = L.I.langOf(q), P = L.I.prefix(lang), T = TEXT[lang], E = L.esc;

  if (!slug) {
    const body = '<section class="head"><h1>' + E(T.ui.indexH1) + '</h1><p class="lede">' + E(T.ui.indexLede) + "</p></section>" +
      '<div class="ways">' + ORDER.map((s) => '<a class="way" href="' + P + "/trade/" + s + '"><b>' + E(T.pages[s].h1) + "</b><span>" + E(T.pages[s].desc) + "</span></a>").join("") + "</div>" +
      '<section class="more"><h2>' + E(T.ui.indexHow) + "</h2>" + steps(T.steps) + "</section>";
    return L.send(res, 200, L.page({ lang, path: "/trade", title: T.ui.indexTitle, desc: T.ui.indexDesc, body,
      ld: [{ "@context": "https://schema.org", "@type": "ItemList", itemListElement: ORDER.map((s, i) => ({ "@type": "ListItem", position: i + 1, url: L.SITE + P + "/trade/" + s, name: T.pages[s].h1 })) }] }), 3600);
  }

  const p = PAGES[slug], w = p && T.pages[slug];
  if (!p) return L.notFound(res, L.I.t(lang, "nf.page"), lang);
  const rows = await listings(p);
  const path = "/trade/" + slug;
  const board = L.appHref(lang, p.cats && p.cats.length === 1 ? "#cat=" + encodeURIComponent(p.cats[0]) : "");
  const body =
    '<nav class="crumbs" aria-label="Breadcrumb"><a href="' + P + '/">' + E(L.I.t(lang, "crumb.home")) + '</a> <span aria-hidden="true">›</span> <a href="' + P + '/trade">' + E(T.ui.crumb) + "</a></nav>" +
    '<section class="head"><h1>' + E(w.h1) + '</h1><p class="lede">' + E(w.lede) + "</p>" +
      '<div class="acts"><a class="btn" href="' + L.appHref(lang, "#post") + '">' + E(T.ui.list) + '</a><a class="btn ghost" href="' + board + '">' + E(T.ui.board) + "</a></div></section>" +
    '<section class="more"><h2>' + E(T.ui.how) + "</h2>" + steps(T.steps) + "</section>" +
    w.sections.map((s) => '<section class="more prose"><h2>' + E(s[0]) + "</h2>" + s[1] + "</section>").join("") +
    '<section class="more"><h2>' + E(T.ui.safe) + '</h2><ul class="safe3">' + T.safe.map((s) => "<li><b>" + E(s[0]) + "</b> " + E(s[1]) + "</li>").join("") + "</ul></section>" +
    '<section class="more"><h2>' + E(rows.length ? T.ui.now : T.ui.first) + "</h2>" +
      (rows.length ? '<div class="grid">' + rows.map((m) => L.miniCard(m, null, lang)).join("") + "</div>" : '<p class="lede">' + E(T.ui.empty) + "</p>") + "</section>" +
    '<section class="more faq"><h2>' + E(T.ui.faq) + "</h2>" + w.faq.map((f) => "<details><summary>" + E(f[0]) + "</summary><p>" + E(f[1]) + "</p></details>").join("") + "</section>" +
    '<section class="cta"><h2>' + E(T.ui.ready) + '</h2><p class="lede">' + E(T.ui.readyLede) + '</p><a class="btn" href="' + L.appHref(lang, "#post") + '">' + E(T.ui.start) + "</a></section>" +
    others(slug, T, P);
  const ld = [
    { "@context": "https://schema.org", "@type": "WebPage", name: w.h1, url: L.SITE + P + path, description: w.desc, inLanguage: L.I.META[lang].hreflang,
      isPartOf: { "@type": "WebSite", name: "Dot Trading Post", url: L.SITE + "/" } },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: w.faq.map((f) => ({ "@type": "Question", name: f[0], acceptedAnswer: { "@type": "Answer", text: f[1] } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Dot Trading Post", item: L.SITE + P + "/" },
      { "@type": "ListItem", position: 2, name: T.ui.crumb, item: L.SITE + P + "/trade" },
      { "@type": "ListItem", position: 3, name: w.h1, item: L.SITE + P + path } ] },
  ];
  L.send(res, 200, L.page({ lang, path, title: w.title + " | Dot Trading Post", ogTitle: w.title, desc: w.desc, ld, body }), 600);
};
module.exports.PAGES = PAGES;
module.exports.ORDER = ORDER;
module.exports.TEXT = TEXT;
