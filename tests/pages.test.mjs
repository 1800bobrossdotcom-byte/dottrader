// Tests for the public pages (api/item.js, api/c.js, api/sitemap.js) with the database faked.
// Run: node tests/pages.test.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const A = "11111111-1111-4111-8111-111111111111";
const I1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", I2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", I3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", I4 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const items = [
  { id: I1, owner_id: A, title: 'Charizard <script>alert(1)</script> holo', descr: "Base set, \"near mint\".\nNo trades for cash.", want: "N64 games", want_cats: ["Consoles & Retro"], open_to_offers: true, cat: "Trading Cards", status: "open", photos: ["https://x.supabase.co/storage/v1/object/public/photos/a/1.jpg", "https://x.supabase.co/storage/v1/object/public/photos/a/2.jpg"], created_at: "2026-10-01T10:00:00Z" },
  { id: I2, owner_id: A, title: "Pikachu promo", descr: "", want: "", want_cats: [], open_to_offers: true, cat: "Trading Cards", status: "open", photos: [], created_at: "2026-10-02T10:00:00Z" },
  { id: I3, owner_id: A, title: "Old lamp", descr: "", want: "", cat: "Home & Kitchen", status: "traded", photos: [], created_at: "2026-09-01T10:00:00Z" },
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

const item = require("../api/item.js"), cat = require("../api/c.js"), sitemap = require("../api/sitemap.js");
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
  ok("link previews get its first photo", meta(r.body, "og:image") === items[0].photos[0]);
  ok("…and a description with what they want", /Wants N64 games · or any Consoles &amp; Retro/.test(meta(r.body, "og:description") || ""), meta(r.body, "og:description"));
  ok("search engines may index it", !/noindex/.test(r.body));
  const ld = lds(r.body);
  ok("structured data: a Product with both photos, and breadcrumbs", ld[0]["@type"] === "Product" && ld[0].image.length === 2 && ld[0].name === items[0].title && ld[1]["@type"] === "BreadcrumbList" && ld[1].itemListElement[1].item.endsWith("/c/trading-cards"));
  ok("structured data can't close its own script tag", !/<\/script>alert/.test(r.body.split('application/ld+json">')[1].split("</script>")[0]));
  ok("Make an offer goes into the board", r.body.includes('href="/app#item=' + I1 + '"'));
  ok("shows the owner, the proof badge, and the swipe hint", /Listed by <b>Alice &amp; Co<\/b> · Leeds/.test(r.body) && /Proof of item/.test(r.body) && /Swipe for 1 more photo</.test(r.body));
  ok("canonical is the readable address", r.body.includes('<link rel="canonical" href="https://www.dottrader.app/item/charizard-script-alert-1-script-holo-' + I1 + '">'));
  ok("more from the category, not itself", r.body.includes("/item/pikachu-promo-" + I2) && !r.body.split('class="more"')[1].includes(I1));
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
