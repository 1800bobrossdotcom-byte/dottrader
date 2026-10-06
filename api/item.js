// Dot Trading Post — one listing's own page: /item/<id>
//
// What a shared link opens, what a search engine indexes, and what an email notification points
// at. It shows the listing, who listed it and what they want, with one button into the board to
// make an offer. Listings that are taken down answer 404; finished ones stay readable but ask
// search engines not to list them.

const L = require("./_lib.js");
const nft = require("./nft.js");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KIND = { erc721: "NFT", erc1155: "Multi-edition NFT", erc20: "Tokens" };

// Artwork for a digital listing with no photo of its own — but a link preview won't wait long.
function artOf(it) {
  if (!it.asset_kind || it.asset_kind === "erc20" || !nft.validToken(Number(it.asset_chain), String(it.asset_contract), String(it.asset_token_id), it.asset_kind)) return Promise.resolve(null);
  return Promise.race([
    nft.lookup(Number(it.asset_chain), it.asset_contract, String(it.asset_token_id), it.asset_kind).catch(() => null),
    new Promise((r) => setTimeout(() => r(null), 3500)),
  ]);
}

function assetLine(it) {
  if (!it.asset_kind) return "";
  const c = L.CHAINS[it.asset_chain] || ["Chain " + it.asset_chain, null];
  const addr = String(it.asset_contract || "");
  const short = addr.slice(0, 6) + "…" + addr.slice(-4);
  const path = it.asset_kind === "erc20" ? "/token/" + addr : "/nft/" + addr + "/" + it.asset_token_id;
  return '<p class="asset"><span class="tag">' + L.esc(KIND[it.asset_kind] || "Digital") + " on " + L.esc(c[0]) + "</span> " +
    (c[1] ? '<a href="' + L.esc(c[1] + path) + '" rel="nofollow noopener" target="_blank">' : "") + L.esc(short) +
    (it.asset_kind !== "erc20" ? " #" + L.esc(L.clip(it.asset_token_id, 24)) : "") + (c[1] ? "</a>" : "") +
    ' <span class="fine">— the board checks on chain that the lister still holds it</span></p>';
}

