// Dot Trading Post — "Make a text graphic": for things a photo can't show (a skill, a service, a
// lesson, a favor), the trader's own words drawn as a Dot card and added as the listing's picture.
//
// One of the board's scripts, loaded in order by app.html (after post.js, whose photo list it adds
// to). The picture is 1200×900 like a photo; everything that matters sits in the middle 900×900,
// so the square crop of a small card on a phone still shows all of it.
"use strict";

var ART_THEMES = [
  { name: "Yellow", bg: "#FFD23F", dots: "rgba(18,18,18,.22)", pill: "#121212", pillText: "#FFD23F", tag: "#FFD23F", tagText: "#121212", mark: "#121212" },
  { name: "Blue", bg: "#2F56D6", dots: "rgba(255,252,244,.3)", pill: "#FFD23F", pillText: "#121212", tag: "#2F56D6", tagText: "#FFFCF4", mark: "#FFFCF4" },
  { name: "Red", bg: "#E8392B", dots: "rgba(18,18,18,.25)", pill: "#121212", pillText: "#FFFCF4", tag: "#E8392B", tagText: "#FFFCF4", mark: "#121212" },
  { name: "Green", bg: "#1DB36A", dots: "rgba(18,18,18,.22)", pill: "#FFFCF4", pillText: "#121212", tag: "#1DB36A", tagText: "#121212", mark: "#121212" },
  { name: "Pink", bg: "#F2518F", dots: "rgba(255,252,244,.32)", pill: "#121212", pillText: "#FFFCF4", tag: "#F2518F", tagText: "#121212", mark: "#121212" },
  { name: "Ink", bg: "#121212", dots: "rgba(255,210,63,.3)", pill: "#FFD23F", pillText: "#121212", tag: "#FFD23F", tagText: "#121212", mark: "#FFFCF4" }
];
var ART_W = 1200, ART_H = 900, INK = "#121212", PAPER = "#FFFCF4";

// Lines that fit maxW. Words wrap at spaces; a run with no spaces (Japanese, a long URL) breaks
// between characters.
function artWrap(ctx, text, maxW) {
  var lines = [], cur = "";
  text.split(/\s+/).filter(Boolean).forEach(function (word) {
    var tryLine = cur ? cur + " " + word : word;
    if (ctx.measureText(tryLine).width <= maxW) { cur = tryLine; return; }
    if (cur) { lines.push(cur); cur = ""; }
    if (ctx.measureText(word).width <= maxW) { cur = word; return; }
    Array.from(word).forEach(function (ch) {
      if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ""; }
      cur += ch;
    });
  });
  if (cur) lines.push(cur);
  return lines;
}

