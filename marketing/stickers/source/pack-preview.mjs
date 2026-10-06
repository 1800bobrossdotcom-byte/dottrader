// The sticker page's link preview: /stickers/pack-preview.png, 1200×630.
// node marketing/stickers/source/pack-preview.mjs site/stickers
import fs from "node:fs";
const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
const O = process.argv[2]; const img = (f) => "data:image/png;base64," + fs.readFileSync(O + "/" + f).toString("base64");
const font = (f) => "data:font/ttf;base64," + fs.readFileSync(new URL("../../../api/_fonts/" + f, import.meta.url)).toString("base64");
const at = (f, x, y, w, r) => `<img src="${img(f)}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;transform:rotate(${r}deg);filter:drop-shadow(6px 8px 0 rgba(0,0,0,.18))">`;
const html = `<!doctype html><html><head><style>@font-face{font-family:"Space Grotesk";src:url(${font("SpaceGrotesk-Bold.ttf")})}@font-face{font-family:"IBM Plex Mono";font-weight:500;src:url(${font("IBMPlexMono-Medium.ttf")})}</style></head>
<body style="margin:0;width:1200px;height:630px;overflow:hidden;position:relative;background:#F3EAD3 radial-gradient(circle, rgba(39,178,232,.45) 2px, transparent 2.6px) 0 0/18px 18px;font-family:'Space Grotesk'">
<div style="position:absolute;left:56px;top:54px;width:430px">
  <div style="font:500 20px 'IBM Plex Mono';letter-spacing:3px;color:#E8392B">FREE · PRINT · SHARE</div>
  <div style="font-size:84px;line-height:.98;letter-spacing:-2px;margin:14px 0 22px;color:#121212">The sticker pack</div>
  <div style="font:500 24px/1.35 'IBM Plex Mono';color:#4B4740">Six stickers for binders, console boxes, laptops &amp; meetups.</div>
  <div style="display:inline-block;margin-top:30px;background:#FFD23F;border:4px solid #121212;border-radius:999px;padding:8px 22px;font-size:28px;box-shadow:5px 5px 0 #121212">dottrader.app/stickers</div>
</div>
${at("square-pitch.png", 520, 40, 250, -6)}
${at("diecut-logo.png", 800, 18, 250, 5)}
${at("square-trade-me.png", 930, 300, 240, 7)}
${at("diecut-physical-nft.png", 690, 300, 260, -4)}
${at("diecut-scan.png", 470, 330, 240, 3)}
</body></html>`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(html, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: O + "/pack-preview.png" }); await b.close();
