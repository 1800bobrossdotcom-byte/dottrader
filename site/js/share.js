// Dot Trading Post — the public pages' one script: the Share button on listing pages (the phone's
// share sheet where there is one, otherwise copy the link), NFT tiles that fall back cleanly, and
// a quiet offer of this page in the visitor's own language. Never a redirect: search engines and
// people who chose a language get exactly the page they asked for.
"use strict";
// The language menu closes when you tap elsewhere or press Escape.
Array.prototype.forEach.call(document.querySelectorAll("details.langmenu"), function (d) {
  document.addEventListener("click", function (e) { if (d.open && !d.contains(e.target)) d.open = false; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && d.open) { d.open = false; d.querySelector("summary").focus(); } });
});
// NFT artwork that can't be drawn turns back into the plain tile instead of a broken image.
Array.prototype.forEach.call(document.querySelectorAll("img[data-art]"), function (img) {
  var swap = function () { var s = document.createElement("span"); s.className = "noimg"; s.setAttribute("aria-hidden", "true"); img.replaceWith(s); };
  if (img.complete && !img.naturalWidth) swap(); else img.addEventListener("error", swap);
});
(function () {
  var b = document.querySelector("[data-share]");
  if (!b) return;
  b.hidden = false;
  b.addEventListener("click", function () {
    var url = location.origin + location.pathname, title = document.title.replace(/ \| Dot Trading Post$/, "");
    if (navigator.share) return navigator.share({ title: title, url: url }).catch(function () {});
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
      b.textContent = "Link copied"; setTimeout(function () { b.textContent = "Share"; }, 2000);
    }, function () { window.prompt("Copy this link:", url); });
  });
})();
(function () {
  var OFFER = {
    en: ["View this page in English?", "View in English"], es: ["¿Prefieres ver esta página en español?", "Ver en español"],
    ja: ["このページを日本語で表示しますか？", "日本語で見る"], pt: ["Prefere ver esta página em português?", "Ver em português"]
  };
  var base = function (l) { return String(l || "").toLowerCase().slice(0, 2); };
  var here = base(document.documentElement.lang), store = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  // Choosing a language from the footer is remembered, and the offer stops.
  Array.prototype.forEach.call(document.querySelectorAll(".langs a[hreflang], .langmenu a[hreflang]"), function (a) { a.addEventListener("click", function () { store("dtp-lang", base(a.getAttribute("hreflang"))); }); });
  var chosen = store("dtp-lang"), want = chosen;
  if (!want) { var ls = navigator.languages || [navigator.language]; for (var i = 0; i < ls.length && !want; i++) if (OFFER[base(ls[i])]) want = base(ls[i]); }
  if (!want || want === here || chosen === here || store("dtp-lang-offer") === want) return;
  var alt = document.querySelector('link[rel="alternate"][hreflang^="' + want + '"]');
  if (!alt) return;
  var bar = document.createElement("div"), t = OFFER[want];
  bar.setAttribute("lang", want); bar.setAttribute("role", "region"); bar.setAttribute("aria-label", t[1]);
  bar.style.cssText = "display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:9px 16px;background:#121212;color:#fff;font:600 14px/1.3 system-ui,sans-serif;text-align:center";
  var go = document.createElement("a"); go.href = alt.getAttribute("href"); go.textContent = t[1];
  go.style.cssText = "background:#FFD23F;color:#121212;border-radius:999px;padding:5px 12px;text-decoration:none";
  go.addEventListener("click", function () { store("dtp-lang", want); });
  var x = document.createElement("button"); x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Close");
  x.style.cssText = "background:none;border:0;color:#fff;font-size:20px;line-height:1;cursor:pointer;padding:0 4px";
  x.addEventListener("click", function () { store("dtp-lang-offer", want); bar.remove(); });
  var p = document.createElement("span"); p.textContent = t[0];
  bar.appendChild(p); bar.appendChild(go); bar.appendChild(x);
  document.body.insertBefore(bar, document.body.firstChild);
})();
