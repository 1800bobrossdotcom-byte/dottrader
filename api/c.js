// Dot Trading Post — category pages: /c/<category> lists what is up for trade in it, /c lists the
// categories. Plain links all the way down, so a search engine can reach every open listing.

const L = require("./_lib.js");
const PER = 48;

module.exports = async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const s = String(q.cat || "").toLowerCase();
  const pageNo = Math.max(1, Math.min(200, parseInt(q.page, 10) || 1));

  if (!s) {
    let rows = [];
    try { rows = await L.rest("items?select=cat&status=eq.open&limit=10000"); } catch (e) { rows = []; }
    const n = {}; rows.forEach((r) => { n[r.cat] = (n[r.cat] || 0) + 1; });
    const body = '<section class="head"><h1>Everything up for trade</h1><p class="lede">Swap what you have for what you want. Pick a corner of the board.</p></section>' +
      L.GROUPS.map((g) => '<section class="group"><h2>' + L.esc(g[0]) + '</h2><div class="cats">' +
        g[1].map((c) => '<a class="catlink" href="/c/' + L.slug(c) + '" style="--c:' + L.hueOf(c) + '">' + L.esc(c) + (n[c] ? " <b>" + n[c] + "</b>" : "") + "</a>").join("") +
        "</div></section>").join("");
    return L.send(res, 200, L.page({ path: "/c", title: "Everything up for trade — Dot Trading Post", desc: "Browse what people are swapping on Dot Trading Post: trading cards, video games, retro consoles, collectibles and more. No money — just trades.", body }), 300);
  }

  const cat = L.catBySlug(s);
  if (!cat) return L.notFound(res, "No such category");

  let rows;
  try {
    rows = await L.rest("items?select=*&status=eq.open&cat=eq." + encodeURIComponent(cat) +
      "&order=created_at.desc&limit=" + (PER + 1) + "&offset=" + (pageNo - 1) * PER);
  } catch (e) { rows = []; }
  const next = rows.length > PER; rows = rows.slice(0, PER);
  const path = "/c/" + s + (pageNo > 1 ? "?page=" + pageNo : "");
  const lower = cat === "Other" ? "other things" : cat;

  const body =
    '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span> <a href="/c">All categories</a></nav>' +
    '<section class="head" style="--c:' + L.hueOf(cat) + '"><h1>' + L.esc(cat) + ' up for trade</h1>' +
      '<p class="lede">' + (cat === "NFTs" ? "Swap NFTs across " + Object.keys(L.CHAINS).length + " chains, or for physical things. No bridge: each side sends on its own chain and the board checks both. " : "") + (rows.length ? "Swap for them — no money, just trades. Each listing says what its owner wants." : "Nothing in " + L.esc(lower) + " right now. Be the first: list something and say what you want for it.") + "</p>" +
      '<p><a class="btn" href="/app#cat=' + encodeURIComponent(cat) + '">' + (rows.length ? "Open these on the board" : "List something") + "</a></p></section>" +
    (rows.length ? '<div class="grid">' + rows.map((m) => L.miniCard(m)).join("") + "</div>" : "") +
    (pageNo > 1 || next ? '<nav class="pager" aria-label="Pages">' +
      (pageNo > 1 ? '<a class="btn ghost" rel="prev" href="/c/' + s + (pageNo > 2 ? "?page=" + (pageNo - 1) : "") + '">Newer</a>' : "") +
      (next ? '<a class="btn ghost" rel="next" href="/c/' + s + "?page=" + (pageNo + 1) + '">Older</a>' : "") + "</nav>" : "");

  const ld = [
    { "@context": "https://schema.org", "@type": "CollectionPage", name: cat + " up for trade", url: L.SITE + path,
      mainEntity: { "@type": "ItemList", itemListElement: rows.map((m, i) => ({ "@type": "ListItem", position: (pageNo - 1) * PER + i + 1, url: L.SITE + L.itemPath(m), name: m.title })) } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Dot Trading Post", item: L.SITE + "/" },
      { "@type": "ListItem", position: 2, name: cat, item: L.SITE + "/c/" + s } ] },
  ];
  L.send(res, 200, L.page({
    path, title: cat + " up for trade — swap, don't sell | Dot Trading Post",
    desc: L.clip((cat === "NFTs" ? "Swap NFTs across chains, or for physical things — no bridge, no money; every NFT transfer is checked on chain. "
      : "Trade " + lower + " with people near you or by post. ") + (rows.length ? rows.length + (next ? "+" : "") + " listings, each saying what its owner wants in return. " : "") + "No money — just swaps, and a trade record on every trader.", 158),
    image: (rows.find((m) => m.photos && m.photos.length) || { photos: [null] }).photos[0],
    noindex: !rows.length, ld, body,
  }), 300);
};
