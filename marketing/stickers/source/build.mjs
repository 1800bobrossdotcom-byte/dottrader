// Builds the Dot Trading Post sticker set: print PNGs at 300 dpi and PDFs, plus a preview sheet.
import { createRequire } from "node:module"; import fs from "node:fs"; import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const QR = require("qrcode");
const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
const S = process.argv[2], OUT = process.argv[3], ONLY = process.argv.slice(4); fs.mkdirSync(OUT, { recursive: true });
const URL_ = "https://dottrader.app/?ref=sticker";

const C = { paper: "#F3EAD3", card: "#FFFCF4", ink: "#121212", yellow: "#FFD23F", red: "#E8392B", cyan: "#27B2E8", pink: "#F2518F", blue: "#2F56D6", purple: "#7B4FD6", green: "#1DB36A" };
const logo = (w) => `<svg viewBox="0 0 40 40" width="${w}" height="${w}"><path d="M9 5h11a15 15 0 0 1 0 30H9z" fill="${C.yellow}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/><circle cx="20" cy="20" r="5.5" fill="${C.red}" stroke="${C.ink}" stroke-width="3"/></svg>`;
const box = (w) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}"><path d="M3 7l9-4 9 4v10l-9 4-9-4z" fill="${C.yellow}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/><path d="M3 7l9 4 9-4M12 11v10" fill="none" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/></svg>`;
const nft = (w) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}"><path d="M12 2l9 5v10l-9 5-9-5V7z" fill="${C.purple}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/><path d="M12 7l4 5-4 5-4-5z" fill="#fff" stroke="${C.ink}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

// A QR code drawn the Dot way: round dots for data, rounded finder squares, the D in the middle.
// Error correction H leaves room for the logo; every output is decoded afterwards to prove it scans.
function qr(px, { fg = C.ink, logoFrac = 0.18 } = {}) {
  const q = QR.create(URL_, { errorCorrectionLevel: "H" }), n = q.modules.size, m = 3, N = n + 2 * m;
  const at = (x, y) => q.modules.data[y * n + x];
  const finder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const c0 = Math.floor(n / 2), half = Math.ceil(n * logoFrac / 2);
  const inLogo = (x, y) => Math.abs(x - c0) <= half && Math.abs(y - c0) <= half;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!at(x, y) || finder(x, y) || inLogo(x, y)) continue;
    d += `<rect x="${x + m + 0.06}" y="${y + m + 0.06}" width="0.88" height="0.88" rx="0.3"/>`;
  }
  const f = (x, y) => `<rect x="${x + m + 0.5}" y="${y + m + 0.5}" width="6" height="6" rx="1.6" fill="none" stroke="${fg}" stroke-width="1"/><rect x="${x + m + 2}" y="${y + m + 2}" width="3" height="3" rx="0.8" fill="${fg}"/>`;
  const L = (2 * half + 1), lx = c0 - half + m;
  return `<svg viewBox="0 0 ${N} ${N}" width="${px}" height="${px}" style="display:block;background:#fff;border-radius:${px * 0.06}px"><g fill="${fg}">${d}</g>${f(0, 0)}${f(n - 7, 0)}${f(0, n - 7)}` +
    `<g transform="translate(${lx + 0.15} ${lx + 0.15}) scale(${(L - 0.3) / 40})"><path d="M9 5h11a15 15 0 0 1 0 30H9z" fill="${C.yellow}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/><circle cx="20" cy="20" r="5.5" fill="${C.red}" stroke="${C.ink}" stroke-width="3"/></g></svg>`;
}
const halftone = (color, size = 9, dot = 1.7) => `radial-gradient(circle, ${color} ${dot}px, transparent ${dot + 0.4}px) 0 0/${size}px ${size}px`;

