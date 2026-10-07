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
// Visits since launch and members, at the foot of the page (supabase/stats.sql). Counting a visit
// sends no cookie: the database recognises a browser for one day, then forgets it.
(function () {
  var box = document.getElementById("siteStats"); if (!box || !window.fetch) return;
  var SB = "https://yujxwfghmauajrpduagl.supabase.co", KEY = "sb_publishable_3bOvzS08UOQsu1376idqDg_XHPmOgfp";
  var WORDS = { en: ["visit", "visits", "member", "members"], es: ["visita", "visitas", "miembro", "miembros"],
    ja: ["回の訪問", "回の訪問", "人のメンバー", "人のメンバー"], pt: ["visita", "visitas", "membro", "membros"] };
  var lang = String(document.documentElement.lang || "en").slice(0, 2), w = WORDS[lang] || WORDS.en;
  var id = null; try { id = localStorage.getItem("dtp-vid"); if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); localStorage.setItem("dtp-vid", id); } } catch (e) {}
  fetch(SB + "/rest/v1/rpc/note_visit", { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify({ p_client: id }) })
    .then(function (r) { return r.ok ? r.json() : null; }).then(function (rows) {
      var c = Array.isArray(rows) ? rows[0] : rows; if (!c) return;
      var fmt = function (n) { try { return new Intl.NumberFormat(document.documentElement.lang || "en").format(n); } catch (e) { return String(n); } };
      var chip = function (n, one, many) { var s = document.createElement("span"), b = document.createElement("b"); b.textContent = fmt(n); s.appendChild(b); s.appendChild(document.createTextNode(" " + (Number(n) === 1 ? one : many))); return s; };
      box.textContent = ""; box.appendChild(chip(c.visits, w[0], w[1])); box.appendChild(chip(c.members, w[2], w[3])); box.hidden = false;
    }).catch(function () {});
})();

