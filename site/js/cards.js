// Dot Trading Post — Listing cards, the photo gallery, and offer cards.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

// A chain chip that links to the explorer, plus a badge the viewer's own browser fills in once
// the chain has answered. It starts as "checking" rather than as a verdict, because claiming an
// asset is unheld before the RPC replies would smear honest listings.
function assetRow(a, holder) {
  if (!a || !a.asset_kind) return "";
  var c = CHAINS[a.asset_chain];
  var label = a.asset_kind === "erc20" ? "Tokens" : (a.asset_kind === "erc1155" ? "Edition #" : "#") + esc(shortId(a.asset_token_id));
  var href = c ? c.scan + "/address/" + a.asset_contract : null;
  var id = "held-" + Math.random().toString(36).slice(2, 10);
  pendingMeta.push({ id: id, asset: a });
  var h = '<div class="nftname" data-nftname="' + id + '" hidden></div><div class="assetline">';
  h += href ? '<a class="chain" href="' + href + '" target="_blank" rel="noopener">' + esc(c.name) + "</a>"
            : '<span class="chain">chain ' + esc(String(a.asset_chain)) + "</span>";
  h += '<span class="held" data-held="' + id + '">checking…</span>';
  h += '<span class="assetmeta" title="' + esc(a.asset_kind === "erc20" ? a.asset_contract : "Token " + a.asset_token_id + " on " + a.asset_contract) + '">' + label + " · " + esc(shortAddr(a.asset_contract)) + "</span></div>";
  pendingChecks.push({ id: id, asset: a, holder: holder });
  return h;
}
var pendingChecks = [];
function runChecks() {
  var jobs = pendingChecks; pendingChecks = [];
  jobs.forEach(function (j) {
    var el = document.querySelector('[data-held="' + j.id + '"]');
    if (!el) return;
    if (!j.holder) { el.textContent = "no wallet linked"; return; }
    checkOwnership(j.asset, j.holder).then(function (ok) {
      var e2 = document.querySelector('[data-held="' + j.id + '"]');
      if (!e2) return;
      if (ok === null) { e2.textContent = "could not check"; e2.className = "held"; return; }
      if (ok === "nocontract") { e2.textContent = "not on " + (CHAINS[j.asset.asset_chain] || {}).name; e2.className = "held no"; e2.title = "Nothing lives at that address on this chain. The listing probably picked the wrong chain — edit it."; return; }
      e2.textContent = ok ? "held by lister" : "no longer held";
      e2.className = "held " + (ok ? "yes" : "no");
    });
  });
}

