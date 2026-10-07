// Dot Trading Post — the board in the visitor's language: English, Spanish, Japanese or Brazilian
// Portuguese.
//
// One of the board's scripts, loaded first by app.html, after the strings (js/strings.js, built
// from i18n/app.<lang>.json by scripts/i18n-app.mjs). Every sentence the board shows is written
// in English in the code and looked up here: t("Mark my side sent"). The English is the key, so
// the code reads as it always did, and a missing translation falls back to English, never to a
// blank. The words each language uses are fixed in i18n/GLOSSARY.md.
"use strict";

var LANGS = ["en", "es", "ja", "pt"];
var LOCALE = { en: "en-US", es: "es-ES", ja: "ja-JP", pt: "pt-BR" };
var LANG_NAME = { en: "English", es: "Español", ja: "日本語", pt: "Português" };
// Chosen in this order: a link that says (?lang=es, from the translated pages), what the visitor
// chose before, then the phone's own language.
var LANG_CHOSEN = false;  // chosen on purpose (a link, the picker), not guessed from the phone
var LANG = (function () {
  var m = /[?&]lang=([a-z]{2})\b/.exec(location.search), pick = m && LANGS.indexOf(m[1]) >= 0 ? m[1] : null;
  try { if (pick) localStorage.setItem("dtp-lang", pick); else pick = localStorage.getItem("dtp-lang"); } catch (e) {}
  LANG_CHOSEN = LANGS.indexOf(pick) >= 0;
  if (LANGS.indexOf(pick) < 0) {
    pick = null;
    var ls = navigator.languages || [navigator.language];
    for (var i = 0; i < ls.length && !pick; i++) { var b = String(ls[i] || "").slice(0, 2).toLowerCase(); if (LANGS.indexOf(b) >= 0) pick = b; }
  }
  return pick || "en";
})();
var STR = ((window.DTP_I18N || {}).strings || {})[LANG] || {};
var norm = function (s) { return String(s).replace(/\s+/g, " ").trim(); };

// A sentence in the visitor's language; {name} placeholders filled from `vars`.
function t(s, vars) {
  var r = (LANG !== "en" && STR[s]) || s;
  if (vars) for (var k in vars) r = r.split("{" + k + "}").join(vars[k]);
  return r;
}
// One or many: tn(3, "{n} trade", "{n} trades").
function tn(n, one, other, vars) {
  var v = { n: n }; for (var k in vars || {}) v[k] = vars[k];
  return t(n === 1 ? one : other, v);
}
// Categories keep their English names in the data; only what is shown changes.
function catName(c) { var x = ((window.DTP_I18N || {}).cats || {})[c]; return (LANG !== "en" && x && x[LANG]) || c; }
function groupName(g) { var x = ((window.DTP_I18N || {}).groups || {})[g]; return (LANG !== "en" && x && x[LANG]) || g; }
// A public page (/item/…, /c/…) in the visitor's language.
function langPath(p) { return LANG === "en" ? p : "/" + LANG + p; }
function fmtDate(d, opts) { return new Date(d).toLocaleDateString(LOCALE[LANG], opts); }
function fmtDateTime(d) { return new Date(d).toLocaleString(LOCALE[LANG]); }
function setLang(l) {
  if (LANGS.indexOf(l) < 0) return;
  try { localStorage.setItem("dtp-lang", l); } catch (e) {}
  location.href = location.pathname + (l === "en" ? "?lang=en" : "?lang=" + l) + location.hash;
}

// The page as written in app.html, in the visitor's language: every phrase between tags and every
// placeholder, title and label. Elements whose sentence has markup inside it carry data-t, and are
// looked up whole.
(function translatePage() {
  document.documentElement.lang = LANG === "pt" ? "pt-BR" : LANG;
  if (LANG === "en") return;
  Array.prototype.forEach.call(document.querySelectorAll("[data-t]"), function (el) {
    var k = norm(el.innerHTML); if (STR[k]) el.innerHTML = STR[k];
  });
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) { var p = n.parentNode && n.parentNode.nodeName; return p === "SCRIPT" || p === "STYLE" || (n.parentNode.closest && n.parentNode.closest("[data-t]")) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
  });
  var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(function (n) {
    var k = norm(n.nodeValue); if (!k || !STR[k]) return;
    var lead = /^\s*/.exec(n.nodeValue)[0], tail = /\s*$/.exec(n.nodeValue)[0];
    n.nodeValue = lead + STR[k] + tail;
  });
  ["placeholder", "title", "aria-label", "alt"].forEach(function (a) {
    Array.prototype.forEach.call(document.querySelectorAll("[" + a + "]"), function (el) { var k = norm(el.getAttribute(a)); if (STR[k]) el.setAttribute(a, STR[k]); });
  });
  var tt = document.querySelector("title"); if (tt && STR[norm(tt.textContent)]) tt.textContent = STR[norm(tt.textContent)];
})();
