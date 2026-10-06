// Dot Trading Post — a listing's link-preview image: /og/item/<id>.png, 1200×630.
//
// X, Discord, iMessage and the rest only show a real PNG or JPEG at a web address. A listing's
// artwork may be a photo, an IPFS file, or an NFT whose image lives on chain as an SVG inside the
// token's own metadata — which no preview can use directly. This draws a card on the server with
// the artwork, the title and what the owner wants, and serves it as a PNG every service accepts.
//
// The artwork is fetched here (size- and time-capped, private hosts refused) and only PNG, JPEG,
// GIF or SVG is used; anything else, or anything that fails, gets the card without a picture
// rather than a broken preview.

const fs = require("fs");
const path = require("path");
const L = require("./_lib.js");
const nft = require("./nft.js");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const W = 1200, H = 630, MAX = 4 * 1024 * 1024;
const C = { paper: "#F3EAD3", card: "#FFFCF4", sunk: "#EADFC4", ink: "#121212", muted: "#4B4740", yellow: "#FFD23F", red: "#E8392B", blue: "#2F56D6", purple: "#7B4FD6", green: "#1DB36A", haveSoft: "#E3EAFF", wantSoft: "#FFE4E0" };
const font = (f) => fs.readFileSync(path.join(__dirname, "_fonts", f));
let FONTS = null;
const fonts = () => FONTS || (FONTS = [
  { name: "Space Grotesk", data: font("SpaceGrotesk-Bold.ttf"), weight: 700, style: "normal" },
  { name: "IBM Plex Mono", data: font("IBMPlexMono-Medium.ttf"), weight: 500, style: "normal" },
  { name: "IBM Plex Sans", data: font("IBMPlexSans-SemiBold.ttf"), weight: 600, style: "normal" },
  // Fallbacks for symbols the brand fonts don't have (titles like "VAMPEPE ☲ aplcake").
  { name: "Noto Sans Symbols 2", data: font("NotoSansSymbols2-Regular.ttf"), weight: 400, style: "normal" },
  { name: "Noto Sans Symbols", data: font("NotoSansSymbols-Regular.ttf"), weight: 400, style: "normal" },
]);
const LOGO = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M9 5h11a15 15 0 0 1 0 30H9z" fill="#FFD23F" stroke="#121212" stroke-width="3" stroke-linejoin="round"/><circle cx="20" cy="20" r="5.5" fill="#E8392B" stroke="#121212" stroke-width="3"/></svg>').toString("base64");

// A tiny element builder: the renderer takes plain { type, props } objects, no React needed.
const h = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) } });
const img = (src, style) => ({ type: "img", props: { src, style } });

// SVG artwork (often an NFT's on-chain image) is drawn to PNG first with resvg, which handles the
// nested SVGs and pixel art the card renderer can't.
function svgToPng(buf) {
  try {
    const { Resvg } = require("@resvg/resvg-js");
    return "data:image/png;base64," + Buffer.from(new Resvg(buf.toString("utf8"), { fitTo: { mode: "width", value: 1040 }, font: { loadSystemFonts: false } }).render().asPng()).toString("base64");
  } catch (e) { return null; }
}
const TYPES = { "image/png": 1, "image/jpeg": 1, "image/jpg": 1, "image/gif": 1, "image/svg+xml": 1 };
function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(0, 3).toString() === "GIF") return "image/gif";
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(buf.slice(0, 512).toString("utf8"))) return "image/svg+xml";
  return null;
}
// The artwork as a data URI the renderer can use, or null.
async function artwork(src) {
  if (!src || typeof src !== "string") return null;
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(src);
  if (m) {
    const type = m[1].toLowerCase(); if (!TYPES[type]) return null;
    const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    if (buf.length > MAX) return null;
    return type === "image/svg+xml" ? svgToPng(buf) : "data:" + type + ";base64," + buf.toString("base64");
  }
  let u; try { u = new URL(src); } catch (e) { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) return null;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(6000), redirect: "follow" });
    if (!r.ok || Number(r.headers.get("content-length") || 0) > MAX) return null;
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAX) return null;
    const type = sniff(buf);
    return type === "image/svg+xml" ? svgToPng(buf) : type ? "data:" + type + ";base64," + buf.toString("base64") : null;
  } catch (e) { return null; }
}

