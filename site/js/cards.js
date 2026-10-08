// Dot Trading Post — Listing cards, the photo gallery, and offer cards.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

// A chain chip that links to the explorer, plus a badge the viewer's own browser fills in once
// the chain has answered. It starts as "checking" rather than as a verdict, because claiming an
// asset is unheld before the RPC replies would smear honest listings.
// `holders` is every wallet that person has linked; `heldBy` names them: the lister on a listing,
// the offerer on an offer. On your own, a miss says which wallet it is in, so you can link that one.
function assetRow(a, holders, heldBy, mine) {
  if (!a || !a.asset_kind) return "";
  var c = CHAINS[a.asset_chain];
  var label = a.asset_kind === "erc20" ? esc(t("Tokens")) : (a.asset_kind === "erc1155" ? esc(t("Edition #")) : "#") + esc(shortId(a.asset_token_id));
  var href = c ? c.scan + "/address/" + a.asset_contract : null;
  var id = "held-" + Math.random().toString(36).slice(2, 10);
  pendingMeta.push({ id: id, asset: a });
  var h = '<div class="nftname" data-nftname="' + id + '" hidden></div><div class="assetline">';
  h += href ? '<a class="chain" href="' + href + '" target="_blank" rel="noopener">' + esc(c.name) + "</a>"
            : '<span class="chain">' + esc(t("chain {id}", { id: String(a.asset_chain) })) + "</span>";
  h += '<span class="held" data-held="' + id + '">' + esc(t("checking…")) + "</span>";
  h += '<span class="assetmeta" title="' + esc(a.asset_kind === "erc20" ? a.asset_contract : t("Token {id} on {contract}", { id: a.asset_token_id, contract: a.asset_contract })) + '">' + label + " · " + esc(shortAddr(a.asset_contract)) + "</span></div>";
  pendingChecks.push({ id: id, asset: a, holders: holders || [], heldBy: heldBy || t("the lister"), mine: !!mine });
  return h;
}
var pendingChecks = [];
function runChecks() {
  var jobs = pendingChecks; pendingChecks = [];
  jobs.forEach(function (j) {
    var el = document.querySelector('[data-held="' + j.id + '"]');
    if (!el) return;
    if (!j.holders.length) { el.textContent = t("no wallet linked"); return; }
    heldByAny(j.asset, j.holders).then(function (ok) {
      var e2 = document.querySelector('[data-held="' + j.id + '"]');
      if (!e2) return;
      if (ok === null) { e2.textContent = t("could not check"); e2.className = "held"; return; }
      if (ok === "nocontract") { e2.textContent = t("not on {chain}", { chain: (CHAINS[j.asset.asset_chain] || {}).name }); e2.className = "held no"; e2.title = t("Nothing lives at that address on this chain. The listing probably picked the wrong chain — edit it."); return; }
      e2.textContent = ok ? t("held by {who}", { who: j.heldBy }) : t(j.mine ? "not in your linked wallets" : "no longer held");
      e2.className = "held " + (ok ? "yes" : "no");
      if (!ok && j.mine) holderOf(j.asset).then(function (h) {
        e2.title = h ? t("It is in {addr}. If that wallet is yours, link it too: tap the wallet button at the top.", { addr: h })
                     : t("If another wallet of yours holds it, link that one too: tap the wallet button at the top.");
      });
    });
  });
}

