// Builds the board's translations: i18n/app.<lang>.json → site/js/strings.js, which app.html loads
// before js/i18n.js.
//
//   node scripts/i18n-app.mjs            build (fails if any sentence the board shows has no translation)
//   node scripts/i18n-app.mjs --check    the same, but only report whether site/js/strings.js is current
//   node scripts/i18n-app.mjs --missing  print, as JSON, every sentence a language still needs
//
// The sentences are found where they are written: every phrase in app.html (between tags, and in
// placeholders, titles and labels), and every English string passed to t() or tn() in site/js and
// site/photos.js. A translation must keep the sentence's {placeholders}.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANGS = ["es", "ja", "pt"];
const mode = process.argv[2] || "";
const norm = (s) => s.replace(/\s+/g, " ").trim();
// Looked up by a variable, so not found by reading t("…") calls: the rank names (core.js RANKS).
const DYNAMIC = ["New trader", "Known", "Trusted", "Well vouched", "Pillar of the post"];
// Never translated: names, symbols, numbers, examples that are the same everywhere.
const SAME = /^(Dot Trading Post|NFT|NFTs|Priya|cbuy|English|Español|日本語|Português|Português \(Brasil\)|0x…|1234|123456|\?|0|×|[\s\d·⇄→+−&;:#%—–.,()"'/…]*|&minus;3|\+[12]|&[a-z]+;|Chain [0-9]+)$/;

function htmlKeys(html) {
  const keys = new Set();
  let body = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  // Elements whose sentence has markup inside are looked up whole (data-t).
  body = body.replace(/<(\w+)([^>]*\sdata-t\b[^>]*)>([\s\S]*?)<\/\1>/g, (m, tag, attrs, inner) => { keys.add(norm(inner)); return "<" + tag + attrs + "></" + tag + ">"; });
  // What the browser shows (and what js/i18n.js looks up) is the text with its entities decoded.
  const dec = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: "\u00a0" })[e]);
  for (const m of body.matchAll(/>([^<>]+)</g)) { const k = norm(dec(m[1])); if (k && !SAME.test(k)) keys.add(k); }
  for (const m of body.matchAll(/\s(?:placeholder|title|aria-label|alt)="([^"]+)"/g)) { const k = norm(dec(m[1])); if (k && !SAME.test(k)) keys.add(k); }
  const tt = /<title>([^<]+)<\/title>/.exec(html); if (tt && !SAME.test(norm(tt[1]))) keys.add(norm(tt[1]));
  return keys;
}

// The argument text of every t( … ) and tn( … ) call, then the string literals in it that are not
// inside a { … } of placeholder values.
function jsKeys(src, file) {
  const keys = new Set();
  const re = /(?<![\w$.])(t|tn|tr)\(/g; let m;  // tr: photos.js's own name for t
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 1, brace = 0, cur = null, buf = "", lits = [], cmp = false;
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (cur) {
        if (c === "\\") { buf += c + src[++i]; continue; }
        if (c === cur) { if (!brace && !cmp) lits.push(cur + buf + cur); cur = null; buf = ""; continue; }
        buf += c; continue;
      }
      // A string compared with (status === "agreed") is a value, not a sentence.
      if (c === '"' || c === "'") { cur = c; cmp = /[=!]=\s*$/.test(src.slice(Math.max(0, i - 6), i)); continue; }
      if (c === "(") depth++; else if (c === ")") depth--;
      else if (c === "{") brace++; else if (c === "}") brace--;
    }
    for (const lit of lits) {
      const body = lit.slice(1, -1).replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"');
      let v; try { v = JSON.parse('"' + body + '"'); } catch (e) { throw new Error(file + ": cannot read the string " + lit); }
      if (v && !SAME.test(v)) keys.add(v);
    }
  }
  return keys;
}

const keys = new Set([...htmlKeys(fs.readFileSync(path.join(ROOT, "site/app.html"), "utf8")), ...DYNAMIC]);
const files = fs.readdirSync(path.join(ROOT, "site/js")).filter((f) => f.endsWith(".js") && !["i18n.js", "strings.js", "stickers.js", "share.js"].includes(f)).map((f) => "site/js/" + f).concat("site/photos.js");
for (const f of files) for (const k of jsKeys(fs.readFileSync(path.join(ROOT, f), "utf8"), f)) keys.add(k);
const all = [...keys].sort();
const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join();

let failed = false;
const strings = {}, missingOut = {};
for (const lang of LANGS) {
  const file = path.join(ROOT, "i18n/app." + lang + ".json");
  const tr = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const missing = all.filter((k) => !tr[k]), stale = Object.keys(tr).filter((k) => !keys.has(k));
  const broken = all.filter((k) => tr[k] && holes(tr[k]) !== holes(k));
  missingOut[lang] = Object.fromEntries(missing.map((k) => [k, ""]));
  if (mode === "--missing") continue;
  if (missing.length || stale.length || broken.length) {
    failed = true;
    if (missing.length) console.error(lang + ": " + missing.length + " sentences with no translation, e.g.\n  " + missing.slice(0, 8).join("\n  "));
    if (stale.length) console.error(lang + ": translations of sentences the board no longer shows:\n  " + stale.join("\n  "));
    if (broken.length) console.error(lang + ": translations that lose or add a {placeholder}:\n  " + broken.join("\n  "));
  }
  strings[lang] = Object.fromEntries(all.filter((k) => tr[k]).map((k) => [k, tr[k]]));
}
if (mode === "--missing") { console.log(JSON.stringify(missingOut, null, 2)); process.exit(0); }
const cats = JSON.parse(fs.readFileSync(path.join(ROOT, "site/i18n/cats.json"), "utf8"));
const out = "// Built by scripts/i18n-app.mjs from i18n/app.<lang>.json and site/i18n/cats.json. Edit those, not this.\n" +
  "window.DTP_I18N = " + JSON.stringify({ cats: cats.cats, groups: cats.groups, strings }) + ";\n";
const target = path.join(ROOT, "site/js/strings.js");
if (mode === "--check") {
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== out) { failed = true; console.error("site/js/strings.js is out of date — run node scripts/i18n-app.mjs"); }
} else if (!failed) fs.writeFileSync(target, out);
if (failed) process.exit(1);
console.log((mode === "--check" ? "app strings are current" : "built site/js/strings.js") + " — " + all.length + " sentences in " + LANGS.length + " languages");
