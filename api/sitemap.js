// Dot Trading Post — /sitemap.xml, built from the board: the landing page, every category with
// something in it, and every open listing.

const L = require("./_lib.js");

function u(loc, lastmod, freq, pri) {
  return "  <url><loc>" + L.esc(L.SITE + loc) + "</loc>" + (lastmod ? "<lastmod>" + lastmod.slice(0, 10) + "</lastmod>" : "") +
    "<changefreq>" + freq + "</changefreq><priority>" + pri + "</priority></url>\n";
}

module.exports = async function handler(req, res) {
  let rows = [];
  try { rows = await L.rest("items?select=id,title,cat,created_at&status=eq.open&order=created_at.desc&limit=20000"); } catch (e) { rows = []; }
  const cats = {};
  rows.forEach((r) => { if (!cats[r.cat] || r.created_at > cats[r.cat]) cats[r.cat] = r.created_at; });
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    u("/", null, "weekly", "1.0") + u("/app", rows[0] && rows[0].created_at, "hourly", "0.8") + u("/c", rows[0] && rows[0].created_at, "daily", "0.7");
  L.CATS.forEach((c) => { if (cats[c]) x += u("/c/" + L.slug(c), cats[c], "daily", "0.6"); });
  rows.forEach((r) => { x += u(L.itemPath(r), r.created_at, "weekly", "0.5"); });
  x += "</urlset>\n";
  res.statusCode = 200;
  res.setHeader("content-type", "application/xml; charset=utf-8");
  res.setHeader("cache-control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.end(x);
};