function itemCard(it, opts) {
  opts = opts || {};
  var traded = it.status === "traded", pledged = it.status === "pledged";
  var mine = uid && it.owner_id === uid;
  var pending = signals.filter(function (o) { return o.item_id === it.id && o.status === "pending"; }).length;
  var sc = scoreOf(it.owner_id), prof = profiles[it.owner_id];

  var el = document.createElement("article");
  el.className = "item" + (traded || pledged ? " gone" : "");
  el.dataset.id = it.id;
  el.style.setProperty("--c", hueOf(it.cat));
  var h = "";
  if (it.photos && it.photos.length) {
    // One photo at a time: the first is the cover, the rest a swipe (or an arrow) away.
    var ph = it.photos.slice(0, 4), many = ph.length > 1;
    h += '<div class="gallery" role="group" aria-roledescription="carousel" aria-label="' + esc(it.title + " photos") + '"><div class="track" tabindex="0">' +
      ph.map(function (u, i) { return '<img src="' + esc(u) + '" alt="' + esc(it.title + (many ? " \u2014 photo " + (i + 1) + " of " + ph.length : "")) + '"' + (i ? ' loading="lazy"' : "") + ">"; }).join("") + "</div>" +
      (many ? '<button type="button" class="gnav prev" aria-label="Previous photo" hidden>&#8249;</button><button type="button" class="gnav next" aria-label="Next photo">&#8250;</button>' +
        '<div class="gdots" aria-hidden="true">' + ph.map(function (_, i) { return "<s" + (i ? "" : ' class="on"') + "></s>"; }).join("") + "</div>" : "") + "</div>";
  } else if (it.asset_kind && it.asset_kind !== "erc20") {
    var artId = "art-" + Math.random().toString(36).slice(2, 10);
    pendingMeta.push({ id: artId, asset: it });
    h += '<div class="pics nft" data-art="' + artId + '"><div class="artph">Fetching artwork from ' + esc((CHAINS[it.asset_chain] || {}).name || "chain") + "…</div></div>";
  }
  h += "<h3>" + esc(it.title) + "</h3>";
  if (it.descr) h += '<p class="desc">' + esc(it.descr) + "</p>";
  h += assetRow(it, verifiedWallet(profiles[it.owner_id]));
  h += '<div class="sides"><div class="side h"><span class="k">Offering</span><span class="v">' + esc(it.title) + "</span></div>" +
    '<div class="arrow" aria-hidden="true"></div>' +
    '<div class="side w"><span class="k">Wants</span><span class="v">' + esc(wantText(it)) + "</span></div></div>";
  var parts = sc.dots + " dots \u00b7 " + sc.trades + (sc.trades === 1 ? " trade" : " trades") + " \u00b7 " + sc.verified + " verified \u00b7 " + sc.noShows + (sc.noShows === 1 ? " no-show" : " no-shows");
  h += '<div class="foot"><span class="who" title="' + esc(parts) + '"><span class="av">' + esc(initial(it.owner_id).toUpperCase()) + '</span><b>' + esc(who(it.owner_id)) + "</b>" + dotRow(sc.dots) +
    (sc.noShows ? '<span class="strike" title="Agreed a trade and never sent their side">' + sc.noShows + (sc.noShows === 1 ? " no-show" : " no-shows") + "</span>" : "") +
    "<span>" + esc(ago(it.created_at)) + (prof && prof.area ? " · " + esc(prof.area) : "") + "</span>" +
    (function () { var d = mine ? null : distTo(it.owner_id); return d === null ? "" : '<span class="dist">' + esc(fmtMiles(d)) + " away</span>"; })() + "</span>";
  if (it.cat) h += '<span class="tag">' + esc(it.cat) + "</span>";
  if (!traded && !pledged) h += wantedTag(it);
  var badge = badges[it.id];
  if (badge) {
    h += '<span class="tag proof" title="' + esc("Verified " + (badge.verified_at ? new Date(badge.verified_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "") +
      ": the lister photographed this item next to a handwritten note with a one-time code." + (badge.summary ? " " + badge.summary : "")) +
      '"><s></s>Proof of item</span>';
  }
  if (traded) h += '<span class="tag ok">Traded</span>';
  else if (pledged) h += '<span class="tag hold">Agreed — awaiting delivery</span>';
  else if (mine) h += '<span class="tag mine">' + (pending ? pending + (pending === 1 ? " offer" : " offers") : "Yours") + "</span>";
  h += "</div>";
  el.innerHTML = h;

  var gal = el.querySelector(".gallery");
  if (gal && gal.querySelector(".gnav")) wireGallery(gal);
  var foot = el.querySelector(".foot");
  var sentMine = uid && offers.some(function (o) { return o.item_id === it.id && o.from_id === uid && (o.status === "pending" || o.status === "agreed"); });
  if (!traded && !pledged && !mine && sentMine) {
    var sent = document.createElement("span"); sent.className = "tag mine"; sent.textContent = "Offer sent";
    sent.title = "See it under My trades. You can withdraw it there.";
    foot.appendChild(sent);
  } else if (!traded && !pledged && !mine) {
    var b = document.createElement("button");
    b.className = "btn ok"; b.type = "button"; b.textContent = "Offer a trade";
    b.addEventListener("click", function () {
      if (!uid) return needAccount("Make an account to offer on \u201c" + it.title + "\u201d. It takes a minute.", function () { openOffer(it); });
      openOffer(it);
    });
    foot.appendChild(b);
  }
  if (mine && opts.manage && !traded && !pledged && !badge && !it.asset_kind && caps.verify) {
    var ver = document.createElement("button");
    ver.className = "btn ghost"; ver.type = "button"; ver.textContent = "Prove you have it";
    ver.title = "Photograph a handwritten note with a one-time code next to the item. Verified listings carry a badge.";
    ver.addEventListener("click", function () { openVerify(it); });
    foot.appendChild(ver);
  }
  var wc = matchData.counts[it.id];
  if (mine && opts.manage && !traded && !pledged && wc && wc.listings) {
    var sw = document.createElement("button");
    sw.className = "btn ok"; sw.type = "button"; sw.textContent = "See who wants it";
    sw.addEventListener("click", function () { openWanting(it); });
    foot.appendChild(sw);
  }
  if (mine && opts.manage && !traded && !pledged) {
    var ed = document.createElement("button");
    ed.className = "btn ghost"; ed.type = "button"; ed.textContent = "Edit";
    ed.addEventListener("click", function () { openEdit(it); });
    foot.appendChild(ed);
    var del = document.createElement("button");
    del.className = "btn no"; del.type = "button"; del.textContent = "Remove";
    del.addEventListener("click", function () { removeItem(it); });
    foot.appendChild(del);
  }
  return el;
}

function wireGallery(g) {
  var track = g.querySelector(".track"), dots = g.querySelectorAll(".gdots s"), prev = g.querySelector(".prev"), next = g.querySelector(".next");
  var at = function () { return Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); };
  var paint = function () {
    var i = at();
    Array.prototype.forEach.call(dots, function (d, k) { d.className = k === i ? "on" : ""; });
    prev.hidden = i <= 0; next.hidden = i >= dots.length - 1;
  };
  var go = function (d) { track.scrollTo({ left: (at() + d) * track.clientWidth, behavior: "smooth" }); };
  prev.addEventListener("click", function () { go(-1); });
  next.addEventListener("click", function () { go(1); });
  track.addEventListener("scroll", function () { requestAnimationFrame(paint); }, { passive: true });
  track.addEventListener("keydown", function (e) { if (e.key === "ArrowRight") { e.preventDefault(); go(1); } if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); } });
}