function drawArt(c, o) {
  var ctx = c.getContext("2d"), th = ART_THEMES[o.theme] || ART_THEMES[0];
  ctx.clearRect(0, 0, ART_W, ART_H);
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, ART_W, ART_H);
  // halftone dots, swelling toward two corners
  ctx.fillStyle = th.dots;
  for (var y = 12; y < ART_H; y += 26) for (var x = 12 + (y / 26 % 2) * 13; x < ART_W; x += 26) {
    var a = Math.hypot(ART_W - x, y) / 900, b = Math.hypot(x, ART_H - y) / 900;
    var r = 9 * Math.max(0, 1 - Math.min(a, b));
    if (r > 0.8) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); }
  }
  // the panel
  var px = 168, py = 92, pw = 864, ph = 660;
  ctx.fillStyle = INK; ctx.fillRect(px + 16, py + 16, pw, ph);
  ctx.fillStyle = PAPER; ctx.fillRect(px, py, pw, ph);
  ctx.lineWidth = 8; ctx.strokeStyle = INK; ctx.strokeRect(px, py, pw, ph);
  var inX = px + 52, inW = pw - 104, top = py + 52, bottom = py + ph - 48;
  // small label, top left
  var tag = (o.tag || "").trim().toUpperCase();
  if (tag) {
    ctx.font = "600 30px 'IBM Plex Mono', ui-monospace, monospace";
    var tw = Math.min(inW, ctx.measureText(tag).width + 40);
    ctx.fillStyle = th.tag; ctx.fillRect(inX, top, tw, 56);
    ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.strokeRect(inX, top, tw, 56);
    ctx.fillStyle = th.tagText; ctx.textBaseline = "middle"; ctx.fillText(tag, inX + 20, top + 30, tw - 40);
    top += 92;
  }
  // bottom line, in a pill
  var foot = (o.foot || "").trim();
  if (foot) {
    ctx.font = "500 36px 'IBM Plex Mono', ui-monospace, monospace";
    var fw = Math.min(inW, ctx.measureText(foot).width + 56);
    ctx.fillStyle = th.pill; roundRect(ctx, inX, bottom - 64, fw, 64, 32); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = th.pillText; ctx.textBaseline = "middle"; ctx.fillText(foot, inX + 28, bottom - 31, fw - 56);
    bottom -= 96;
  }
  // the big words: the largest size at which they fit
  var head = (o.head || "").trim() || " ", size = 132, lines;
  for (; size >= 44; size -= 4) {
    ctx.font = "700 " + size + "px 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
    lines = artWrap(ctx, head, inW);
    if (lines.length * size * 1.04 <= bottom - top) break;
  }
  var lh = size * 1.04, y0 = top + Math.max(0, (bottom - top - lines.length * lh) / 2);
  ctx.fillStyle = INK; ctx.textBaseline = "top";
  lines.forEach(function (l, i) { if (y0 + (i + 1) * lh <= bottom + size * 0.2) ctx.fillText(l, inX, y0 + i * lh); });
  // the Dot mark and name, under the panel
  ctx.save(); ctx.translate(ART_W / 2 - 190, 790); ctx.scale(1.3, 1.3);
  var d = new Path2D("M9 5h11a15 15 0 0 1 0 30H9z");
  ctx.fillStyle = "#FFD23F"; ctx.fill(d); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.lineJoin = "round"; ctx.stroke(d);
  ctx.beginPath(); ctx.arc(20, 20, 5.5, 0, 2 * Math.PI); ctx.fillStyle = "#E8392B"; ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.font = "700 34px 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
  ctx.fillStyle = th.mark; ctx.textBaseline = "middle";
  ctx.fillText("DOT TRADING POST", ART_W / 2 - 128, 816);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function openTextArt() {
  if (!uid || !sb) return toast(t("Sign in first."));
  if (pendingPhotos.length >= 4) return toast(t("Four photos is the limit."));
  var veil = document.createElement("div"); veil.className = "veil";
  var form = document.createElement("form"); form.className = "sheet f artsheet";
  form.innerHTML =
    "<h3>" + esc(t("Make a text graphic")) + "</h3>" +
    '<p class="hint" style="margin:0">' + esc(t("For what a photo can't show: a skill, a service, a lesson, a favor. Your words become the listing's picture.")) + "</p>" +
    '<canvas id="a-canvas" class="artcanvas" width="' + ART_W + '" height="' + ART_H + '" role="img" aria-label="' + esc(t("Preview")) + '"></canvas>' +
    '<div><label for="a-head">' + esc(t("Big words")) + '</label><input id="a-head" maxlength="70" required placeholder="' + esc(t("I'll build your website")) + '"></div>' +
    '<div class="rowf"><div><label for="a-tag">' + esc(t("Small label")) + '</label><input id="a-tag" maxlength="24"></div>' +
    '<div><label for="a-foot">' + esc(t("Bottom line")) + ' <span class="hint">' + esc(t("— a link, a name, a place")) + '</span></label><input id="a-foot" maxlength="40" placeholder="yoursite.com"></div></div>' +
    '<div><span class="lbl">' + esc(t("Color")) + '</span><div class="swatches" role="radiogroup" aria-label="' + esc(t("Color")) + '">' +
      ART_THEMES.map(function (th, i) { return '<button type="button" class="sw" role="radio" aria-checked="' + (i ? "false" : "true") + '" data-i="' + i + '" aria-label="' + esc(t(th.name)) + '" style="background:' + th.bg + '"></button>'; }).join("") + "</div></div>" +
    '<div class="acts"><button class="btn ok" type="submit">' + esc(t("Use this graphic")) + '</button><button class="btn ghost" type="button" data-x>' + esc(t("Cancel")) + "</button></div>";
  veil.appendChild(form); document.body.appendChild(veil);
  var q = function (id) { return form.querySelector("#" + id); }, theme = 0, c = q("a-canvas");
  q("a-head").value = $("f-title").value; q("a-tag").value = t("Will trade");
  var paint = function () { drawArt(c, { head: q("a-head").value, tag: q("a-tag").value, foot: q("a-foot").value, theme: theme }); };
  ["a-head", "a-tag", "a-foot"].forEach(function (id) { q(id).addEventListener("input", paint); });
  Array.prototype.forEach.call(form.querySelectorAll(".sw"), function (b) {
    b.addEventListener("click", function () {
      theme = Number(b.dataset.i);
      Array.prototype.forEach.call(form.querySelectorAll(".sw"), function (x) { x.setAttribute("aria-checked", String(x === b)); });
      paint();
    });
  });
  paint();
  // Draw again once the board's fonts are in, so the preview and the picture use them.
  if (document.fonts && document.fonts.load) Promise.all([document.fonts.load("700 80px 'Space Grotesk'"), document.fonts.load("500 30px 'IBM Plex Mono'")]).then(paint, function () {});
  var close = function () { veil.remove(); };
  form.querySelector("[data-x]").addEventListener("click", close);
  veil.addEventListener("click", function (e) { if (e.target === veil) close(); });
  form.addEventListener("submit", function (e) {
    e.preventDefault(); paint();
    var btn = form.querySelector("[type=submit]"); btn.disabled = true;
    new Promise(function (r) { c.toBlob(r, "image/png"); }).then(function (blob) {
      if (!blob) throw new Error(t("Couldn't make the picture on this browser."));
      return window.DTP_PHOTOS.upload(sb, uid, new File([blob], "graphic.png", { type: "image/png" }));
    }).then(function (url) {
      pendingPhotos.unshift(url); pendingPhotos.length = Math.min(pendingPhotos.length, 4); paintThumbs();
      if (!$("f-title").value.trim()) $("f-title").value = q("a-head").value.trim().slice(0, 80);
      if ($("f-cat").value === "Other" || !$("f-cat").value) $("f-cat").value = "Services & Skills";
      close(); toast(t("Added."));
    }).catch(function (err) { btn.disabled = false; toast((err && err.message) || t("A photo failed to upload.")); });
  });
  setTimeout(function () { q("a-head").focus(); }, 30);
}
$("f-makeart").addEventListener("click", openTextArt);