module.exports = async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  // /item/<words>-<uuid> or the older /item/<uuid>: only the id at the end counts.
  const asked = String(q.id || "").toLowerCase();
  const id = (asked.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/) || [])[1] || "";
  if (!UUID.test(id)) return L.notFound(res, "No such listing");

  let it;
  try { it = (await L.rest("items?select=*&id=eq." + id))[0]; } catch (e) { return L.send(res, 503, L.page({ path: "/", title: "Dot Trading Post", desc: "", noindex: true, body: '<section class="empty"><h1>The board is busy</h1><p>Try again in a moment.</p></section>' })); }
  if (!it || it.status === "removed") return L.notFound(res, it ? "This listing was taken down" : "No such listing");

  const [prof, badge, more, art, done] = await Promise.all([
    L.rest("profiles?select=id,name,area&id=eq." + it.owner_id).then((r) => r[0] || null, () => null),
    L.rest("verification_badges?select=verified_at,summary&status=eq.verified&item_id=eq." + id).then((r) => r[0] || null, () => null),
    L.rest("items?select=*&status=eq.open&cat=eq." + encodeURIComponent(it.cat) + "&id=neq." + id + "&order=created_at.desc&limit=6").catch(() => []),
    it.photos && it.photos.length ? Promise.resolve(null) : artOf(it),
    it.status === "traded" ? L.rest("trade_history?select=give,from_id,done_at&item_id=eq." + id).then((r) => r[0] || null, () => null) : Promise.resolve(null),
  ]);
  const doneWith = done ? await L.rest("profiles?select=name&id=eq." + done.from_id).then((r) => (r[0] && r[0].name) || "another trader", () => "another trader") : null;

  const photos = (it.photos || []).slice(0, 4);
  const pics = photos.length ? photos : art && art.image ? [art.image] : [];
  const name = (prof && prof.name) || "A trader";
  const want = L.wantText(it);
  const open = it.status === "open";
  const state = open ? ["On the board", ""] : it.status === "pledged" ? ["Agreed — awaiting delivery", "hold"] : ["Traded", "ok"];
  const path = L.itemPath(it);
  // Any other spelling of the address (an old link, an edited title) goes to the current one.
  if ("/item/" + asked !== path) { res.statusCode = 301; res.setHeader("location", path); res.setHeader("cache-control", "public, s-maxage=300"); return res.end(); }
  const catPath = "/c/" + L.slug(it.cat);

  const desc = L.clip("Up for trade: " + it.title + ". " + (want === "Open to offers" ? "Open to offers." : "Wants " + want.replace(/^Any /, "any ") + ".") + (it.descr ? " " + it.descr : ""), 158);
  const ld = [
    {
      "@context": "https://schema.org", "@type": "Product", name: it.title, description: it.descr || desc,
      category: it.cat, url: L.SITE + path, ...(pics.length ? { image: pics } : {}),
    },
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Dot Trading Post", item: L.SITE + "/" },
        { "@type": "ListItem", position: 2, name: it.cat, item: L.SITE + catPath },
        { "@type": "ListItem", position: 3, name: it.title, item: L.SITE + path },
      ],
    },
  ];

  const body =
    '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span> <a href="' + catPath + '">' + L.esc(it.cat) + "</a></nav>" +
    '<article class="listing" style="--c:' + L.hueOf(it.cat) + '">' +
      '<div class="media">' + (pics.length
        ? '<div class="pics' + (pics.length > 1 ? " many" : "") + '" tabindex="0" aria-label="' + L.esc(it.title + " photos") + '">' +
            pics.map((u, i) => '<img src="' + L.esc(u) + '" alt="' + L.esc(it.title + (pics.length > 1 ? " — photo " + (i + 1) + " of " + pics.length : "")) + '"' + (i ? ' loading="lazy"' : "") + ">").join("") +
          "</div>" + (pics.length > 1 ? '<p class="fine swipe">Swipe for ' + (pics.length - 1) + " more " + (pics.length === 2 ? "photo" : "photos") + "</p>" : "")
        : '<div class="pics none" aria-hidden="true"><span>' + L.esc(it.title.charAt(0).toUpperCase()) + "</span></div>") + "</div>" +
      '<div class="info">' +
        '<p class="state"><span class="tag ' + state[1] + '">' + state[0] + '</span> <a class="tag cat" href="' + catPath + '">' + L.esc(it.cat) + "</a>" +
          (it.local_only ? ' <span class="tag local" title="No shipping — handed over in person">Local pickup only</span>' : "") +
          (badge ? ' <span class="tag proof" title="The lister photographed this item next to a handwritten note with a one-time code."><s></s>Proof of item</span>' : "") + "</p>" +
        "<h1>" + L.esc(it.title) + "</h1>" +
        '<div class="sides"><div class="side h"><span class="k">Offering</span><span class="v">' + L.esc(it.title) + '</span></div><div class="arrow" aria-hidden="true"></div>' +
          '<div class="side w"><span class="k">Wants</span><span class="v">' + L.esc(want) + "</span></div></div>" +
        (it.descr ? '<p class="desc">' + L.esc(it.descr) + "</p>" : "") +
        assetLine(it) +
        (done ? '<p class="traded">Traded for <b>' + L.esc(done.give) + "</b> with <b>" + L.esc(doneWith) + "</b> · " +
          new Date(done.done_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + "</p>" : "") +
        '<p class="by">Listed by <b>' + L.esc(name) + "</b>" + (prof && prof.area ? " · " + L.esc(prof.area) : "") +
          ' · <time datetime="' + L.esc(it.created_at) + '">' + new Date(it.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + "</time></p>" +
        '<div class="acts">' +
          (open ? '<a class="btn" href="/app#item=' + id + '">Make an offer</a>' : '<a class="btn" href="/app#cat=' + encodeURIComponent(it.cat) + '">See what else is up for trade</a>') +
          '<button class="btn ghost" type="button" data-share hidden>Share</button></div>' +
        '<p class="fine">No money changes hands here — it’s a swap. Offers, messages and the trade itself happen on the board, where every trader’s record of trades, no-shows and vouches is on their cards. <a href="/#safe">Trading safely</a></p>' +
      "</div></article>" +
    (more.length ? '<section class="more"><h2>More ' + L.esc(it.cat) + ' up for trade</h2><div class="grid">' + more.map((m) => L.miniCard(m)).join("") +
      '</div><p><a class="btn ghost" href="' + catPath + '">All ' + L.esc(it.cat) + "</a></p></section>" : "");

  L.send(res, 200, L.page({
    path, title: L.clip(it.title, 70) + " — up for trade | Dot Trading Post", ogTitle: it.title + " — up for trade", desc,
    image: pics[0] || null, imageAlt: it.title, noindex: !open, ld, body,
  }));
};
