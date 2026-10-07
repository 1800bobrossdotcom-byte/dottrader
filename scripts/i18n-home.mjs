// Builds the homepage in other languages from the English one: site/index.html → site/es/index.html,
// site/ja/index.html, site/pt/index.html, using the translations in i18n/home.<lang>.json.
//
//   node scripts/i18n-home.mjs          build all three (fails if anything English is left over)
//   node scripts/i18n-home.mjs --check  the same, but only report whether the built pages are current
//   node scripts/i18n-home.mjs --keys   list every English phrase on the page that needs a translation
//
// Each translation is keyed by the English it replaces: a phrase between tags, an attribute value,
// or (where a sentence has markup inside it) the whole fragment. If the English changes, the old
// key no longer matches and the build stops, so a translation can't silently go stale.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.dottrader.app";
const NAMES = { es: "Español", ja: "日本語", pt: "Português" };
const LANGS = { es: { hreflang: "es", og: "es_ES" }, ja: { hreflang: "ja", og: "ja_JP" }, pt: { hreflang: "pt-BR", og: "pt_BR" } };
const CATS = JSON.parse(fs.readFileSync(path.join(ROOT, "site/i18n/cats.json"), "utf8")).cats;
const en = fs.readFileSync(path.join(ROOT, "site/index.html"), "utf8");
const mode = process.argv[2] || "";

// Text that is the same in every language: names, symbols, numbers.
const SAME = /^(Dot Trading Post|dottrader|cbuy|NFT|NFTs|P|Priya|English|Español|日本語|Português|[\s\d·⇄→+−&;:#%—–.,()"'/]*|&minus;3|\+[12]|0|&[a-z]+;)$/;

// Every phrase a reader sees: text between tags (outside style/script) and the attributes that are read.
function phrases(html) {
  const out = new Set();
  const body = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/g, "");
  for (const m of body.matchAll(/>([^<>]+)</g)) { const t = m[1].trim(); if (t && !SAME.test(t) && !/^\{/.test(t)) out.add(t); }
  for (const m of body.matchAll(/\s(?:alt|title|aria-label|placeholder)="([^"]+)"/g)) if (!SAME.test(m[1])) out.add(m[1]);
  for (const m of body.matchAll(/<meta (?:name|property)="(?:description|og:title|og:description|og:image:alt|twitter:title|twitter:description)" content="([^"]+)"/g)) out.add(m[1]);
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  if (ld) for (const m of ld[1].matchAll(/"description":"([^"]+)"/g)) out.add(m[1]);
  return [...out];
}

if (mode === "--keys") { console.log(phrases(en).join("\n")); process.exit(0); }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let failed = false;
for (const [lang, meta] of Object.entries(LANGS)) {
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n/home." + lang + ".json"), "utf8"));
  // Category names come from the shared list, so the homepage and the category pages agree.
  for (const [c, names] of Object.entries(CATS)) if (!tr[c.replace(/&/g, "&amp;")]) tr[c.replace(/&/g, "&amp;")] = names[lang].replace(/&/g, "&amp;");
  let out = en;
  const unused = [];
  // Longest first, so a sentence is replaced before any shorter phrase inside it.
  for (const k of Object.keys(tr).sort((a, b) => b.length - a.length)) {
    const v = tr[k];
    const re = k.includes("<")
      ? new RegExp(esc(k), "g")
      : new RegExp("(?<=>\\s*|=\"|\":\")" + esc(k) + "(?=\\s*<|\")", "g");
    if (!re.test(out)) { unused.push(k); continue; }
    out = out.replace(re, () => v);
  }
  // Links stay in the language: this site's pages get the prefix, the board is told the language.
  out = out.replace(/href="\/(c|trade)(?=[/"#?])/g, 'href="/' + lang + "/$1")
    .replace(/<a class="brand" href="\/"/, '<a class="brand" href="/' + lang + '/"')
    .replace(/href="\/app(?=[#"])/g, 'href="/app?lang=' + lang)
    .replace(/<html lang="en">/, '<html lang="' + meta.hreflang + '">')
    .replace('<link rel="canonical" href="' + SITE + '/">', '<link rel="canonical" href="' + SITE + "/" + lang + '/">')
    .replace('<meta property="og:url" content="' + SITE + '/">', '<meta property="og:url" content="' + SITE + "/" + lang + '/">')
    .replace('<meta property="og:locale" content="en_US">', '<meta property="og:locale" content="' + meta.og + '">')
    .split(' aria-current="true">English').join(">English")
    .split('hreflang="' + meta.hreflang + '" lang="' + meta.hreflang + '">').join('hreflang="' + meta.hreflang + '" lang="' + meta.hreflang + '" aria-current="true">')
    .replace('<span class="lm-cur">English</span>', '<span class="lm-cur">' + NAMES[lang] + "</span>")
    .replace(/"inLanguage":"en"/g, '"inLanguage":"' + meta.hreflang + '"');
  out = out.replace("<!doctype html>", "<!doctype html>\n<!-- Built from site/index.html and i18n/home." + lang + ".json by scripts/i18n-home.mjs. Edit those, not this. -->");
  const left = phrases(out).filter((p) => phrases(en).includes(p) && !tr[p] && !SAME.test(p));
  if (unused.length || left.length) {
    failed = true;
    if (unused.length) console.error(lang + ": translations whose English is no longer on the page:\n  " + unused.join("\n  "));
    if (left.length) console.error(lang + ": English with no translation:\n  " + left.join("\n  "));
  }
  const file = path.join(ROOT, "site", lang, "index.html");
  if (mode === "--check") {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== out) { failed = true; console.error(lang + ": site/" + lang + "/index.html is out of date — run node scripts/i18n-home.mjs"); }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, out);
  }
}
if (failed) process.exit(1);
console.log(mode === "--check" ? "translated homepages are current" : "built site/es, site/ja, site/pt");
