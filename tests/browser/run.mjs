// Runs every browser test against the site served from site/ on 127.0.0.1:8765, with the
// database and every outside service faked inside each test. Run: npm run test:browser
// Optional: name some tests to run only those, e.g. `npm run test:browser -- offers matching`.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT } from "./harness.mjs";

const SITE = path.join(ROOT, "site");
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json", ".pdf": "application/pdf" };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(SITE, p === "/" ? "index.html" : p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(8765, "127.0.0.1", r));

const here = path.dirname(new URL(import.meta.url).pathname);
const only = process.argv.slice(2);
const tests = fs.readdirSync(here).filter((f) => f.endsWith(".test.mjs") && (!only.length || only.some((o) => f.startsWith(o))));
let failed = 0;
for (const t of tests) {
  // Run each test as its own process, without blocking: this process is also serving the site.
  const r = await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(here, t)]); let stdout = "", stderr = "";
    const kill = setTimeout(() => c.kill(), 300000);
    c.stdout.on("data", (d) => (stdout += d)); c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (status) => { clearTimeout(kill); resolve({ status, stdout, stderr }); });
  });
  const lines = (r.stdout + r.stderr).split("\n");
  const pass = lines.filter((l) => l.startsWith("PASS")).length;
  const bad = lines.filter((l) => /^(FAIL|PAGEERROR)/.test(l) || /^\S*Error\b/.test(l));
  const ok = r.status === 0 && pass > 0 && !bad.length;
  if (!ok) failed++;
  console.log((ok ? "ok   " : "FAIL ") + t.replace(".test.mjs", "") + " (" + pass + " checks)");
  if (!ok) console.log((bad.length ? bad : lines.slice(-15)).map((l) => "     " + l).join("\n"));
}
server.close();
process.exit(failed ? 1 : 0);
