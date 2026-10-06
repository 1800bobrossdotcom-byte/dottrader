// Shared set-up for the browser tests: where things are, the browser, and the two libraries the
// board loads from CDNs. Those are fetched once into tests/browser/.vendor from the exact URLs
// app.html pins, and checked against app.html's integrity hashes, so the tests run the same bytes
// a visitor's browser would accept.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
export const VENDOR = path.join(here, ".vendor");
export const OUT = path.join(here, ".out");
fs.mkdirSync(VENDOR, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// The live site's content-security policy, so every page is tested under the real rules.
export const CSP = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"))
  .headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;

const app = fs.readFileSync(path.join(ROOT, "site/app.html"), "utf8");
const pins = [...app.matchAll(/<script src="(https:\/\/[^"]+)" integrity="(sha384-[^"]+)"/g)].map((m) => ({ url: m[1], sri: m[2] }));
const local = { supabase: "supabase.js", ethers: "ethers.js" };
for (const pin of pins) {
  const name = /supabase/.test(pin.url) ? local.supabase : /ethers/.test(pin.url) ? local.ethers : null;
  if (!name) continue;
  const file = path.join(VENDOR, name);
  const ok = (buf) => "sha384-" + crypto.createHash("sha384").update(buf).digest("base64") === pin.sri;
  if (fs.existsSync(file) && ok(fs.readFileSync(file))) continue;
  const r = await fetch(pin.url);
  if (!r.ok) throw new Error("could not fetch " + pin.url + ": " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!ok(buf)) throw new Error(pin.url + " does not match the integrity hash in app.html");
  fs.writeFileSync(file, buf);
}

// Playwright from the project, or from wherever PLAYWRIGHT_MODULE points (e.g. a global install).
let pw;
try { pw = await import("playwright"); }
catch { pw = await import(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.mjs"); }
const exe = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : null);
export const chromium = { launch: (o = {}) => pw.chromium.launch({ ...o, ...(exe ? { executablePath: exe } : {}) }) };
