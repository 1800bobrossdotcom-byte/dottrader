// Renders ad.html into an MP4, frame by frame, so the motion is exact whatever the machine.
//
//   node marketing/investor-ad/render.mjs                 → out/dot-investor-ad.mp4 (1920×1080, 30 fps)
//   node marketing/investor-ad/render.mjs --square        → also a 1080×1080 cut for social feeds
//   FFMPEG=/path/to/ffmpeg node marketing/investor-ad/render.mjs
//
// Needs Playwright (the browser tests use it) and ffmpeg (on the PATH, in FFMPEG, or `npm i
// ffmpeg-static` somewhere and point FFMPEG at it). Fonts are fetched from Google Fonts once into
// fonts/, which git ignores, so the brand type renders exactly.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "out");
const FPS = 30;
const ffmpeg = process.env.FFMPEG || "ffmpeg";
const square = process.argv.includes("--square");

let pw;
try { pw = await import("playwright"); }
catch { pw = await import(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.mjs"); }
const exe = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

// The brand fonts, Latin subset, saved next to the page.
async function fonts() {
  const dir = path.join(here, "fonts"), css = path.join(here, "fonts.css");
  if (fs.existsSync(css)) return;
  fs.mkdirSync(dir, { recursive: true });
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
  const src = await (await fetch("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=block", { headers: { "user-agent": ua } })).text();
  const out = [];
  for (const [, sub, block] of src.matchAll(/\/\* ([\w-]+) \*\/\s*(@font-face \{[\s\S]*?\})/g)) {
    if (sub !== "latin") continue;
    const url = /url\((https:[^)]+)\)/.exec(block)[1];
    const name = /font-family: '([^']+)'/.exec(block)[1].replace(/ /g, "") + "-" + /font-weight: (\d+)/.exec(block)[1] + ".woff2";
    fs.writeFileSync(path.join(dir, name), Buffer.from(await (await fetch(url)).arrayBuffer()));
    out.push(block.replace(url, "fonts/" + name));
  }
  fs.writeFileSync(css, out.join("\n"));
}

async function encode(file, w, h, crop) {
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto("file://" + path.join(here, "ad.html") + "?frames=1");
  await page.evaluate(() => document.fonts.ready);
  const duration = await page.evaluate(() => window.DURATION);
  const vf = crop ? `crop=1080:1080:420:0,scale=${w}:${h}` : `scale=${w}:${h}`;
  const ff = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
    "-vf", vf + ",format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((ok, no) => ff.on("close", (c) => (c === 0 ? ok() : no(new Error("ffmpeg exited " + c)))));
  const frames = Math.round(duration * FPS);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.render(t), i / FPS);
    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % (FPS * 5) === 0) process.stdout.write(`  ${path.basename(file)} ${Math.round(i / FPS)}s/${duration}s\n`);
  }
  ff.stdin.end(); await done; await browser.close();
}

// Stills of key moments, for a poster frame and a quick look without playing the video.
async function stills(times) {
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto("file://" + path.join(here, "ad.html") + "?frames=1");
  await page.evaluate(() => document.fonts.ready);
  for (const t of times) {
    await page.evaluate((x) => window.render(x), t);
    await page.screenshot({ path: path.join(OUT, `still-${String(t).replace(".", "_")}s.png`), clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  }
  await browser.close();
}

await fonts();
fs.mkdirSync(OUT, { recursive: true });
try { execFileSync(ffmpeg, ["-version"], { stdio: "ignore" }); } catch { console.error("ffmpeg not found — set FFMPEG to its path"); process.exit(1); }
if (process.argv.includes("--stills")) { await stills([3, 8, 12.4, 19.5, 25.5, 30, 36, 41]); process.exit(0); }
await encode(path.join(OUT, "dot-investor-ad.mp4"), 1920, 1080, false);
if (square) await encode(path.join(OUT, "dot-investor-ad-square.mp4"), 1080, 1080, true);
console.log("done:", fs.readdirSync(OUT).filter((f) => f.endsWith(".mp4")).join(", "));
