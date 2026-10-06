// Small WebP copies of the stickers for the homepage: site/stickers/thumb/<id>.webp, 360px wide.
// node marketing/stickers/source/thumbs.mjs site/stickers
import fs from "node:fs";
const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
const O = process.argv[2], ids = ["diecut-logo", "diecut-scan", "diecut-physical-nft", "square-pitch", "square-scan", "square-trade-me"];
fs.mkdirSync(O + "/thumb", { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }); const p = await b.newPage();
for (const id of ids) {
  const src = "data:image/png;base64," + fs.readFileSync(O + "/" + id + ".png").toString("base64");
  const out = await p.evaluate(async (src) => {
    const i = new Image(); i.src = src; await i.decode();
    const c = document.createElement("canvas"); c.width = 360; c.height = Math.round(360 * i.naturalHeight / i.naturalWidth);
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(i, 0, 0, c.width, c.height);
    return c.toDataURL("image/webp", 0.86);
  }, src);
  fs.writeFileSync(O + "/thumb/" + id + ".webp", Buffer.from(out.split(",")[1], "base64"));
}
await b.close();
