// Dot Trading Post — Shared state, formatting, toasts, and dialog accessibility.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

var sb = null, uid = null, myEmail = "";
var items = [], offers = [], signals = [], profiles = {}, badges = {};
var profTouched = false, profNotifySet = false;
// What this project has switched on. Each is probed once at boot, so the board never offers a
// button whose back end is missing (the old failure: write the note, take the photo, then hear
// the checker does not exist).
var caps = { photos: true, location: true, messages: true, verify: true, trades: false, bond: null, matching: false, notify: false, giveItems: false, history: false };
var bondsBy = {}, payouts = [], settledOnce = {};
var SYMBOL = { 1: "ETH", 8453: "ETH", 42161: "ETH", 10: "ETH", 7777777: "ETH", 137: "POL", 56: "BNB", 43114: "AVAX" };
var msgs = {}, threadOpen = {}, drafts = {}, seen = {};
var afterAuth = null;
var baseTitle = document.title;
var filter = { q: "", cat: "", radius: 0 };
// Distance between two rough points, in miles.
function miles(a, b, c, d) {
  var R = 3958.8, toR = Math.PI / 180, dLat = (c - a) * toR, dLng = (d - b) * toR;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a * toR) * Math.cos(c * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
function locOf(id) { var p = profiles[id]; return p && typeof p.lat === "number" && typeof p.lng === "number" ? { lat: p.lat, lng: p.lng } : null; }
function distTo(id) { var me = locOf(uid), them = locOf(id); return me && them ? miles(me.lat, me.lng, them.lat, them.lng) : null; }
function fmtMiles(m) { return m < 1 ? "under a mile" : Math.round(m) + " mi"; }

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function ago(t) {
  if (!t) return "";
  var s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 5400) return Math.round(s / 60) + "m ago";
  if (s < 172800) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}
function who(id) {
  if (id && uid && id === uid) return "You";
  var p = profiles[id];
  return (p && p.name) || "Someone";
}
var toastT = null;
// One polite live region for everything the board says in a toast, so screen readers hear it.
var liveRegion = document.createElement("div"); liveRegion.className = "sr"; liveRegion.setAttribute("role", "status"); liveRegion.setAttribute("aria-live", "polite");
document.body.appendChild(liveRegion);
// Every sheet is a dialog: labelled by its heading, focus moved in and given back, Escape closes
// it (except the new-password sheet, which must be finished).
var focusStack = [];
new MutationObserver(function (muts) {
  muts.forEach(function (m) {
    Array.prototype.forEach.call(m.addedNodes, function (n) {
      if (n.nodeType !== 1 || !n.classList.contains("veil")) return;
      var box = n.firstElementChild; if (!box) return;
      box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      var h = box.querySelector("h3"); if (h) box.setAttribute("aria-label", h.textContent);
      focusStack.push(document.activeElement);
      setTimeout(function () { if (!box.contains(document.activeElement)) { var f = box.querySelector("input, select, textarea, button"); if (f) f.focus(); } }, 60);
    });
    Array.prototype.forEach.call(m.removedNodes, function (n) {
      if (n.nodeType !== 1 || !n.classList.contains("veil")) return;
      var back = focusStack.pop(); if (back && back.focus && document.contains(back)) back.focus();
    });
  });
}).observe(document.body, { childList: true });
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  var vs = document.querySelectorAll("body > .veil"), v = vs[vs.length - 1]; if (!v) return;
  var x = v.querySelector("[data-x]"); if (x) { e.preventDefault(); x.click(); }
});
function toast(msg) {
  var old = document.querySelector(".toast"); if (old) old.remove();
  var el = document.createElement("div"); el.className = "toast"; el.textContent = msg; el.setAttribute("aria-hidden", "true");
  if (liveRegion) { liveRegion.textContent = ""; setTimeout(function () { liveRegion.textContent = msg; }, 30); }
  document.body.appendChild(el);
  clearTimeout(toastT); toastT = setTimeout(function () { el.remove(); }, 2800);
}
function note(html, kind) {
  var n = $("status"); n.innerHTML = html; n.className = "note" + (kind ? " " + kind : ""); n.hidden = false;
}