const base = `
@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap");
*{box-sizing:border-box;margin:0;padding:0} html,body{background:transparent}
body{font-family:"IBM Plex Sans",sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased}
.disp{font-family:"Space Grotesk",sans-serif;font-weight:700;letter-spacing:-.03em;text-transform:uppercase;line-height:.92}
.mono{font-family:"IBM Plex Mono",monospace;font-weight:500;letter-spacing:.14em;text-transform:uppercase}
.hl{background:${C.yellow};padding:0 .1em;box-shadow:.05in .05in 0 ${C.ink}} .hl2{background:${C.red};color:#fff;padding:0 .1em;box-shadow:.05in .05in 0 ${C.ink}}
.chip{display:inline-flex;align-items:center;gap:.03in;border:.02in solid ${C.ink};border-radius:999px;background:${C.card};padding:.03in .09in .03in .05in;font-weight:700;box-shadow:.03in .03in 0 ${C.ink};white-space:nowrap}
`;
// Die-cut: transparent page; the artwork gets a white border grown from its own shape, which is
// what printers cut around. A second render draws that cut line in magenta for the preview.
const cutFilter = (r, preview) => `<svg width="0" height="0" style="position:absolute"><filter id="cut" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
  <feMorphology in="SourceAlpha" operator="dilate" radius="${r}" result="d"/>
  <feFlood flood-color="#ffffff"/><feComposite in2="d" operator="in" result="white"/>
  ${preview ? `<feMorphology in="d" operator="dilate" radius="1.2" result="d2"/><feComposite in="d2" in2="d" operator="out" result="ring"/><feFlood flood-color="#ff00c8"/><feComposite in2="ring" operator="in" result="line"/>` : ""}
  <feMerge>${preview ? '<feMergeNode in="line"/>' : ""}<feMergeNode in="white"/></feMerge></filter></svg>`;

