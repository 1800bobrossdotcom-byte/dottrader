// The homepage in Spanish, Japanese and Portuguese, and the quiet offer of your own language.
import { chromium, OUT, CSP } from "./harness.mjs";
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : ""));
const b = await chromium.launch({});
async function open(url, locale, width) {
  const ctx = await b.newContext({ locale, viewport: { width: width || 1100, height: 900 } }); const p = await ctx.newPage();
  p.on("pageerror", (e) => res.push("PAGEERROR " + e.message));
  p.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) res.push("CSPVIOLATION " + m.text().slice(0, 200)); });
  await p.route(/127\.0\.0\.1:8765\/(es\/|ja\/|pt\/)?(index\.html)?$/, async (r) => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
  await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.goto("http://127.0.0.1:8765" + url, { waitUntil: "load" }); await p.waitForTimeout(300);
  return { ctx, p };
}
for (const [lang, h, word] of [["es", "es", "Cambia"], ["ja", "ja", "なんでも"], ["pt", "pt-BR", "Troque"]]) {
  const { ctx, p } = await open("/" + lang + "/", h);
  const info = await p.evaluate(() => ({ lang: document.documentElement.lang, h1: document.querySelector("h1").textContent, canon: document.querySelector('link[rel=canonical]').href,
    cur: (document.querySelector(".langs [aria-current]") || {}).textContent, board: document.querySelector(".navbtn").getAttribute("href"), bar: !!document.querySelector('[role=region][lang]'),
    cat: document.querySelector('a.cat[href$="/c/trading-cards"]').getAttribute("href") }));
  ok(lang + ": the homepage is in " + h, info.lang === h && info.h1.includes(word) && info.canon === "https://www.dottrader.app/" + lang + "/", JSON.stringify(info));
  ok(lang + ": its links stay in the language, and the board is told", info.cat === "/" + lang + "/c/trading-cards" && info.board === "/app?lang=" + lang && info.cur, info.cat + " " + info.board);
  ok(lang + ": no language offer for someone who reads it", !info.bar);
  await ctx.close();
  const phone = await open("/" + lang + "/", h, 375);
  const sw = await phone.p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok(lang + ": fits a phone", sw[0] <= sw[1], sw.join(" vs "));
  await phone.p.screenshot({ path: OUT + "/home-" + lang + "-phone.png" });
  await phone.ctx.close();
}
{
  const { ctx, p } = await open("/", "es-ES");
  const bar = await p.$('[role=region][lang="es"]');
  ok("a Spanish phone on the English page is offered Spanish, not sent there", bar && (await bar.$eval("a", (a) => a.getAttribute("href"))) === "https://www.dottrader.app/es/" && (await p.evaluate(() => document.documentElement.lang)) === "en");
  await bar.$eval("button", (x) => x.click());
  await p.reload({ waitUntil: "load" }); await p.waitForTimeout(300);
  ok("…and once closed, it stays closed", !(await p.$("[role=region][lang]")));
  await ctx.close();
}
{
  const { ctx, p } = await open("/es/", "en-US");
  await p.click('.langs a[hreflang="pt-BR"]'); await p.waitForTimeout(400);
  ok("choosing a language in the footer goes there and is remembered", p.url().endsWith("/pt/") && (await p.evaluate(() => localStorage.getItem("dtp-lang"))) === "pt" && !(await p.$("[role=region][lang]")));
  await ctx.close();
}
await b.close();
console.log(res.join("\n"));
process.exit(res.some((r) => !r.startsWith("PASS")) ? 1 : 0);
