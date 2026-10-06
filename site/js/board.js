// Dot Trading Post — Rendering the board and My trades, and the offer sheet.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

function fill(host, emptyEl, list, make) {
  host.innerHTML = "";
  list.forEach(function (x) { host.appendChild(make(x)); });
  emptyEl.hidden = list.length > 0;
  host.hidden = list.length === 0;
}

function render() {
  var act = document.activeElement, keepId = act && act.id && act.id.indexOf("m-") === 0 ? act.id : null;
  var keepAt = keepId ? act.selectionEnd : 0;
  renderInner();
  if (keepId && $(keepId)) { $(keepId).focus(); try { $(keepId).setSelectionRange(keepAt, keepAt); } catch (e) {} }
}
function renderInner() {
  var open = items.filter(function (it) { return it.status === "open"; });
  var shown = open.filter(function (it) {
    if (filter.cat && it.cat !== filter.cat) return false;
    if (filter.radius) { var d = distTo(it.owner_id); if (d === null || d > filter.radius) return false; }
    if (!filter.q) return true;
    return (it.title + " " + (it.descr || "") + " " + (it.want || "")).toLowerCase().indexOf(filter.q) >= 0;
  });
  if (filter.radius) shown.sort(function (a, b) { return (distTo(a.owner_id) || 0) - (distTo(b.owner_id) || 0); });
  lastShown = shown;
  paintMatches(); paintLooking();
  $("saveSearch").hidden = !(uid && caps.matching && (filter.q || filter.cat));
  fill($("feed"), $("feedEmpty"), shown, function (it) { return itemCard(it); });
  if (mapOn) paintMap();
  $("feedEmpty").innerHTML = !open.length
    ? '<strong>Nothing on the board yet</strong>Post something you would trade and it shows up here for everyone.<br><button class="btn ok" type="button" data-go="post">Post the first item</button>'
    : (filter.radius && !locOf(uid)
        ? '<strong>Set your location first</strong>“Near me” needs a rough location on your profile. It is rounded to about a kilometre.<br><button class="btn ok" type="button" data-go="loc">Set location</button>'
        : '<strong>No matches</strong>Nothing here fits that search. Try another word, widen the distance, or clear the filter.<br><button class="btn ghost" type="button" data-go="clear">Clear filters</button>');
  var myName = profiles[uid] && profiles[uid].name;
  $("nudge").hidden = !(uid && (!myName || /^Trader [0-9A-F]{4}$/.test(myName)));

  var myItems = uid ? items.filter(function (it) { return it.owner_id === uid && it.status !== "removed"; }) : [];
  var inc = uid ? offers.filter(function (o) { return o.owner_id === uid; }) : [];
  var out = uid ? offers.filter(function (o) { return o.from_id === uid; }) : [];
  var waiting = inc.filter(function (o) { return o.status === "pending"; }).length +
    inc.concat(out).filter(function (o) {
      return o.status === "agreed" && !(o.owner_id === uid ? o.confirm_owner : o.confirm_from);
    }).length +
    inc.concat(out).filter(function (o) { return o.status === "agreed" && o.swap_order && !o.swap_tx && o.from_id === uid; }).length +
    payouts.filter(function (p) { return p.status === "owed" && p.approved; }).length +
    inc.concat(out).filter(function (o) { return unreadIn(o.id) > 0 && !(threadOpen[o.id] !== undefined ? threadOpen[o.id] : o.status === "agreed"); }).length;
  document.title = (uid && waiting ? "(" + waiting + ") " : "") + baseTitle;

  fill($("offersIn"), $("offersInEmpty"), inc, function (o) { return offerCard(o, "in"); });
  fill($("offersOut"), $("offersOutEmpty"), out, function (o) { return offerCard(o, "out"); });
  fill($("myItems"), $("myItemsEmpty"), myItems, function (it) { return itemCard(it, { manage: true }); });
  if (uid) paintPayouts(); else $("payoutBox").hidden = true;

  var badge = $("mineCount");
  badge.textContent = String(waiting); badge.hidden = waiting === 0;

  var sc = scoreOf(uid);
  $("myDots").textContent = sc.dots;
  $("myDotRow").innerHTML = dotRow(sc.dots).replace(/^<span class="dots"[^>]*>/, "").replace(/<\/span>$/, "");
  $("myRank").textContent = rankOf(sc.dots);
  $("myLedger").innerHTML =
    row(Math.floor(sc.tradePts), sc.trades + (sc.trades === 1 ? " completed trade" : " completed trades") + " with " + sc.partners + (sc.partners === 1 ? " person" : " different people") + " \u2014 two dots for the first with each person, one for the second, none after") +
    row(Math.floor(sc.verifiedPts), sc.verified + " verified \u2014 tracked both ways or swapped on chain") +
    row(sc.vouches, sc.vouches === 1 ? "person pressed their dot for you" : "different people pressed their dot for you") +
    row(sc.profile, "profile filled in") +
    (sc.noShows ? row(-3 * sc.noShows, sc.noShows + (sc.noShows === 1 ? " trade" : " trades") + " agreed and never sent — three dots each") : "");
  paintWallet();
  runChecks();
  runMeta();
}
function row(n, what) {
  return '<div><span class="amt' + (n ? "" : " zero") + '"' + (n < 0 ? ' style="color:var(--red)"' : "") + ">" + (n > 0 ? "+" + n : n < 0 ? "\u2212" + (-n) : "0") + '</span><span class="what">' + esc(what) + "</span></div>";
}