const DIE = {
  "diecut-logo": `<div style="display:grid;justify-items:center;gap:.04in">
      <div style="position:relative">
        <div style="width:1.95in;height:1.95in;border-radius:50%;background:${halftone(C.pink, 10, 2)},${C.card};border:.03in solid ${C.ink};display:grid;place-items:center">${logo("1.55in")}</div>
        <div style="position:absolute;right:-.36in;top:-.08in;transform:rotate(7deg);background:${C.card};border:.025in solid ${C.ink};border-radius:.1in;padding:.045in .045in .03in;box-shadow:.04in .04in 0 ${C.ink};display:grid;justify-items:center;gap:.015in">
          <div style="border:.015in solid ${C.ink};border-radius:.06in;overflow:hidden">${qr(78)}</div>
          <div class="mono" style="font-size:.065in;letter-spacing:.12em">Scan me</div>
        </div>
      </div>
      <div class="disp" style="background:${C.ink};color:${C.yellow};font-size:.27in;padding:.07in .16in .05in;border-radius:.08in;margin-top:-.34in;transform:rotate(-3deg);box-shadow:.05in .05in 0 ${C.red};position:relative">Dot Trading Post</div>
      <div class="mono" style="font-size:.13in;font-weight:500;letter-spacing:.08em;text-transform:none;background:${C.yellow};border:.02in solid ${C.ink};border-radius:999px;padding:.035in .12in;box-shadow:.03in .03in 0 ${C.ink};margin-top:.04in;transform:rotate(-3deg)">dottrader.app</div>
    </div>`,
  "diecut-scan": `<div style="position:relative;padding:.28in 0 0 .28in">
      <div style="position:absolute;left:0;top:0;transform:rotate(-8deg);z-index:2">${logo(".85in")}</div>
      <div style="width:2.3in;background:${C.card};border:.03in solid ${C.ink};border-radius:.16in;box-shadow:.07in .07in 0 ${C.ink};padding:.12in .16in .1in;display:grid;gap:.06in;justify-items:center">
        <div class="disp" style="font-size:.22in;text-align:right;justify-self:end">Scan<br>to <span class="hl">swap</span></div>
        <div style="border:.02in solid ${C.ink};border-radius:.1in;overflow:hidden">${qr(150)}</div>
        <div class="mono" style="font-size:.095in;letter-spacing:.12em">dottrader.app</div>
      </div>
    </div>`,
  "diecut-physical-nft": `<div style="position:relative;width:2.9in;height:2.9in;display:grid;place-items:center">
      <svg viewBox="0 0 100 100" width="100%" height="100%" style="position:absolute;inset:0"><defs><pattern id="ht" width="3.2" height="3.2" patternUnits="userSpaceOnUse"><circle cx="1.6" cy="1.6" r=".75" fill="${C.cyan}"/></pattern></defs>
        <polygon points="${Array.from({ length: 28 }, (_, i) => { const a = i / 28 * Math.PI * 2, r = i % 2 ? 41 : 49; return (50 + r * Math.cos(a)).toFixed(2) + "," + (50 + r * Math.sin(a)).toFixed(2); }).join(" ")}" fill="${C.yellow}" stroke="${C.ink}" stroke-width="1.6" stroke-linejoin="round"/>
        <polygon points="${Array.from({ length: 28 }, (_, i) => { const a = i / 28 * Math.PI * 2, r = i % 2 ? 41 : 49; return (50 + r * Math.cos(a)).toFixed(2) + "," + (50 + r * Math.sin(a)).toFixed(2); }).join(" ")}" fill="url(#ht)" opacity=".35"/></svg>
      <div style="position:relative;display:grid;justify-items:center;gap:.05in;text-align:center;transform:rotate(-6deg)">
        <div style="display:flex;align-items:center;gap:.06in">${box(".62in")}<span class="disp" style="font-size:.4in">⇄</span>${nft(".62in")}</div>
        <div class="disp" style="font-size:.3in">Physical<br>for <span class="hl2">NFT</span></div>
        <div class="mono" style="font-size:.085in;margin-top:.1in">No bridge · no cash</div>
        <div class="mono" style="font-size:.085in">dottrader.app</div>
      </div>
    </div>`,
};
const SQ = {
  "square-pitch": `<div style="position:absolute;inset:0;background:${C.paper}">
      <div style="position:absolute;left:-.3in;top:-.3in;width:1.8in;height:1.8in;background:${halftone(C.cyan)};-webkit-mask:radial-gradient(circle at 30% 30%,#000,transparent 68%);opacity:.6"></div>
      <div style="position:absolute;right:-.3in;bottom:-.3in;width:1.8in;height:1.8in;background:${halftone(C.pink)};-webkit-mask:radial-gradient(circle at 70% 70%,#000,transparent 68%);opacity:.55"></div>
      <div style="position:absolute;inset:.27in;display:grid;grid-template-rows:auto auto auto 1fr;gap:.09in">
        <div style="display:flex;align-items:center;gap:.06in">${logo(".32in")}<span class="disp" style="font-size:.135in;letter-spacing:.06em">Dot Trading Post</span></div>
        <div class="disp" style="font-size:.285in">Trade <span class="hl">anything</span><br>for <span class="hl2">anything</span>.</div>
        <p style="font-size:.088in;line-height:1.35;font-weight:500;max-width:2.4in;margin-top:.04in">A barter board that finds people who have what you want — and want what you have. Every trader's record is out in the open.</p>
        <div style="display:grid;grid-template-columns:1fr auto;gap:.1in;align-items:end;align-self:end">
          <div style="display:grid;gap:.045in;font-size:.082in">
            <span class="chip">${box(".14in")}⇄${box(".14in")} Physical ⇄ physical</span>
            <span class="chip">${nft(".14in")}⇄${nft(".14in")} NFT ⇄ NFT, any chain</span>
            <span class="chip">${box(".14in")}⇄${nft(".14in")} Physical ⇄ NFT</span>
            <div class="mono" style="font-size:.066in;line-height:1.45;margin-top:.03in">No prices · no bridge · no cash<br><b style="font-size:.08in;letter-spacing:.08em">dottrader.app</b></div>
          </div>
          <div style="border:.02in solid ${C.ink};border-radius:.07in;overflow:hidden;box-shadow:.04in .04in 0 ${C.ink}">${qr(96)}</div>
        </div>
      </div>
    </div>`,
  "square-scan": `<div style="position:absolute;inset:0;background:${halftone("rgba(18,18,18,.16)", 10, 1.6)},${C.yellow}">
      <div style="position:absolute;inset:.29in;display:grid;justify-items:center;align-content:space-between">
        <div class="disp" style="font-size:.4in;text-align:center">Scan<br>to swap</div>
        <div style="border:.03in solid ${C.ink};border-radius:.12in;overflow:hidden;box-shadow:.06in .06in 0 ${C.ink}">${qr(156)}</div>
        <div style="display:flex;align-items:center;gap:.05in">${logo(".26in")}<span class="mono" style="font-size:.1in;letter-spacing:.1em">dottrader.app</span></div>
      </div>
    </div>`,
  "square-trade-me": `<div style="position:absolute;inset:0;background:${C.card}">
      <div style="position:absolute;inset:0;background:${halftone(C.purple, 9, 1.5)};-webkit-mask:linear-gradient(160deg,#000,transparent 45%);opacity:.35"></div>
      <div style="position:absolute;inset:.29in;display:grid;grid-template-rows:auto auto 1fr auto;gap:.07in">
        <div style="display:flex;align-items:center;justify-content:space-between"><span class="mono" style="font-size:.085in;background:${C.ink};color:${C.yellow};padding:.03in .07in;border-radius:.03in">Up for trade</span>${logo(".32in")}</div>
        <div class="disp" style="font-size:.235in">What would you<br><span class="hl">trade</span> for this?</div>
        <div style="display:grid;gap:.06in;align-content:center;margin-top:.04in">
          <div style="border:.02in solid ${C.ink};border-radius:.05in;background:#E3EAFF;padding:.035in .07in"><span class="mono" style="font-size:.065in;color:${C.blue}">I have</span><div style="border-bottom:.012in dashed ${C.ink};height:.12in"></div></div>
          <div style="border:.02in solid ${C.ink};border-radius:.05in;background:#FFE4E0;padding:.035in .07in"><span class="mono" style="font-size:.065in;color:${C.red}">I want</span><div style="border-bottom:.012in dashed ${C.ink};height:.12in"></div></div>
        </div>
        <div style="display:flex;align-items:end;justify-content:space-between">
          <div class="mono" style="font-size:.068in;line-height:1.45">Make an offer —<br>things or NFTs,<br>any chain.<br><b style="font-size:.08in">dottrader.app</b></div>
          <div style="border:.02in solid ${C.ink};border-radius:.06in;overflow:hidden">${qr(76)}</div>
        </div>
      </div>
    </div>`,
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ deviceScaleFactor: 300 / 96 });
const fontRoutes = async (p) => {
  await p.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ path: S + "/vendor/fonts.css", contentType: "text/css" }));
  await p.route(/fonts\.gstatic\.com/, (r) => { const h = crypto.createHash("md5").update(r.request().url()).digest("hex").slice(0, 12); const f = S + "/vendor/" + h + ".woff2"; fs.existsSync(f) ? r.fulfill({ path: f, contentType: "font/woff2" }) : r.fulfill({ status: 404, body: "" }); });
};
const made = [];
async function render(name, inner, w, h, die, preview) {
  const p = await ctx.newPage(); await fontRoutes(p);
  await p.setViewportSize({ width: Math.round(w * 96), height: Math.round(h * 96) });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${base} @page{size:${w}in ${h}in;margin:0} body{width:${w}in;height:${h}in;position:relative;overflow:hidden}</style></head><body>` +
    (die ? cutFilter(9.6, preview) + `<div style="position:absolute;inset:0;display:grid;place-items:center"><div style="display:grid">` +
      // The border is grown from a hidden copy underneath, so the artwork itself is never filtered
      // (a filter re-rasterises it, which softened the QR code enough to stop it scanning).
      `<div style="grid-area:1/1;filter:url(#cut)" aria-hidden="true">${inner}</div><div style="grid-area:1/1;position:relative;z-index:1">${inner}</div></div></div>` : inner) + "</body></html>";
  await p.setContent(html, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready);
  const file = OUT + "/" + name + (preview ? "-cutline" : "") + ".png";
  await p.screenshot({ path: file, omitBackground: !!die, fullPage: false });
  if (!preview) { await p.pdf({ path: OUT + "/" + name + ".pdf", width: w + "in", height: h + "in", printBackground: true }); made.push(file); }
  await p.close();
  return file;
}
const want = (k) => !ONLY.length || ONLY.includes(k);
for (const [k, v] of Object.entries(DIE)) { if (!want(k)) continue; await render(k, v, 3.2, 3.2, true); await render(k, v, 3.2, 3.2, true, true); }
for (const [k, v] of Object.entries(SQ)) if (want(k)) await render(k, v, 3.25, 3.25, false);

// Prove every QR scans, on the final pixels, with two different readers at print size and at
// the smaller sizes a phone camera actually sees.
const { execFileSync } = await import("node:child_process");
console.log(execFileSync(process.execPath, [new URL("./probe2.mjs", import.meta.url).pathname, ...made.filter((f) => !/physical-nft/.test(f))], { encoding: "utf8" }));
await browser.close();