function itemCard(it, opts) {
  opts = opts || {};
  var traded = it.status === "traded", pledged = it.status === "pledged";
  var mine = uid && it.owner_id === uid;
  var pending = offers.filter(function (o) { return o.item_id === it.id && o.status === "pending"; }).length;
  var sc = scoreOf(it.owner_id), prof = profiles[it.owner_id];

  var el = document.createElement("article");
  el.className = "item" + (traded || pledged ? " gone" : "");
  el.dataset.id = it.id;
  el.style.setProperty("--c", hueOf(it.cat));
  var h = "";
  if (it.photos && it.photos.length) {
    // One photo at a time: the first is the cover, the rest a swipe (or an arrow) away.
    var ph = it.photos.slice(0, 4), many = ph.length > 1;
    h += '<div class="gallery" role="group" aria-roledescription="carousel" aria-label="' + esc(t("{title} photos", { title: it.title })) + '"><div class="track" tabindex="0">' +
      ph.map(function (u, i) { return '<img src="' + esc(u) + '" alt="' + esc(many ? t("{title} — photo {i} of {n}", { title: it.title, i: i + 1, n: ph.length }) : it.title) + '"' + (i ? ' loading="lazy"' : "") + ">"; }).join("") + "</div>" +
      (many ? '<button type="button" class="gnav prev" aria-label="' + esc(t("Previous photo")) + '" hidden>&#8249;</button><button type="button" class="gnav next" aria-label="' + esc(t("Next photo")) + '">&#8250;</button>' +
        '<div class="gdots" aria-hidden="true">' + ph.map(function (_, i) { return "<s" + (i ? "" : ' class="on"') + "></s>"; }).join("") + "</div>" : "") + "</div>";
  } else if (it.asset_kind && it.asset_kind !== "erc20") {
    var artId = "art-" + Math.random().toString(36).slice(2, 10);
    pendingMeta.push({ id: artId, asset: it });
    h += '<div class="pics nft" data-art="' + artId + '"><div class="artph">' + esc(t("Fetching artwork from {chain}…", { chain: (CHAINS[it.asset_chain] || {}).name || t("the chain") })) + "</div></div>";
  }
  h += "<h3>" + esc(it.title) + "</h3>";
  if (it.descr) h += '<p class="desc">' + esc(it.descr) + "</p>";
  h += assetRow(it, walletsOf(it.owner_id), null, mine);
  h += '<div class="sides"><div class="side h"><span class="k">' + esc(t("Offering")) + '</span><span class="v">' + esc(it.title) + "</span></div>" +
    '<div class="arrow" aria-hidden="true"></div>' +
    '<div class="side w"><span class="k">' + esc(t("Wants")) + '</span><span class="v">' + esc(wantText(it)) + "</span></div></div>";
  var parts = [tn(sc.dots, "{n} dot", "{n} dots"), tn(sc.trades, "{n} trade", "{n} trades"), t("{n} verified", { n: sc.verified }), tn(sc.noShows, "{n} no-show", "{n} no-shows")].join(" \u00b7 ");
  h += '<div class="foot"><span class="who" title="' + esc(parts) + '"><span class="av">' + esc(initial(it.owner_id).toUpperCase()) + '</span><b>' + esc(who(it.owner_id)) + "</b>" + dotRow(sc.dots) +
    // The record behind the dots, spelled out: what a stranger actually needs to know.
    '<span class="rec">' + esc(sc.trades ? tn(sc.trades, "{n} trade", "{n} trades") + " \u00b7 " + t("{n} verified", { n: sc.verified }) + (sc.noShows ? "" : " \u00b7 " + tn(0, "{n} no-show", "{n} no-shows")) : t("No trades yet")) + "</span>" +
    (sc.noShows ? '<span class="strike" title="' + esc(t("Agreed a trade and never sent their side")) + '">' + esc(tn(sc.noShows, "{n} no-show", "{n} no-shows")) + "</span>" : "") +
    "<span>" + esc(ago(it.created_at)) + (prof && prof.area ? " · " + esc(prof.area) : "") + "</span>" +
    (function () { var d = mine ? null : distTo(it.owner_id); return d === null ? "" : '<span class="dist">' + esc(t("{d} away", { d: fmtMiles(d) })) + "</span>"; })() + "</span>";
  if (it.cat) h += '<span class="tag">' + esc(catName(it.cat)) + "</span>";
  if (it.local_only) h += '<span class="tag local" title="' + esc(prof && prof.area ? t("No shipping — the lister hands it over in person, around {area}", { area: prof.area }) : t("No shipping — the lister hands it over in person")) + '"><s></s>' + esc(t("Local pickup")) + "</span>";
  if (!traded && !pledged) h += wantedTag(it);
  var badge = badges[it.id];
  if (badge) {
    h += '<span class="tag proof" title="' + esc(t("Verified {date}: the lister photographed this item next to a handwritten note with a one-time code.", { date: badge.verified_at ? fmtDate(badge.verified_at, { month: "short", day: "numeric", year: "numeric" }) : "" }) + (badge.summary ? " " + badge.summary : "")) +
      '"><s></s>' + esc(t("Proof of item")) + "</span>";
  }
  if (traded) h += '<span class="tag ok">' + esc(t("Traded")) + "</span>";
  else if (pledged) h += '<span class="tag hold">' + esc(t("Agreed — awaiting delivery")) + "</span>";
  else if (mine) h += '<span class="tag mine">' + esc(pending ? tn(pending, "{n} offer", "{n} offers") : t("Yours")) + "</span>";
  h += "</div>";
  el.innerHTML = h;

  var gal = el.querySelector(".gallery");
  if (gal && gal.querySelector(".gnav")) wireGallery(gal);
  var foot = el.querySelector(".foot");
  var sentMine = uid && offers.some(function (o) { return o.item_id === it.id && o.from_id === uid && (o.status === "pending" || o.status === "agreed"); });
  if (!traded && !pledged && !mine && sentMine) {
    var sent = document.createElement("span"); sent.className = "tag mine"; sent.textContent = t("Offer sent");
    sent.title = t("See it under My trades. You can withdraw it there.");
    foot.appendChild(sent);
  } else if (!traded && !pledged && !mine) {
    var b = document.createElement("button");
    b.className = "btn ok"; b.type = "button"; b.textContent = t("Offer a trade");
    b.addEventListener("click", function () {
      if (!uid) return needAccount(t("Make an account to offer on “{title}”. It takes a minute.", { title: it.title }), function () { openOffer(it); });
      openOffer(it);
    });
    foot.appendChild(b);
  }
  if (mine && opts.manage && !traded && !pledged && !badge && !it.asset_kind && caps.verify) {
    var ver = document.createElement("button");
    ver.className = "btn ghost"; ver.type = "button"; ver.textContent = t("Prove you have it");
    ver.title = t("Photograph a handwritten note with a one-time code next to the item. Verified listings carry a badge.");
    ver.addEventListener("click", function () { openVerify(it); });
    foot.appendChild(ver);
  }
  var wc = matchData.counts[it.id];
  if (mine && opts.manage && !traded && !pledged && wc && wc.listings) {
    var sw = document.createElement("button");
    sw.className = "btn ok"; sw.type = "button"; sw.textContent = t("See who wants it");
    sw.addEventListener("click", function () { openWanting(it); });
    foot.appendChild(sw);
  }
  if (!traded) {
    var sh = document.createElement("button");
    sh.className = "linkbtn share"; sh.type = "button"; sh.textContent = t("Share");
    sh.setAttribute("aria-label", t("Share “{title}”", { title: it.title }));
    sh.addEventListener("click", function () { shareItem(it); });
    foot.appendChild(sh);
  }
  if (mine && opts.manage && !traded && !pledged) {
    var ed = document.createElement("button");
    ed.className = "btn ghost"; ed.type = "button"; ed.textContent = t("Edit");
    ed.addEventListener("click", function () { openEdit(it); });
    foot.appendChild(ed);
    var del = document.createElement("button");
    del.className = "btn no"; del.type = "button"; del.textContent = t("Remove");
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
  var title = it ? it.title : t("an item that has been removed");
  var el = document.createElement("article"); el.className = "offer";

  var head = dir === "in"
    ? t("{who} wants to trade for {title}", { who: "<b>" + esc(who(o.from_id)) + "</b>", title: "<b>" + esc(title) + "</b>" })
    : it ? t("You offered on {title} from {who}", { title: "<b>" + esc(title) + "</b>", who: "<b>" + esc(who(it.owner_id)) + "</b>" }) : t("You offered on {title}", { title: "<b>" + esc(title) + "</b>" });
  var h = '<div class="on">' + head + " " + dotRow(scoreOf(other).dots) + " · " + esc(ago(o.created_at)) + "</div>";
  // What is on offer, as pictures: the token's artwork, and the photos of any listings put in.
  var tiles = [];
  if (o.asset_kind && o.asset_kind !== "erc20") {
    var artId = "art-" + Math.random().toString(36).slice(2, 10);
    pendingMeta.push({ id: artId, asset: o });
    tiles.push('<div class="otile nft" data-art="' + artId + '"><div class="artph">' + esc(t("Fetching artwork…")) + "</div></div>");
  }
  (o.give_items || []).map(itemById).forEach(function (g) {
    if (g && g.photos && g.photos[0]) tiles.push('<a class="otile" href="' + esc(itemPath(g)) + '" target="_blank" rel="noopener" title="' + esc(g.title) + '"><img src="' + esc(g.photos[0]) + '" alt="' + esc(g.title) + '" loading="lazy"></a>');
  });
  if (tiles.length) h += '<div class="opics' + (tiles.length > 1 ? " many" : "") + '">' + tiles.join("") + "</div>";
  h += '<div class="sides"><div class="side h"><span class="k">' + esc(t("They give")) + '</span><span class="v">' + esc(o.give) + "</span></div>" +
    '<div class="arrow" aria-hidden="true"></div>' +
    '<div class="side w"><span class="k">' + esc(t("For")) + '</span><span class="v">' + esc(title) + "</span></div></div>";
  var gi = (o.give_items || []).map(itemById).filter(Boolean);
  if (gi.length) h += '<div class="gitems"><span class="k">' + esc(t(dir === "in" ? "Their listings in this offer" : "Your listings in this offer")) + "</span>" +
    gi.map(function (g) {
      var pic = g.photos && g.photos[0];
      return '<a href="' + esc(itemPath(g)) + '" target="_blank" rel="noopener">' + (pic ? '<img src="' + esc(pic) + '" alt="">' : '<span class="pi" style="background:' + hueOf(g.cat) + '">' + esc(g.title.charAt(0).toUpperCase()) + "</span>") + "<span>" + esc(g.title) + "</span></a>";
    }).join("") + "</div>";
  h += assetRow(o, walletsOf(o.from_id), o.from_id === uid ? t("you") : who(o.from_id), o.from_id === uid);
  if (o.msg) h += '<div class="msg">' + esc(o.msg) + "</div>";
  el.innerHTML = h;

  var acts = document.createElement("div"); acts.className = "acts";
  if (o.status === "pending" && dir === "in" && it && it.status === "open") {
    var yes = document.createElement("button");
    yes.className = "btn ok"; yes.type = "button"; yes.textContent = t("Accept");
    yes.addEventListener("click", function () { call("accept_offer", o.id, t("Agreed. Press your dots once you have both received.")); });
    var no = document.createElement("button");
    no.className = "btn no"; no.type = "button"; no.textContent = t("Decline");
    no.addEventListener("click", function () { call("decline_offer", o.id, t("Offer declined.")); });
    acts.appendChild(yes); acts.appendChild(no);
  } else if (o.status === "pending") {
    var w = document.createElement("span"); w.className = "tag"; w.textContent = t("waiting"); acts.appendChild(w);
    if (dir === "out") {
      var wd = document.createElement("button");
      wd.className = "btn ghost"; wd.type = "button"; wd.textContent = t("Withdraw");
      wd.addEventListener("click", function () { call("withdraw_offer", o.id, t("Offer withdrawn.")); });
      acts.appendChild(wd);
    }
  } else if (o.status === "declined") {
    var d = document.createElement("span"); d.className = "tag"; d.textContent = t("declined"); acts.appendChild(d);
  } else if (o.status === "withdrawn") {
    var wdn = document.createElement("span"); wdn.className = "tag off";
    wdn.textContent = dir === "out" ? t("you withdrew this") : t("withdrawn by {who}", { who: who(o.from_id) }); acts.appendChild(wdn);
  } else if (o.status === "cancelled") {
    var c = document.createElement("span"); c.className = o.defaulted_by ? "strike" : "tag off";
    c.textContent = o.defaulted_by ? (o.defaulted_by === uid ? t("closed — you never sent") : t("closed — {who} never sent", { who: who(o.defaulted_by) }))
      : (o.cancelled_by === uid ? t("cancelled by you") : t("cancelled by {who}", { who: who(o.cancelled_by) })); acts.appendChild(c);
  }

  if (o.status === "agreed" || o.status === "done") {
    var minePressed = dir === "in" ? o.confirm_owner : o.confirm_from;
    var theirs = dir === "in" ? o.confirm_from : o.confirm_owner;
    if (o.confirm_owner && o.confirm_from) {
      var done = document.createElement("span"); done.className = "tag ok"; done.textContent = t("Trade complete"); acts.appendChild(done);
    } else if (minePressed) {
      var wt = document.createElement("span"); wt.className = "tag hold";
      wt.textContent = t("Waiting on {who}", { who: who(other) }); acts.appendChild(wt);
    } else {
      var press = document.createElement("button");
      press.className = "btn press"; press.type = "button";
      press.innerHTML = "<s></s> " + esc(t("Press your dot — it arrived"));
      press.title = t("Confirms you received your side, and earns {who} a dot", { who: who(other) });
      press.addEventListener("click", function () { call("press_dot", o.id, null); });
      acts.appendChild(press);
      var hint = document.createElement("span"); hint.className = "presshint";
      hint.textContent = theirs ? t("{who} has pressed theirs", { who: who(other) }) : t("Both of you press to close it");
      acts.appendChild(hint);
      if (o.status === "agreed" && !(dir === "in" ? o.owner_sent_at : o.from_sent_at)) {
        var cx = document.createElement("button");
        cx.className = "btn ghost"; cx.type = "button"; cx.textContent = t("Cancel trade");
        cx.title = t("Walk away before anything has arrived. The item goes back on the board; the cancellation stays on record.");
        cx.addEventListener("click", function () {
          if (!confirm(t("Cancel this trade? {who} will see that you did, and the item goes back on the board.", { who: who(other) }))) return;
          call("cancel_trade", o.id, t("Trade cancelled. The item is back on the board."));
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