// `give` is either words to start the offer with, or one of the viewer's own listings to put in.
function openOffer(it, give) {
  var mineOpen = !caps.giveItems ? [] : items.filter(function (x) { return x.owner_id === uid && x.status === "open" && x.id !== it.id; });
  var picked = give && typeof give === "object" ? [give.id] : [];
  var veil = document.createElement("div"); veil.className = "veil";
  var form = document.createElement("form"); form.className = "sheet f";
  form.innerHTML =
    "<h3>Offer a trade</h3>" +
    '<div style="font-size:13px;color:var(--muted)">For <b style="color:var(--ink)">' + esc(it.title) +
      '</b> — they want <b style="color:var(--ink)">' + esc(wantText(it)) + "</b></div>" +
    (it.local_only ? '<p class="localnote"><b>Local pickup only.</b> ' + esc(who(it.owner_id)) + " won\u2019t post it \u2014 you\u2019ll meet up to swap" +
      (profiles[it.owner_id] && profiles[it.owner_id].area ? ", around <b>" + esc(profiles[it.owner_id].area) + "</b>" : "") +
      (function () { var d = distTo(it.owner_id); return d === null ? "" : " (" + esc(fmtMiles(d)) + " from you)"; })() + ".</p>" : "") +
    (mineOpen.length ? '<div><span class="lbl" id="o-minelbl">Offer something you have posted <span class="hint">— tap one or more</span></span>' +
      '<div class="pickmine" id="o-mine" role="group" aria-labelledby="o-minelbl"></div></div>' : "") +
    '<div><label for="o-give">' + (mineOpen.length ? "Or describe what you are offering" : "What you are offering") + '</label><input id="o-give" maxlength="80" required placeholder="Retro console, boxed"></div>' +
    '<div class="assetbox"><label class="tick"><input type="checkbox" id="o-isasset"> <span>Offering a digital asset</span></label>' +
      '<div id="o-assetfields" hidden><p class="hint" style="margin:0 0 12px">It can be on any chain — it does not have to match theirs.</p>' +
      '<div class="rowf"><div><label for="o-chain">Chain</label><select id="o-chain"></select></div>' +
      '<div><label for="o-kind">Type</label><select id="o-kind"><option value="erc721">NFT (ERC-721)</option>' +
      '<option value="erc1155">Multi-edition (ERC-1155)</option><option value="erc20">Tokens (ERC-20)</option></select></div></div>' +
      '<div class="rowf" style="margin-top:14px"><div><label for="o-contract">Contract address</label><input id="o-contract" maxlength="42" placeholder="0x…"></div>' +
      '<div id="o-tokidwrap"><label for="o-tokid">Token ID</label><input id="o-tokid" maxlength="78" placeholder="1234"></div></div></div></div>' +
    '<div><label for="o-msg">Message <span class="hint">— optional</span></label><textarea id="o-msg" maxlength="400" placeholder="Happy to meet halfway this week."></textarea></div>' +
    '<div class="acts"><button class="btn ok" type="submit">Send offer</button><button class="btn ghost" type="button" data-x>Cancel</button></div>';
  veil.appendChild(form); document.body.appendChild(veil);
  CHAIN_IDS.forEach(function (id) {
    var o = document.createElement("option"); o.value = id; o.textContent = CHAINS[id].name;
    form.querySelector("#o-chain").appendChild(o);
  });
  form.querySelector("#o-chain").value = "8453";
  form.querySelector("#o-isasset").addEventListener("change", function (e) {
    form.querySelector("#o-assetfields").hidden = !e.target.checked;
  });
  form.querySelector("#o-kind").addEventListener("change", function (e) {
    form.querySelector("#o-tokidwrap").hidden = e.target.value === "erc20";
  });
  form.querySelector("[data-x]").addEventListener("click", function () { veil.remove(); });
  veil.addEventListener("click", function (e) { if (e.target === veil) veil.remove(); });
  var giveIn = form.querySelector("#o-give"), autoGive = "";
  // Picking listings writes the offer's words for you, until you type your own.
  function syncGive() {
    var t = picked.map(function (id) { return (itemById(id) || {}).title || ""; }).filter(Boolean).join(" + ");
    if (t.length > 80) t = t.slice(0, 79) + "\u2026";
    if (giveIn.value === autoGive) giveIn.value = t;
    autoGive = t;
    form.querySelector("label[for=o-give]").textContent = picked.length ? "Your offer, in a few words" : mineOpen.length ? "Or describe what you are offering" : "What you are offering";
  }
  if (mineOpen.length) {
    var host = form.querySelector("#o-mine");
    mineOpen.forEach(function (m) {
      var b = document.createElement("button"); b.type = "button"; b.className = "pm"; b.dataset.id = m.id;
      var pic = m.photos && m.photos[0];
      b.innerHTML = (pic ? '<img src="' + esc(pic) + '" alt="">' : '<span class="pi" style="background:' + hueOf(m.cat) + '">' + esc(m.title.charAt(0).toUpperCase()) + "</span>") +
        "<span>" + esc(m.title) + "</span>";
      b.setAttribute("aria-pressed", String(picked.indexOf(m.id) >= 0));
      b.addEventListener("click", function () {
        var i = picked.indexOf(m.id);
        if (i >= 0) picked.splice(i, 1); else if (picked.length >= 6) return toast("Six listings is the most one offer can hold."); else picked.push(m.id);
        b.setAttribute("aria-pressed", String(i < 0));
        syncGive();
      });
      host.appendChild(b);
    });
  }
  if (picked.length) syncGive();
  else if (give) giveIn.value = String(give).slice(0, 80);
  setTimeout(function () { var f = form.querySelector(picked.length || !mineOpen.length ? "#o-give" : "#o-mine .pm"); if (f) f.focus(); }, 30);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var give = form.querySelector("#o-give").value.trim();
    if (!give) return;
    var msg = form.querySelector("#o-msg").value.trim();
    var isAsset = form.querySelector("#o-isasset").checked;
    if (isAsset && !myWallet()) { toast("Connect your wallet first — a digital offer is checked against it."); return; }
    var asset;
    try {
      asset = readAsset({
        kind: form.querySelector("#o-kind"), chain: form.querySelector("#o-chain"),
        contract: form.querySelector("#o-contract"), tokid: form.querySelector("#o-tokid")
      }, isAsset);
    } catch (err) { toast(err.message); return; }
    veil.remove();
    var rec = { item_id: it.id, owner_id: it.owner_id, from_id: uid, give: give, msg: msg };
    Object.keys(asset).forEach(function (k) { rec[k] = asset[k]; });
    if (picked.length) {
      rec.give_items = picked.slice();
      // A digital listing put in carries its token with it, so the owner sees it checked on chain.
      var tok = isAsset ? null : picked.map(itemById).filter(function (x) { return x && x.asset_kind; })[0];
      if (tok) ["asset_kind", "asset_chain", "asset_contract", "asset_token_id"].forEach(function (k) { rec[k] = tok[k]; });
    }
    sb.from("offers").insert(rec)
      .then(function (r) {
        if (r.error && /give_items/.test(r.error.message || "")) return toast("Offering your own posts isn't switched on for this board yet \u2014 describe it in words for now.");
        if (r.error) return fail(r.error);
        toast("Offer sent."); load();
      });
  });
}
