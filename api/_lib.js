// Dot Trading Post — shared pieces for the public pages (listings, categories, sitemap).
//
// These pages are rendered on the server so that search engines and link previews (iMessage,
// WhatsApp, Discord, X…) see a real title, description and photo for every listing. They read the
// database with the public anon key, exactly as any visitor's browser does: row-level security
// decides what is visible, and nothing here can see more than a stranger could.
//
// Files starting with an underscore are not served by Vercel; this one is only required.

const SB_URL = (process.env.SUPABASE_URL || "https://yujxwfghmauajrpduagl.supabase.co").replace(/\/$/, "");
// The anon/publishable key is public by design — it is in site/config.js too.
const SB_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_3bOvzS08UOQsu1376idqDg_XHPmOgfp";
const SITE = (process.env.SITE_URL || "https://www.dottrader.app").replace(/\/$/, "");

async function rest(path) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { headers: { apikey: SB_KEY, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) { const e = new Error("rest " + r.status); e.status = r.status; throw e; }
  return r.json();
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// JSON inside a <script> block: "</script>" and friends must not end it early.
function jsonLd(o) { return JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026"); }
function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; }

const I = require("./_i18n.js");

// Kept in step with GROUPS in site/js/core.js.
const GROUPS = [
  ["Collectables", ["Trading Cards", "NFTs", "Comics", "Collectibles", "Coins & Stamps", "Memorabilia", "Antiques"]],
  ["Games & Tech", ["Video Games", "Consoles & Retro", "Computers", "Phones", "Electronics", "Cameras", "Audio & Hi-Fi"]],
  ["Media", ["Books", "Music & Vinyl", "Film & TV", "Board Games & Puzzles"]],
  ["Home", ["Furniture", "Home & Kitchen", "Tools & DIY", "Garden", "Appliances"]],
  ["Wearables", ["Clothing", "Shoes & Trainers", "Watches", "Jewellery", "Bags", "Beauty"]],
  ["Sport & Outdoors", ["Sports Gear", "Bikes", "Camping & Outdoors", "Fitness"]],
  ["Hobbies", ["Musical Instruments", "Art", "Craft & Sewing", "Models & Hobby", "Toys & Figures"]],
  ["Vehicles", ["Cars & Parts", "Motorbikes"]],
  ["Everything else", ["Baby & Kids", "Pet Supplies", "Office", "Industrial", "Tickets", "Services & Skills", "Other"]],
];
const HUES = ["var(--pink)", "var(--blue)", "var(--purple)", "var(--red)", "var(--cyan)", "var(--green)", "var(--yellow)", "#6B7280", "var(--faint)"];
const CATS = [].concat(...GROUPS.map((g) => g[1]));
function slug(cat) { return String(cat).toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
// A listing's address: its title as words, then its id — /item/charizard-holo-1999-<uuid>. Only
// the id is ever looked up, so a title edit can't break a link; the words are for people and search.
const ACC = "áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçýÿ", PLAIN = "aaaaaaaeeeeeiiiiiooooooouuuuuncyy";
function titleSlug(t) {
  let s = String(t || "").toLowerCase().replace(/[^\x00-\x7f]/g, (c) => { const i = ACC.indexOf(c); return i < 0 ? " " : PLAIN[i]; });
  s = s.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length > 60) s = s.slice(0, 60).replace(/-[^-]*$/, "");
  return s;
}
function itemPath(it) { const w = titleSlug(it.title); return "/item/" + (w ? w + "-" : "") + it.id; }
function catBySlug(s) { return CATS.find((c) => slug(c) === s) || null; }
function hueOf(cat) { const i = GROUPS.findIndex((g) => g[1].includes(cat)); return i < 0 ? "var(--faint)" : HUES[i]; }

const CHAINS = {
  1: ["Ethereum", "https://etherscan.io"], 8453: ["Base", "https://basescan.org"], 42161: ["Arbitrum", "https://arbiscan.io"],
  10: ["Optimism", "https://optimistic.etherscan.io"], 137: ["Polygon", "https://polygonscan.com"], 56: ["BNB Chain", "https://bscscan.com"],
  43114: ["Avalanche", "https://snowtrace.io"], 7777777: ["Zora", "https://explorer.zora.energy"],
};

function wantText(it, lang) {
  lang = lang || "en";
  const bits = [], cats = (it.want_cats || []).map((c) => I.catName(lang, c)).join(I.t(lang, "list.sep"));
  if (it.want) bits.push(it.want);
  if (cats) bits.push(I.t(lang, it.want ? "want.orAny" : "want.any", { cats }));
  if (!bits.length) return I.t(lang, "want.open");
  if (it.open_to_offers !== false && !/open to (other )?offers/i.test(it.want || "")) bits.push(I.t(lang, "want.alsoOpen"));
  return bits.join(" · ");
}

const GLOBE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.8 2.6 4.2 5.8 4.2 9.5s-1.4 6.9-4.2 9.5c-2.8-2.6-4.2-5.8-4.2-9.5S9.2 5.1 12 2.5z"/></svg>';
const LOGO = '<svg viewBox="0 0 40 40" aria-hidden="true" width="34" height="34"><path d="M9 5h11a15 15 0 0 1 0 30H9z" fill="#FFD23F" stroke="#121212" stroke-width="3" stroke-linejoin="round"/><circle cx="20" cy="20" r="5.5" fill="#E8392B" stroke="#121212" stroke-width="3"/></svg>';

// The whole page around a body. `path` is the page's address in English (/c/nfts); in another
// language it lives under that language's prefix (/es/c/nfts), and every language's address is
// listed for search engines. `noindex` for pages that should be reachable but not listed.
function page(o) {
  const lang = o.lang || "en", P = I.prefix(lang), tt = (k) => I.t(lang, k);
  const url = SITE + P + o.path;
  const image = o.image || SITE + "/og.png?v=5";
  const langLinks = I.LANGS.map((l) => '<a href="' + esc(I.prefix(l) + (o.noindex ? "/" : o.path)) + '" hreflang="' + I.META[l].hreflang + '" lang="' + I.META[l].hreflang + '"' +
    (l === lang ? ' aria-current="true"' : "") + ">" + esc(I.META[l].name) + "</a>").join("");
  return '<!doctype html>\n<html lang="' + I.META[lang].hreflang + '">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    "<title>" + esc(o.title) + "</title>\n" +
    '<meta name="description" content="' + esc(o.desc) + '">\n' +
    (o.noindex ? '<meta name="robots" content="noindex">\n' : "") +
    (o.noindex ? "" : '<link rel="canonical" href="' + esc(url) + '">\n' +
      I.alternates(o.path).map((a) => '<link rel="alternate" hreflang="' + a.lang + '" href="' + esc(SITE + a.href) + '">\n').join("") +
      '<link rel="alternate" hreflang="x-default" href="' + esc(SITE + o.path) + '">\n') +
    '<link rel="icon" href="/favicon.ico?v=5" sizes="48x48">\n<link rel="icon" href="/favicon.svg?v=5" type="image/svg+xml">\n' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=5">\n<link rel="manifest" href="/manifest.webmanifest?v=5">\n' +
    '<meta property="og:site_name" content="Dot Trading Post">\n' +
    '<meta property="og:locale" content="' + I.META[lang].og + '">\n' +
    '<meta property="og:type" content="' + (o.ogType || "website") + '">\n' +
    '<meta property="og:title" content="' + esc(o.ogTitle || o.title) + '">\n' +
    '<meta property="og:description" content="' + esc(o.desc) + '">\n' +
    '<meta property="og:url" content="' + esc(url) + '">\n' +
    '<meta property="og:image" content="' + esc(image) + '">\n' +
    (o.imageSize ? '<meta property="og:image:width" content="' + o.imageSize[0] + '">\n<meta property="og:image:height" content="' + o.imageSize[1] + '">\n' : "") +
    (o.imageAlt ? '<meta property="og:image:alt" content="' + esc(o.imageAlt) + '">\n' : "") +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + esc(o.ogTitle || o.title) + '">\n' +
    '<meta name="twitter:description" content="' + esc(o.desc) + '">\n' +
    '<meta name="twitter:image" content="' + esc(image) + '">\n' +
    '<meta name="theme-color" content="#F3EAD3">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">\n' +
    '<link rel="stylesheet" href="/css/page.css?v=7">\n' +
    (o.ld || []).map((x) => '<script type="application/ld+json">' + jsonLd(x) + "</script>\n").join("") +
    "</head>\n<body>\n" +
    '<header class="top"><div class="wrap bar"><a class="brand" href="' + (P || "") + '/">' + LOGO + '<span class="t">Dot Trading Post<small>' + esc(tt("brand.small")) + "</small></span></a>" +
    '<details class="langmenu"><summary aria-label="' + esc(tt("foot.lang")) + '">' + GLOBE + '<span class="lm-cur">' + esc(I.META[lang].name) + '</span></summary><div class="lm-list">' + langLinks + "</div></details>" +
    '<a class="navbtn" href="' + appHref(lang) + '">' + esc(tt("nav.board")) + "</a></div></header>\n" +
    '<main class="wrap">\n' + o.body + "\n</main>\n" +
    '<footer class="wrap foot"><a href="' + (P || "") + '/">' + esc(tt("foot.how")) + '</a><a href="' + appHref(lang) + '">' + esc(tt("foot.board")) + "</a>" +
      ["Trading Cards", "Video Games", "Consoles & Retro", "NFTs"].map((c) => '<a href="' + P + "/c/" + slug(c) + '">' + esc(I.catName(lang, c)) + "</a>").join("") +
      '<a href="' + P + '/trade">' + esc(tt("foot.ways")) + '</a><a href="/stickers">' + esc(tt("foot.stickers")) + "</a>" +
      '<a class="makers" href="https://cbuy.ing" target="_blank" rel="noopener"><span>' + esc(tt("foot.makers")) + '</span><img src="/cbuy.png?v=1" alt="cbuy" width="75" height="32"></a>' +
      '<nav class="langs" aria-label="' + esc(tt("foot.lang")) + '">' + langLinks + "</nav>" + '<p class="site-stats" id="siteStats" aria-live="polite" hidden></p></footer>\n' +
    '<script src="/js/share.js?v=5" defer></script>\n</body>\n</html>\n';
}
// The board in a language: it reads ?lang= on arrival and remembers it.
function appHref(lang, hash) { return "/app" + (lang && lang !== "en" ? "?lang=" + lang : "") + (hash || ""); }

function send(res, status, html, maxAge) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  // Short at the edge so a new or changed listing shows up quickly; serve stale while refreshing.
  res.setHeader("cache-control", status === 200 ? "public, s-maxage=" + (maxAge || 120) + ", stale-while-revalidate=86400" : "public, s-maxage=60");
  res.end(html);
}

