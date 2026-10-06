// Dot Trading Post — the sticker pack page: download, share, print a sheet at home.
"use strict";
(function () {
  var STICKERS = [
    { id: "diecut-logo", name: "The D", kind: "die", text: "The logo on halftone dots, with the name on a ribbon." },
    { id: "diecut-scan", name: "Scan to swap", kind: "die", text: "A card with the QR code, the D peeking over the corner." },
    { id: "diecut-physical-nft", name: "Physical for NFT", kind: "die", text: "A comic burst: a box for an NFT. No bridge, no cash." },
    { id: "square-pitch", name: "The pitch", kind: "square", text: "Trade anything for anything — the three ways to swap, and the QR code." },
    { id: "square-scan", name: "Big QR", kind: "square", text: "Scan to swap, big and yellow. Easy to read from across a table." },
    { id: "square-trade-me", name: "What would you trade?", kind: "square", text: "Write what you have and what you want, stick it on the thing." }
  ];
  var $ = function (id) { return document.getElementById(id); };
  var qty = {};
  try { qty = JSON.parse(localStorage.getItem("dtp-sticker-qty") || "{}") || {}; } catch (e) { qty = {}; }
  STICKERS.forEach(function (s) { if (typeof qty[s.id] !== "number") qty[s.id] = 1; });
  var saveQty = function () { try { localStorage.setItem("dtp-sticker-qty", JSON.stringify(qty)); } catch (e) {} };
  var toast = function (t) { var el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); el.textContent = t; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 2400); };

  // ---- the stickers ----
  var pack = $("pack");
  STICKERS.forEach(function (s) {
    var card = document.createElement("article"); card.className = "stk";
    card.innerHTML =
      '<div class="art' + (s.kind === "square" ? " sq" : "") + '"><img src="/stickers/' + s.id + '.png" alt="' + s.name + ' sticker" loading="lazy"></div>' +
      "<h3>" + s.name + '</h3><p>' + s.text + '</p><div class="meta">' + (s.kind === "die" ? "Die-cut · 3″" : "Square · 3″ × 3″") + "</div>" +
      '<div class="row"><a class="btn sm" href="/stickers/' + s.id + '.png" download>PNG</a><a class="btn ghost sm" href="/stickers/' + s.id + '.pdf" download>PDF</a>' +
      '<button class="btn ghost sm share" type="button" hidden>Share</button>' +
      '<label class="qty">To print <input type="number" min="0" max="24" value="' + qty[s.id] + '" aria-label="How many ' + s.name + ' to print"></label></div>';
    var input = card.querySelector("input");
    input.addEventListener("input", function () { qty[s.id] = Math.max(0, Math.min(24, parseInt(input.value, 10) || 0)); saveQty(); layout(); });
    // Sharing the image itself (AirDrop, Messages…) where the phone or browser can.
    var sb = card.querySelector(".share");
    if (navigator.canShare) {
      try { if (navigator.canShare({ files: [new File([new Blob(["x"], { type: "image/png" })], "x.png", { type: "image/png" })] })) sb.hidden = false; } catch (e) {}
    }
    sb.addEventListener("click", function () {
      fetch("/stickers/" + s.id + ".png").then(function (r) { return r.blob(); }).then(function (b) {
        var f = new File([b], "dot-trading-post-" + s.id + ".png", { type: "image/png" });
        return navigator.share({ files: [f], title: "Dot Trading Post sticker", text: "Trade anything for anything — dottrader.app" });
      }).catch(function () {});
    });
    pack.appendChild(card);
  });

  // ---- share the page ----
  $("sharePage").addEventListener("click", function () {
    var url = location.origin + "/stickers";
    if (navigator.share) return navigator.share({ title: "Dot Trading Post sticker pack", url: url }).catch(function () {});
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast("Link copied"); }, function () { window.prompt("Copy this link:", url); });
  });

  // ---- download all: a zip made in the browser (JSZip, pinned and integrity-checked) ----
  function loadZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.integrity = "sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG";
      s.crossOrigin = "anonymous"; s.onload = function () { ok(window.JSZip); }; s.onerror = no;
      document.head.appendChild(s);
    });
  }
  $("zipBtn").addEventListener("click", function () {
    var b = $("zipBtn"); b.disabled = true; b.textContent = "Packing…";
    loadZip().then(function (JSZip) {
      var zip = new JSZip(), files = [];
      STICKERS.forEach(function (s) { files.push(s.id + ".png", s.id + ".pdf"); if (s.kind === "die") files.push(s.id + "-cutline.png"); });
      return Promise.all(files.map(function (f) { return fetch("/stickers/" + f).then(function (r) { return r.blob(); }).then(function (blob) { zip.file(f, blob); }); })).then(function () {
        zip.file("README.txt", "Dot Trading Post stickers — dottrader.app\n\nDie-cut: upload the .png (transparent, white border; the printer cuts around it). -cutline.png shows the cut line.\nSquare: upload the .pdf, 3in x 3in, with 1/8in bleed included.\nEvery QR code opens https://dottrader.app\n");
        return zip.generateAsync({ type: "blob" });
      });
    }).then(function (blob) {
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "dot-trading-post-stickers.zip";
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      b.disabled = false; b.textContent = "Download all (.zip)";
    }).catch(function () { b.disabled = false; b.textContent = "Download all (.zip)"; toast("Couldn’t make the zip — download them one by one."); });
  });

  // ---- print at home: lay the chosen stickers out on real-size pages ----
  var PAPER = { letter: [8.5, 11], a4: [8.27, 11.69] }, MARGIN = 0.4, GAP = 0.15;
  var pageStyle = document.createElement("style"); document.head.appendChild(pageStyle);
  function layout() {
    var paper = PAPER[$("paper").value], s = Number($("size").value), cuts = $("cuts").checked;
    // A die-cut image is 3.2″ with its white border for a 3″ sticker; a square is 3.25″ with bleed.
    var cell = s * 3.2 / 3;
    var cols = Math.max(1, Math.floor((paper[0] - 2 * MARGIN + GAP) / (cell + GAP)));
    var rows = Math.max(1, Math.floor((paper[1] - 2 * MARGIN + GAP) / (cell + GAP)));
    var list = []; STICKERS.forEach(function (st) { for (var i = 0; i < (qty[st.id] || 0); i++) list.push(st); });
    var pages = []; for (var i = 0; i < list.length; i += cols * rows) pages.push(list.slice(i, i + cols * rows));
    pageStyle.textContent = "@page { size: " + (paper === PAPER.a4 ? "A4" : "letter") + "; margin: 0; }";
    var makeSheet = function (items) {
      var sh = document.createElement("div"); sh.className = "sheet";
      sh.style.cssText += "width:" + paper[0] + "in;height:" + paper[1] + "in;padding:" + MARGIN + "in;grid-template-columns:repeat(" + cols + "," + cell + "in);grid-auto-rows:" + cell + "in;gap:" + GAP + "in;";
      items.forEach(function (st) {
        var c = document.createElement("div"); c.className = "cell";
        if (st.kind === "die") c.innerHTML = '<img alt="" style="width:' + cell + 'in;height:' + cell + 'in" src="/stickers/' + st.id + (cuts ? "-cutline" : "") + '.png">';
        else c.innerHTML = '<div class="trim' + (cuts ? " cut" : "") + '" style="width:' + s + "in;height:" + s + 'in"><img alt="" style="position:absolute;width:' + (s * 3.25 / 3) + "in;height:" + (s * 3.25 / 3) + "in;left:-" + (s * 0.125 / 3) + "in;top:-" + (s * 0.125 / 3) + 'in" src="/stickers/' + st.id + '.png"></div>';
        sh.appendChild(c);
      });
      return sh;
    };
    var prev = $("previewer"), out = $("sheets"); prev.innerHTML = ""; out.innerHTML = "";
    var scale = Math.min(0.42, 300 / (paper[0] * 96));
    pages.forEach(function (items) {
      var wrap = document.createElement("div"); wrap.className = "scaler";
      wrap.style.width = paper[0] * 96 * scale + "px"; wrap.style.height = paper[1] * 96 * scale + "px";
      var sh = makeSheet(items); sh.style.transform = "scale(" + scale + ")"; wrap.appendChild(sh); prev.appendChild(wrap);
      out.appendChild(makeSheet(items));
    });
    $("sheetInfo").textContent = list.length
      ? list.length + (list.length === 1 ? " sticker" : " stickers") + " on " + pages.length + (pages.length === 1 ? " page" : " pages") + " · " + cols * rows + " fit on each page at " + s + "″."
      : "Set “To print” on the stickers above to lay out a sheet.";
    $("printBtn").disabled = !list.length;
  }
  ["paper", "size", "cuts"].forEach(function (id) { $(id).addEventListener("change", layout); });
  $("printBtn").addEventListener("click", function () { window.print(); });
  layout();
})();
