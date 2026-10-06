import fs from "node:fs";
const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
const O = process.argv[2]; const img = (f) => "data:image/png;base64," + fs.readFileSync(O + "/" + f).toString("base64");
const die = ["diecut-logo", "diecut-scan", "diecut-physical-nft"], sq = ["square-pitch", "square-scan", "square-trade-me"];
const html = `<!doctype html><html><body style="margin:0;background:#cfcfcf;font:600 15px system-ui;padding:28px">
<div style="font:700 22px system-ui;margin:0 0 6px">Dot Trading Post — stickers</div>
<div style="color:#444;margin-bottom:18px">Die-cut, 3″ (pink = where it's cut) &nbsp;·&nbsp; Square, 3″ × 3″ (dashed = trim; artwork runs past it into the bleed)</div>
<div style="display:grid;grid-template-columns:repeat(3,300px);gap:26px">
${die.map((d) => `<figure style="margin:0"><img src="${img(d + "-cutline.png")}" width="300"><figcaption>${d}</figcaption></figure>`).join("")}
${sq.map((d) => `<figure style="margin:0"><div style="position:relative"><img src="${img(d + ".png")}" width="300" style="display:block"><div style="position:absolute;inset:11.5px;border:1.5px dashed #ff00c8"></div></div><figcaption>${d}</figcaption></figure>`).join("")}
</div></body></html>`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1030, height: 760 }, deviceScaleFactor: 2 });
await p.setContent(html); await p.screenshot({ path: O + "/preview-sheet.png", fullPage: true }); await b.close();
