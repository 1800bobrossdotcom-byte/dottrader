// Link-preview cards (api/og.js): artwork of every kind becomes a PNG card previews can use.
// Run: npm run test:og
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", A = "11111111-1111-4111-8111-111111111111";
const svg = '<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#6a8494"/><svg x="2" width="20" height="20" viewBox="0 0 24 24"><rect x="4" y="4" width="8" height="8" fill="#000000ff"/></svg></svg>';
const PNG1 = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const items = {
  [ID]: { id: ID, owner_id: A, title: "Wiiide #8240 ☲", want: "", want_cats: ["Trading Cards"], open_to_offers: true, cat: "Art", status: "open", photos: ["data:image/svg+xml;base64," + Buffer.from(svg).toString("base64")] },
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", owner_id: A, title: "Lamp", want: "", status: "open", photos: ["https://img.example.com/broken.png"] },
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc": { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", owner_id: A, title: "Gone", want: "", status: "removed", photos: [] },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes("/rest/v1/items")) { const id = new URL(url).searchParams.get("id").slice(3); return new Response(JSON.stringify(items[id] ? [items[id]] : [])); }
  if (url.includes("/rest/v1/profiles")) return new Response(JSON.stringify([{ name: "lovebeing" }]));
  if (url === "https://img.example.com/ok.png") return new Response(PNG1, { headers: { "content-type": "image/png" } });
  if (url === "https://img.example.com/page.html") return new Response("<html>not an image</html>");
  if (url.includes("img.example.com")) return new Response("nope", { status: 404 });
  return realFetch(url, init);  // the renderer's own emoji / font lookups
};
const og = require("../api/og.js");
const call = (id, art) => new Promise((resolve) => { const res = { statusCode: 0, h: {}, setHeader(k, v) { this.h[k] = v; }, end(b) { resolve({ status: this.statusCode, h: this.h, body: b }); } }; og({ query: art ? { id, art: "1" } : { id }, url: "/" }, res); });
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (c || !x ? "" : "  [" + x + "]"));
const dims = (b) => b && b.length > 24 && b.slice(1, 4).toString() === "PNG" ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;

const a1 = await og.artwork("data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"));
ok("an on-chain SVG becomes a PNG", /^data:image\/png;base64,/.test(a1 || ""));
ok("a PNG at a web address is used", /^data:image\/png;base64,/.test(await og.artwork("https://img.example.com/ok.png") || ""));
ok("a web page pretending to be an image is not", (await og.artwork("https://img.example.com/page.html")) === null);
ok("a private address is never fetched", (await og.artwork("http://169.254.169.254/latest/meta-data")) === null && (await og.artwork("http://localhost/x.png")) === null);
ok("a WebP-only or unknown data URI is skipped, not drawn wrong", (await og.artwork("data:image/webp;base64,AAAA")) === null);
let r = await call(ID + ".png");
ok("a listing's card is a 1200×630 PNG", r.status === 200 && r.h["content-type"] === "image/png" && JSON.stringify(dims(r.body)) === "[1200,630]", r.status + " " + JSON.stringify(dims(r.body)));
ok("…cached for a day at the edge", /s-maxage=86400/.test(r.h["cache-control"]));
r = await call("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
ok("artwork that won't load still gets a card", r.status === 200 && JSON.stringify(dims(r.body)) === "[1200,630]");
ok("a taken-down listing has no card", (await call("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).status === 404);
ok("a malformed id has no card", (await call("../../etc/passwd")).status === 404);
r = await call(ID + ".png", true);
ok("/og/art: just the artwork, as an image, cached for a week", r.status === 200 && r.h["content-type"] === "image/png" && dims(r.body) && dims(r.body)[0] > 0 && /s-maxage=604800/.test(r.h["cache-control"]), r.status + " " + r.h["content-type"]);
ok("…and nothing for a listing whose artwork won't load", (await call("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", true)).status === 404);
console.log(res.join("\n"));
const failed = res.filter((x) => x.startsWith("FAIL")).length;
console.log(failed ? failed + " failed" : res.length + " passed");
process.exit(failed ? 1 : 0);
