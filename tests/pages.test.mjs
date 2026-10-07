// Tests for the public pages (api/item.js, api/c.js, api/sitemap.js) with the database faked.
// Run: node tests/pages.test.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const A = "11111111-1111-4111-8111-111111111111";
const I1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", I2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", I3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", I4 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", I5 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const items = [
  { id: I1, owner_id: A, title: 'Charizard <script>alert(1)</script> holo', descr: "Base set, \"near mint\".\nNo trades for cash.", want: "N64 games", want_cats: ["Consoles & Retro"], open_to_offers: true, cat: "Trading Cards", status: "open", photos: ["https://x.supabase.co/storage/v1/object/public/photos/a/1.jpg", "https://x.supabase.co/storage/v1/object/public/photos/a/2.jpg"], created_at: "2026-10-01T10:00:00Z" },
  { id: I2, owner_id: A, title: "Pikachu promo", descr: "", want: "", want_cats: [], open_to_offers: true, cat: "Trading Cards", status: "open", photos: [], created_at: "2026-10-02T10:00:00Z" },
  { id: I3, owner_id: A, title: "Old lamp", descr: "", want: "", cat: "Home & Kitchen", status: "traded", photos: [], created_at: "2026-09-01T10:00:00Z" },
  { id: I5, owner_id: A, title: "Wiiide #8240", descr: "", want: "", want_cats: [], cat: "NFTs", status: "open", photos: [], created_at: "2026-10-03T10:00:00Z",
    asset_kind: "erc721", asset_chain: 1, asset_contract: "0x72a94e6c51cb06453b84c049ce1e1312f7c05e2c", asset_token_id: "8240", have_terms: ["nft", "ethereum", "wiiide"] },
  { id: I4, owner_id: A, title: "Gone thing", descr: "", want: "", cat: "Other", status: "removed", photos: [], created_at: "2026-09-01T10:00:00Z" },
];
const seen = [];
globalThis.fetch = async (url) => {
  url = String(url); seen.push(url);
  const u = new URL(url), t = u.pathname.split("/").pop(), p = u.searchParams;
  let rows = [];
  if (t === "items") {
    rows = items.filter((it) => {
      for (const [k, v] of p) {
        if (["select", "order", "limit", "offset"].includes(k)) continue;
        const [op, val] = [v.slice(0, v.indexOf(".")), v.slice(v.indexOf(".") + 1)];
        if (op === "eq" && String(it[k]) !== val) return false;
        if (op === "neq" && String(it[k]) === val) return false;
        if (op === "in" && !val.slice(1, -1).split(",").map((x) => decodeURIComponent(x.replace(/^"|"$/g, ""))).includes(String(it[k]))) return false;
        if (op === "cs" && !val.slice(1, -1).split(",").every((x) => (it[k] || []).includes(x))) return false;
      }
      return true;
    }).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const off = Number(p.get("offset") || 0), lim = Number(p.get("limit") || 1000);
    rows = rows.slice(off, off + lim);
  } else if (t === "profiles") rows = [{ id: A, name: "Alice & Co", area: "Leeds" }];
  else if (t === "trade_history") rows = p.get("item_id") === "eq." + I3 ? [{ give: "A <b>bike</b>", from_id: A, done_at: "2026-09-05T10:00:00Z" }] : [];
  else if (t === "verification_badges") rows = p.get("item_id") === "eq." + I1 ? [{ verified_at: "2026-10-02", summary: "ok" }] : [];
  return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
};