function notFound(res, what, lang) {
  lang = lang || "en";
  send(res, 404, page({
    lang, path: "/", title: I.t(lang, "nf.title"), desc: I.t(lang, "nf.desc"), noindex: true,
    body: '<section class="empty"><h1>' + esc(what || I.t(lang, "nf.nothing")) + "</h1><p>" + esc(I.t(lang, "nf.gone")) + '</p><p><a class="btn" href="' + appHref(lang) + '">' + esc(I.t(lang, "nf.see")) + "</a></p></section>",
  }));
}

// A small card linking to a listing's own page, used on category pages and under a listing.
function miniCard(it, img, lang) {
  lang = lang || "en";
  const photo = img || (it.photos && it.photos[0]);
  const art = !photo && it.asset_kind && it.asset_kind !== "erc20";
  const pic = photo ? '<img src="' + esc(photo) + '" alt="' + esc(it.title) + '" loading="lazy">'
    : art ? '<img src="/og/art/' + esc(it.id) + '.png" alt="' + esc(it.title) + '" loading="lazy" data-art>'
    : '<span class="noimg" aria-hidden="true"></span>';
  return '<a class="mini" href="' + esc(I.prefix(lang) + itemPath(it)) + '" style="--c:' + hueOf(it.cat) + '">' + pic +
    '<span class="mt">' + esc(it.title) + (it.local_only ? ' <span class="tag local">' + esc(I.t(lang, "mini.local")) + "</span>" : "") + '</span><span class="mw"><b>' + esc(I.t(lang, "mini.wants")) + "</b> " + esc(wantText(it, lang)) + "</span></a>";
}

module.exports = { I, appHref, titleSlug, itemPath, SB_URL, SB_KEY, SITE, rest, esc, jsonLd, clip, GROUPS, CATS, slug, catBySlug, hueOf, CHAINS, wantText, page, send, notFound, miniCard };
