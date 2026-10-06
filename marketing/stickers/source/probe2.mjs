import { createRequire } from "node:module"; import fs from "node:fs"; const require = createRequire(import.meta.url);
const { PNG } = require("pngjs"); const jsQR = require("jsqr");
const Z = require("@zxing/library");
function load(f) { const a = PNG.sync.read(fs.readFileSync(f)); const o = new Uint8ClampedArray(a.data.length);
  for (let i = 0; i < a.data.length; i += 4) { const al = a.data[i + 3] / 255; for (let k = 0; k < 3; k++) o[i + k] = a.data[i + k] * al + 255 * (1 - al); o[i + 3] = 255; } return { w: a.width, h: a.height, d: o }; }
function scale(img, s) { const w = Math.round(img.w * s), h = Math.round(img.h * s), o = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.min(img.w - 1, Math.floor(x / s)), sy = Math.min(img.h - 1, Math.floor(y / s)); const i = (sy * img.w + sx) * 4, j = (y * w + x) * 4; for (let k = 0; k < 4; k++) o[j + k] = img.d[i + k]; } return { w, h, d: o }; }
function zx(img) { const lum = new Uint8ClampedArray(img.w * img.h); for (let i = 0; i < lum.length; i++) lum[i] = (img.d[i * 4] * 0.299 + img.d[i * 4 + 1] * 0.587 + img.d[i * 4 + 2] * 0.114) | 0;
  const src = new Z.RGBLuminanceSource(lum, img.w, img.h); const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(src));
  const hints = new Map([[Z.DecodeHintType.TRY_HARDER, true]]); try { return new Z.QRCodeReader().decode(bmp, hints).getText(); } catch { return null; } }
for (const f of process.argv.slice(2)) {
  const img = load(f); const row = [];
  for (const s of [1, 0.6, 0.4]) { const im = s === 1 ? img : scale(img, s); const j = jsQR(im.d, im.w, im.h); row.push(`${s}x jsQR ${j ? "✓" : "✗"} zxing ${zx(im) ? "✓" : "✗"}`); }
  console.log(f.split("/").pop().padEnd(24), row.join(" | "));
}