function offerCard(o, dir) {
  var it = items.filter(function (x) { return x.id === o.item_id; })[0];
  var other = dir === "in" ? o.from_id : o.owner_id;
  var title = it ? it.title : "an item that has been removed";
  var el = document.createElement("article"); el.className = "offer";

  var head = dir === "in"
    ? "<b>" + esc(who(o.from_id)) + "</b> wants to trade for <b>" + esc(title) + "</b>"
    : "You offered on <b>" + esc(title) + "</b>" + (it ? " from <b>" + esc(who(it.owner_id)) + "</b>" : "");
  var h = '<div class="on">' + head + " " + dotRow(scoreOf(other).dots) + " · " + esc(ago(o.created_at)) + "</div>";
  h += '<div class="sides"><div class="side h"><span class="k">They give</span><span class="v">' + esc(o.give) + "</span></div>" +
    '<div class="arrow" aria-hidden="true"></div>' +
    '<div class="side w"><span class="k">For</span><span class="v">' + esc(title) + "</span></div></div>";
  h += assetRow(o, verifiedWallet(profiles[o.from_id]));
  if (o.msg) h += '<div class="msg">' + esc(o.msg) + "</div>";
  el.innerHTML = h;

  var acts = document.createElement("div"); acts.className = "acts";
  if (o.status === "pending" && dir === "in" && it && it.status === "open") {
    var yes = document.createElement("button");
    yes.className = "btn ok"; yes.type = "button"; yes.textContent = "Accept";
    yes.addEventListener("click", function () { call("accept_offer", o.id, "Agreed. Press your dots once you have both received."); });
    var no = document.createElement("button");
    no.className = "btn no"; no.type = "button"; no.textContent = "Decline";
    no.addEventListener("click", function () { call("decline_offer", o.id, "Offer declined."); });
    acts.appendChild(yes); acts.appendChild(no);
  } else if (o.status === "pending") {
    var w = document.createElement("span"); w.className = "tag"; w.textContent = "waiting"; acts.appendChild(w);
    if (dir === "out") {
      var wd = document.createElement("button");
      wd.className = "btn ghost"; wd.type = "button"; wd.textContent = "Withdraw";
      wd.addEventListener("click", function () { call("withdraw_offer", o.id, "Offer withdrawn."); });
      acts.appendChild(wd);
    }
  } else if (o.status === "declined") {
    var d = document.createElement("span"); d.className = "tag"; d.textContent = "declined"; acts.appendChild(d);
  } else if (o.status === "withdrawn") {
    var wdn = document.createElement("span"); wdn.className = "tag off";
    wdn.textContent = dir === "out" ? "you withdrew this" : "withdrawn by " + who(o.from_id); acts.appendChild(wdn);
  } else if (o.status === "cancelled") {
    var c = document.createElement("span"); c.className = o.defaulted_by ? "strike" : "tag off";
    c.textContent = o.defaulted_by ? "closed \u2014 " + (o.defaulted_by === uid ? "you" : who(o.defaulted_by)) + " never sent" : "cancelled by " + (o.cancelled_by === uid ? "you" : who(o.cancelled_by)); acts.appendChild(c);
  }

  if (o.status === "agreed" || o.status === "done") {
    var minePressed = dir === "in" ? o.confirm_owner : o.confirm_from;
    var theirs = dir === "in" ? o.confirm_from : o.confirm_owner;
    if (o.confirm_owner && o.confirm_from) {
      var t = document.createElement("span"); t.className = "tag ok"; t.textContent = "Trade complete"; acts.appendChild(t);
    } else if (minePressed) {
      var wt = document.createElement("span"); wt.className = "tag hold";
      wt.textContent = "Waiting on " + who(other); acts.appendChild(wt);
    } else {
      var press = document.createElement("button");
      press.className = "btn press"; press.type = "button";
      press.innerHTML = "<s></s> Press your dot — it arrived";
      press.title = "Confirms you received your side, and earns " + who(other) + " a dot";
      press.addEventListener("click", function () { call("press_dot", o.id, null); });
      acts.appendChild(press);
      var hint = document.createElement("span"); hint.className = "presshint";
      hint.textContent = theirs ? who(other) + " has pressed theirs" : "Both of you press to close it";
      acts.appendChild(hint);
      if (o.status === "agreed" && !(dir === "in" ? o.owner_sent_at : o.from_sent_at)) {
        var cx = document.createElement("button");
        cx.className = "btn ghost"; cx.type = "button"; cx.textContent = "Cancel trade";
        cx.title = "Walk away before anything has arrived. The item goes back on the board; the cancellation stays on record.";
        cx.addEventListener("click", function () {
          if (!confirm("Cancel this trade? " + who(other) + " will see that you did, and the item goes back on the board.")) return;
          call("cancel_trade", o.id, "Trade cancelled. The item is back on the board.");
        });
        acts.appendChild(cx);
      }
    }
  }
  el.appendChild(acts);
  if (uid && caps.trades && (o.status === "agreed" || (bondsBy[o.id] || []).length)) el.appendChild(protectEl(o, dir, other));
  if (uid && (o.status === "done" || o.status === "cancelled") && (bondsBy[o.id] || []).some(function (b) { return b.status === "held"; })) settleBond(o.id);
  if (caps.messages && uid && (o.status === "pending" || o.status === "agreed" || o.status === "done")) el.appendChild(threadEl(o, other));
  return el;
}