function card(it, art, owner) {
  const want = L.wantText(it), open = it.status === "open";
  const chain = it.asset_kind && L.CHAINS[it.asset_chain] ? L.CHAINS[it.asset_chain][0] : null;
  const title = it.title.length > 70 ? it.title.slice(0, 68) + "…" : it.title;
  const size = title.length > 44 ? 50 : title.length > 26 ? 60 : 72;
  return h("div", { width: W, height: H, background: C.paper, padding: 44, gap: 44, alignItems: "center", fontFamily: "IBM Plex Sans", color: C.ink,
      backgroundImage: "radial-gradient(circle, rgba(39,178,232,.45) 2px, transparent 2.6px)", backgroundSize: "18px 18px" },
    h("div", { width: 520, height: 520, flexShrink: 0, background: C.sunk, border: `6px solid ${C.ink}`, borderRadius: 14, boxShadow: `12px 12px 0 ${C.ink}`, overflow: "hidden", alignItems: "center", justifyContent: "center" },
      art ? img(art, { width: "100%", height: "100%", objectFit: "contain" })
          : h("div", { width: 230, height: 230, borderRadius: 999, background: C.card, border: `6px solid ${C.ink}`, alignItems: "center", justifyContent: "center", fontFamily: "Space Grotesk", fontSize: 130 }, it.title.slice(0, 1).toUpperCase())),
    h("div", { flexDirection: "column", flex: 1, height: 520, justifyContent: "space-between" },
      h("div", { flexDirection: "column", gap: 18 },
        h("div", { alignItems: "center", gap: 12 }, img(LOGO, { width: 46, height: 46 }),
          h("div", { fontFamily: "Space Grotesk", fontSize: 24, letterSpacing: 2 }, "DOT TRADING POST")),
        h("div", { gap: 10 },
          h("div", { fontFamily: "IBM Plex Mono", fontSize: 19, letterSpacing: 2, background: open ? C.ink : C.green, color: open ? C.yellow : "#fff", padding: "6px 12px", borderRadius: 6 }, open ? "UP FOR TRADE" : it.status === "traded" ? "TRADED" : "IN A TRADE"),
          chain ? h("div", { fontFamily: "IBM Plex Mono", fontSize: 19, letterSpacing: 2, background: C.purple, color: "#fff", padding: "6px 12px", borderRadius: 6 }, "NFT · " + chain.toUpperCase()) : null),
        h("div", { fontFamily: "Space Grotesk", fontSize: size, lineHeight: 1.02, letterSpacing: -1.5 }, title)),
      h("div", { flexDirection: "column", gap: 14 },
        h("div", { flexDirection: "column", background: C.wantSoft, border: `4px solid ${C.ink}`, borderRadius: 10, padding: "12px 16px" },
          h("div", { fontFamily: "IBM Plex Mono", fontSize: 16, letterSpacing: 3, color: C.red }, "WANTS"),
          h("div", { fontSize: 26, lineHeight: 1.2 }, want.length > 90 ? want.slice(0, 88) + "…" : want)),
        h("div", { justifyContent: "space-between", alignItems: "center", fontFamily: "IBM Plex Mono", fontSize: 20 },
          h("div", {}, owner ? "Listed by " + owner : ""),
          h("div", { background: C.yellow, border: `3px solid ${C.ink}`, borderRadius: 999, padding: "6px 16px", fontFamily: "Space Grotesk", fontSize: 22 }, "dottrader.app")))));
}

module.exports = async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const id = String(q.id || "").toLowerCase().replace(/\.png$/, "");
  const fail = (status) => { res.statusCode = status; res.setHeader("cache-control", "public, s-maxage=60"); res.end(); };
  if (!UUID.test(id)) return fail(404);
  let it;
  try { it = (await L.rest("items?select=*&id=eq." + id))[0]; } catch (e) { return fail(503); }
  if (!it || it.status === "removed") return fail(404);
  const owner = await L.rest("profiles?select=name&id=eq." + it.owner_id).then((r) => (r[0] && r[0].name) || "", () => "");
  let src = it.photos && it.photos[0];
  if (!src && it.asset_kind && it.asset_kind !== "erc20" && nft.validToken(Number(it.asset_chain), String(it.asset_contract), String(it.asset_token_id), it.asset_kind)) {
    const meta = await Promise.race([nft.lookup(Number(it.asset_chain), it.asset_contract, String(it.asset_token_id), it.asset_kind).catch(() => null), new Promise((r) => setTimeout(() => r(null), 7000))]);
    src = meta && meta.image;
  }
  const art = await artwork(src);
  const { ImageResponse } = await import("@vercel/og");
  const draw = async (a) => Buffer.from(await new ImageResponse(card(it, a, owner), { width: W, height: H, fonts: fonts(), emoji: "twemoji" }).arrayBuffer());
  let png;
  try { png = await draw(art); } catch (e) { png = await draw(null); }  // an image the renderer chokes on: the card without it
  res.statusCode = 200;
  res.setHeader("content-type", "image/png");
  res.setHeader("cache-control", "public, s-maxage=86400, stale-while-revalidate=604800");
  res.end(png);
};
module.exports.artwork = artwork;
module.exports.card = card;
