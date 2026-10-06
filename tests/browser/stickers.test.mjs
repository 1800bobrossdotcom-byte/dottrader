// The sticker pack page (/stickers): the six stickers, downloads, the zip, the print sheet, phones.
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium, VENDOR, OUT, ROOT, CSP } from "./harness.mjs";

const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));
const URL0 = "http://127.0.0.1:8765/stickers.html";

// JSZip from the exact address and hash stickers.js pins.
const js = fs.readFileSync(ROOT + "/site/js/stickers.js", "utf8");
const zipUrl = js.match(/s\.src = "([^"]+jszip[^"]+)"/)[1], zipSri = js.match(/s\.integrity = "([^"]+)"/)[1];
const zipFile = VENDOR + "/jszip.js";
const good = (buf) => "sha384-" + crypto.createHash("sha384").update(buf).digest("base64") === zipSri;
if (!fs.existsSync(zipFile) || !good(fs.readFileSync(zipFile))) {
  const buf = Buffer.from(await (await fetch(zipUrl)).arrayBuffer());
  if (!good(buf)) throw new Error("jszip does not match its integrity hash");
  fs.writeFileSync(zipFile, buf);
}

async function open(b, viewport) {
  const ctx = await b.newContext({ viewport, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => res.push("PAGEERROR " + e.message));
  p.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) res.push("CSPVIOLATION " + m.text().slice(0, 200)); });
  await p.route(/127\.0\.0\.1:8765\/stickers\.html/, async (r) => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
  await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route(/cdnjs\.cloudflare\.com\/.*jszip/, (r) => r.fulfill({ path: zipFile, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } }));
  await p.goto(URL0, { waitUntil: "load" });
  await p.waitForFunction(() => [...document.images].every((i) => i.complete));
  return { ctx, p };
}

const b = await chromium.launch({});
const { ctx, p } = await open(b, { width: 1200, height: 1000 });

// The pack
const cards = await p.$$eval("#pack .stk", (els) => els.map((e) => ({ name: e.querySelector("h3").textContent, w: e.querySelector(".art img").naturalWidth, links: [...e.querySelectorAll("a[download]")].map((a) => a.getAttribute("href")) })));
ok("six stickers shown", cards.length === 6, cards.map((c) => c.name).join(", "));
ok("every sticker image loads", cards.every((c) => c.w > 0));
const links = cards.flatMap((c) => c.links);
const codes = await Promise.all(links.map((l) => fetch("http://127.0.0.1:8765" + l).then((r) => r.status)));
ok("each has a PNG and a PDF that download", links.length === 12 && codes.every((c) => c === 200), codes.join(","));
ok("the link preview image exists", fs.existsSync(ROOT + "/site/stickers/pack-preview.png"));
await p.screenshot({ path: OUT + "/stickers-desktop.png", fullPage: true });

// The print sheet
const info = () => p.textContent("#sheetInfo");
ok("one of each fits one Letter page at 3″", /6 stickers on 1 page · 6 fit on each page at 3″/.test(await info()), await info());
await p.selectOption("#size", "2");
ok("twelve fit at 2″", /12 fit on each page at 2″/.test(await info()), await info());
await p.selectOption("#size", "3"); await p.selectOption("#paper", "a4");
ok("A4 at 3″ fits six", /6 fit on each page/.test(await info()), await info());
await p.fill('#pack .stk:nth-child(5) input[type=number]', "3");
ok("more copies spill onto a second page", /8 stickers on 2 pages/.test(await info()), await info());
ok("the preview shows two sheets", (await p.$$("#previewer .sheet")).length === 2);
await p.reload({ waitUntil: "load" });
ok("copies are remembered", (await p.inputValue('#pack .stk:nth-child(5) input[type=number]')) === "3" && /8 stickers/.test(await info()), await info());
await p.selectOption("#paper", "letter");

// Printed: only the sheets, at real size
await p.emulateMedia({ media: "print" });
const pr = await p.evaluate(() => {
  const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== "none"; };
  const die = document.querySelector('#sheets img[src*="diecut"]'), trim = document.querySelector("#sheets .trim");
  return { main: vis("main"), header: vis("header"), sheets: vis("#sheets"), n: document.querySelectorAll("#sheets .sheet").length,
    die: die && die.getBoundingClientRect().width, trim: trim && trim.getBoundingClientRect().width, cut: !!document.querySelector('#sheets img[src*="-cutline"]') };
});
ok("printing shows only the sheets", !pr.main && !pr.header && pr.sheets && pr.n === 2, JSON.stringify(pr));
ok("die-cut prints 3.2″ with its border, square trims to 3″", Math.abs(pr.die - 3.2 * 96) < 1 && Math.abs(pr.trim - 3 * 96) < 1, pr.die + " / " + pr.trim);
ok("cut lines on by default", pr.cut);
const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
fs.writeFileSync(OUT + "/stickers-print.pdf", pdf);
const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
const box = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/);
ok("prints two Letter pages", pages === 2 && box && Math.round(+box[1]) === 612 && Math.round(+box[2]) === 792, pages + " pages, " + (box && box.slice(1).join("×")));
await p.emulateMedia({ media: "screen" });
await p.uncheck("#cuts");
ok("cut lines can be turned off", !(await p.$('#sheets img[src*="-cutline"]')) && !(await p.$("#sheets .trim.cut")));

// Download all
const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), p.click("#zipBtn")]);
const zp = OUT + "/stickers.zip"; await dl.saveAs(zp);
const list = execFileSync("python3", ["-c", "import sys,zipfile;print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", zp]).toString().trim().split("\n");
ok("the zip has every file and a readme", dl.suggestedFilename() === "dot-trading-post-stickers.zip" && list.length === 16 && list.includes("README.txt") && list.includes("diecut-scan-cutline.png"), list.length + " files");
ok("the zip button resets", (await p.textContent("#zipBtn")) === "Download all (.zip)");
await ctx.close();

// A phone
const m = await open(b, { width: 375, height: 800 });
const sw = await m.p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
ok("no sideways scroll on a phone", sw[0] <= sw[1], sw.join(" vs "));
await m.p.screenshot({ path: OUT + "/stickers-phone.png", fullPage: true });
await m.ctx.close();

await b.close();
console.log(res.join("\n"));
process.exit(res.some((r) => !r.startsWith("PASS")) ? 1 : 0);