const item = require("../api/item.js"), cat = require("../api/c.js"), sitemap = require("../api/sitemap.js"), trade = require("../api/trade.js");
function call(h, query) {
  return new Promise((resolve) => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); } };
    h({ query, url: "/" }, res);
  });
}
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (c || !x ? "" : "  [" + x + "]"));
const meta = (b, prop) => (new RegExp('<meta (?:property|name)="' + prop + '" content="([^"]*)"').exec(b) || [])[1];
const lds = (b) => [...b.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

{
  const old = await call(item, { id: I1 });
  ok("an old /item/<id> link redirects to the readable address", old.status === 301 && old.headers.location === "/item/charizard-script-alert-1-script-holo-" + I1, old.headers.location);
  const r = await call(item, { id: "charizard-script-alert-1-script-holo-" + I1 });
  ok("an open listing answers 200 as HTML", r.status === 200 && /text\/html/.test(r.headers["content-type"]));
  ok("its title names the listing", /<title>Charizard &lt;script&gt;alert\(1\)&lt;\/script&gt; holo — up for trade \| Dot Trading Post<\/title>/.test(r.body), (r.body.match(/<title>.*<\/title>/) || [])[0]);
  ok("nothing the lister typed can open a tag", !/<script>alert/.test(r.body) && !/<\/script>alert/.test(r.body));
  ok("link previews use the listing's own card image, sized for X and the rest", /^https:\/\/www\.dottrader\.app\/og\/item\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\.png\?v=[0-9a-f]{10}$/.test(meta(r.body, "og:image")) && meta(r.body, "og:image:width") === "1200" && meta(r.body, "twitter:image") === meta(r.body, "og:image"), meta(r.body, "og:image"));
  ok("…and a description with what they want", /Wants N64 games · or any Consoles &amp; Retro/.test(meta(r.body, "og:description") || ""), meta(r.body, "og:description"));
  ok("search engines may index it", !/noindex/.test(r.body));
  const ld = lds(r.body);
  ok("structured data: a Product with both photos, and breadcrumbs", ld[0]["@type"] === "Product" && ld[0].image.length === 3 && /\/og\/item\/.*\.png$/.test(ld[0].image[2]) && ld[0].name === items[0].title && ld[1]["@type"] === "BreadcrumbList" && ld[1].itemListElement[1].item.endsWith("/c/trading-cards"));
  ok("structured data can't close its own script tag", !/<\/script>alert/.test(r.body.split('application/ld+json">')[1].split("</script>")[0]));
  ok("Make an offer goes into the board", r.body.includes('href="/app#item=' + I1 + '"'));
  ok("shows the owner, the proof badge, and the swipe hint", /Listed by <b>Alice &amp; Co<\/b> · Leeds/.test(r.body) && /Proof of item/.test(r.body) && /Swipe for 1 more photo</.test(r.body));
  ok("canonical is the readable address", r.body.includes('<link rel="canonical" href="https://www.dottrader.app/item/charizard-script-alert-1-script-holo-' + I1 + '">'));
  ok("more from the category, not itself", r.body.includes("/item/pikachu-promo-" + I2) && !r.body.split('class="more"')[1].split("</section>")[0].includes(I1));
  ok("cached briefly at the edge", /s-maxage=120/.test(r.headers["cache-control"]));
}
{
  const r = await call(item, { id: "old-lamp-" + I3 });
  ok("a traded listing says what it went for, safely", /Traded for <b>A &lt;b&gt;bike&lt;\/b&gt;<\/b> with <b>Alice &amp; Co<\/b> · Sep 5, 2026/.test(r.body), (r.body.match(/<p class="traded">.*?<\/p>/) || [])[0]);
  ok("a traded listing still opens, marked Traded, not indexed", r.status === 200 && /Traded</.test(r.body) && /noindex/.test(r.body) && /See what else is up for trade/.test(r.body) && !/#item=/.test(r.body));
  const g = await call(item, { id: I4 });
  ok("a taken-down listing is a 404", g.status === 404 && /taken down/.test(g.body) && /noindex/.test(g.body));
  const n = await call(item, { id: "../../etc" });
  ok("a malformed id never reaches the database", n.status === 404 && !seen.some((u) => u.includes("etc")));
}
{
  const r = await call(cat, { cat: "trading-cards" });
  ok("a category page lists its open listings", r.status === 200 && r.body.includes("-" + I1 + '"') && r.body.includes("/item/pikachu-promo-" + I2) && /<h1>Trading Cards up for trade<\/h1>/.test(r.body));
  ok("…as an ItemList", lds(r.body)[0].mainEntity.itemListElement.length === 2);
  ok("…and links into the board filtered", r.body.includes('href="/app#cat=Trading%20Cards"'));
  const e = await call(cat, { cat: "garden" });
  ok("an empty category says so and isn't indexed", e.status === 200 && /Nothing in Garden right now/.test(e.body) && /noindex/.test(e.body));
  const x = await call(cat, { cat: "nope" });
  ok("an unknown category is a 404", x.status === 404);
  const all = await call(cat, {});
  ok("/c lists every category with counts", all.status === 200 && /href="\/c\/coins-stamps"/.test(all.body) && /Trading Cards <b>2<\/b>/.test(all.body));
}
{
  const r = await call(sitemap, {});
  ok("the sitemap is XML", r.status === 200 && /application\/xml/.test(r.headers["content-type"]) && r.body.startsWith("<?xml"));
  ok("it lists open listings and their categories, not finished ones", r.body.includes("-" + I1 + "</loc>") && r.body.includes("/item/pikachu-promo-" + I2 + "</loc>") && !r.body.includes(I3) && !r.body.includes(I4) &&
    r.body.includes("/c/trading-cards</loc>") && !r.body.includes("/c/home-kitchen"));
}
{
  const idx = await call(trade, {});
  ok("/trade lists every way to trade", idx.status === 200 && trade.ORDER.every((s) => idx.body.includes('href="/trade/' + s + '"')));
  const pages = await Promise.all(trade.ORDER.map((s) => call(trade, { page: s })));
  const titles = pages.map((r) => (/<title>([^<]*)<\/title>/.exec(r.body) || [])[1]), descs = pages.map((r) => meta(r.body, "description"));
  ok("each way-to-trade page has its own title, description, h1 and canonical address",
    pages.every((r, i) => r.status === 200 && /<h1>[^<]+<\/h1>/.test(r.body) && r.body.includes('<link rel="canonical" href="https://www.dottrader.app/trade/' + trade.ORDER[i] + '">')) &&
    new Set(titles).size === titles.length && new Set(descs).size === descs.length && descs.every((d) => d && d.length <= 200), descs.map((d) => d && d.length).join(","));
  ok("…with questions marked up for search, and a way to start", pages.every((r) => lds(r.body).some((x) => x["@type"] === "FAQPage" && x.mainEntity.length >= 2) && r.body.includes('href="/app#post"')));
  const nftPage = pages[trade.ORDER.indexOf("nft-swap-cross-chain")].body, poke = pages[trade.ORDER.indexOf("pokemon-cards")].body;
  ok("the NFT page shows NFTs up for trade, with their artwork", nftPage.includes("Wiiide #8240") && nftPage.includes('src="/og/art/' + I5 + '.png"') && !nftPage.includes("Pikachu promo"));
  ok("the Pokémon page shows only cards that are Pokémon", !poke.includes("Wiiide") && !poke.includes("Pikachu promo") && /Be the first/.test(poke));
  ok("an unknown way to trade is a 404", (await call(trade, { page: "nope" })).status === 404);
  const r = await call(sitemap, {});
  ok("the sitemap lists the ways to trade", r.body.includes("/trade</loc>") && trade.ORDER.every((s) => r.body.includes("/trade/" + s + "</loc>")));
  const n = await call(cat, { cat: "nfts" });
  ok("the NFTs page talks about NFTs, not posting", /across chains/.test(meta(n.body, "description")) && !/by post/.test(meta(n.body, "description")));
}
{
  // Every public page in Spanish, Japanese and Portuguese: right language, every other language
  // linked, no English left in what the page itself says (listings keep their owners' words).
  const I = require("../api/_i18n.js"), TT = require("../api/_trade_text.js");
  const englishOnly = (lang) => {
    const words = new Set();
    for (const k in I.S) if (I.S[k][lang] !== I.S[k].en && I.S[k].en.length > 6 && !/\{/.test(I.S[k].en)) words.add(I.S[k].en);
    const walk = (a, b) => { if (typeof a === "string") { if (a !== b && a.length > 12) words.add(a.replace(/<[^>]+>/g, "")); } else if (a && typeof a === "object") for (const k in a) walk(a[k], b && b[k]); };
    walk(TT.en, TT[lang]);
    return [...words].map((w) => w.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;"));
  };
  for (const lang of ["es", "ja", "pt"]) {
    const P = "/" + lang, H = I.META[lang].hreflang, en = englishOnly(lang);
    const pages = [["item", await call(item, { id: "charizard-script-alert-1-script-holo-" + I1, lang })], ["category", await call(cat, { cat: "trading-cards", lang })],
      ["all categories", await call(cat, { lang })], ["ways to trade", await call(trade, { lang })], ["a way to trade", await call(trade, { page: "nfts-for-physical-items", lang })]];
    const bad = pages.filter(([, r]) => !(r.status === 200 && r.body.includes('<html lang="' + H + '">') && r.body.includes('<link rel="canonical" href="https://www.dottrader.app' + P + "/") &&
      ["en", "es", "ja", "pt-BR", "x-default"].every((h) => r.body.includes('hreflang="' + h + '"')))).map(([n]) => n);
    ok(lang + ": every page is in " + H + ", with its own address and every language's linked", !bad.length, bad.join(", "));
    const leaks = pages.flatMap(([n, r]) => { const seen = r.body.replace(/<script[\s\S]*?<\/script>/g, ""); return en.filter((w) => seen.includes(w)).map((w) => n + ": " + w.slice(0, 50)); });
    ok(lang + ": no English left on the pages", !leaks.length, leaks.slice(0, 4).join(" | "));
    ok(lang + ": links stay in " + H, pages.every(([, r]) => !/href="\/(c|trade|item)\//.test(r.body.split("<main")[1].split('<nav class="langs"')[0])) &&
      pages[0][1].body.includes('href="/app?lang=' + lang + "#item=" + I1 + '"'), "");
  }
  const old = await call(item, { id: I1, lang: "ja" });
  ok("an old link in Japanese redirects to the Japanese address", old.status === 301 && old.headers.location === "/ja/item/charizard-script-alert-1-script-holo-" + I1, old.headers.location);
  const sm = (await call(sitemap, {})).body;
  ok("the sitemap lists every language of a page, each naming the others", sm.includes("<loc>https://www.dottrader.app/pt/trade/pokemon-cards</loc>") &&
    sm.includes('<xhtml:link rel="alternate" hreflang="ja" href="https://www.dottrader.app/ja/item/pikachu-promo-' + I2 + '"/>') && !sm.includes("/es/app") && !sm.includes("/es/stickers"));
  ok("the trade pages say the same things in every language", ["es", "ja", "pt"].every((l) => Object.keys(TT[l].pages).join() === Object.keys(TT.en.pages).join() &&
    Object.keys(TT.en.pages).every((k) => TT[l].pages[k].faq.length === TT.en.pages[k].faq.length && TT[l].pages[k].sections.length === TT.en.pages[k].sections.length)));
}
{
  // The board builds the same addresses as the server.
  const fs = await import("node:fs"); const vm = await import("node:vm");
  const core = fs.readFileSync(new URL("../site/js/core.js", import.meta.url), "utf8");
  const ctx = { document: { getElementById() { return null; } }, window: {} }; vm.createContext(ctx);
  vm.runInContext(core.slice(0, core.indexOf("function fnUrl")), ctx);
  const L = require("../api/_lib.js");
  const titles = ["Charizard holo, base set (PSA 8)", "Pokémon Évolutions — ETB", "VAMPEPE ☲ aplcake", "☲", "Tom & Jerry", "x".repeat(90), "Ünïcödé çàfé ñ"];
  const diff = titles.filter((t) => ctx.itemPath({ id: "i", title: t }) !== L.itemPath({ id: "i", title: t }));
  ok("the board and the server spell listing addresses the same way", !diff.length, diff.join(" | "));
}
console.log(res.join("\n"));
const failed = res.filter((x) => x.startsWith("FAIL")).length;
console.log(failed ? failed + " failed" : res.length + " passed");
process.exit(failed ? 1 : 0);
