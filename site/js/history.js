// Dot Trading Post — Activity: finished trades, the board's and your own.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* ---- finished trades (history.sql) ----
   Once both dots are pressed a trade is public: what went for what, between whom, and when.
   Messages and tracking numbers never are. */
var tradeLog = [];
var LOG_SIZE = 60;

function loadHistory() {
  if (!caps.history) return;
  sb.from("trade_history").select("*").order("done_at", { ascending: false }).limit(LOG_SIZE).then(function (r) {
    if (r.error) return;
    var rows = Array.isArray(r.data) ? r.data : [];
    // The board loads recent listings; a trade can be about an older one, so fetch what is missing.
    var want = {};
    rows.concat(myFinished()).forEach(function (tr) { [tr.item_id].concat(tr.give_items || []).forEach(function (id) { if (id && !itemById(id)) want[id] = 1; }); });
    var missing = Object.keys(want);
    return (missing.length ? sb.from("items").select("*").in("id", missing) : Promise.resolve({ data: [] })).then(function (m) {
      (m.data || []).forEach(function (x) { if (!itemById(x.id)) items.push(x); });
      tradeLog = rows; paintActivity();
    });
  });
}

// The viewer's own finished trades come from their offers, so none are lost past the public list's end.
function myFinished() {
  return offers.filter(function (o) { return o.status === "done"; }).map(function (o) {
    return { id: o.id, item_id: o.item_id, owner_id: o.owner_id, from_id: o.from_id, give: o.give, give_items: o.give_items || [],
      asset_kind: o.asset_kind, asset_chain: o.asset_chain, asset_contract: o.asset_contract, asset_token_id: o.asset_token_id,
      done_at: o.done_at || o.created_at, swapped: !!o.swap_tx, tracked: tradeVerified(o) };
  }).sort(function (x, y) { return x.done_at < y.done_at ? 1 : -1; });
}

function tradeRow(tr) {
  var it = itemById(tr.item_id) || { title: t("a listing that was taken down"), cat: "Other", photos: [] };
  var gi = (tr.give_items || []).map(itemById).filter(Boolean);
  var el = document.createElement("article"); el.className = "trow"; el.style.setProperty("--c", hueOf(it.cat));
  var pic = function (src, alt) { return '<img src="' + esc(src) + '" alt="' + esc(alt) + '" loading="lazy">'; };
  var letter = function (s, c) { return '<span class="tl" style="background:' + hueOf(c) + '">' + esc(String(s || "?").charAt(0).toUpperCase()) + "</span>"; };
  var left = it.photos && it.photos[0] ? pic(it.photos[0], it.title) : letter(it.title, it.cat);
  var giPic = gi.filter(function (g) { return g.photos && g.photos[0]; })[0], right;
  if (giPic) right = pic(giPic.photos[0], giPic.title);
  else if (tr.asset_kind && tr.asset_kind !== "erc20") {
    var artId = "art-" + Math.random().toString(36).slice(2, 10);
    pendingMeta.push({ id: artId, asset: tr });
    right = '<span class="tart" data-art="' + artId + '">' + letter(tr.give, "Art") + "</span>";
  } else right = letter(tr.give, gi[0] ? gi[0].cat : "Other");

  // Told from the viewer's side when it was their trade.
  var mineFrom = uid && tr.from_id === uid;
  var a = mineFrom ? tr.from_id : tr.owner_id, b = mineFrom ? tr.owner_id : tr.from_id;
  var link = '<a href="' + esc(langPath(itemPath({ id: tr.item_id, title: it.title }))) + '">' + esc(it.title) + "</a>";
  var aGave = mineFrom ? esc(tr.give) : link;
  var bGave = mineFrom ? link : esc(tr.give);
  el.innerHTML =
    '<div class="tpair"><span class="tp">' + (mineFrom ? right : left) + '</span><span class="arrow" aria-hidden="true"></span><span class="tp">' + (mineFrom ? left : right) + "</span></div>" +
    '<div class="tbody"><p class="tline">' + t("{a} swapped {aGave} with {b} for {bGave}", { a: "<b>" + esc(who(a)) + "</b>", aGave: aGave, b: "<b>" + esc(who(b)) + "</b>", bGave: bGave }) + "</p>" +
      '<p class="tmeta"><time datetime="' + esc(tr.done_at) + '" title="' + esc(fmtDateTime(tr.done_at)) + '">' + esc(ago(tr.done_at)) + "</time>" +
      (tr.swapped ? '<span class="tag ok">' + esc(t("Swapped on chain")) + "</span>" : tr.tracked ? '<span class="tag ok">' + esc(t("Verified both ways")) + "</span>" : "") + "</p></div>";
  return el;
}

function paintActivity() {
  $("t-activity").hidden = !caps.history;
  if (!caps.history) return;
  var people = {};
  tradeLog.forEach(function (tr) { people[tr.owner_id] = 1; people[tr.from_id] = 1; });
  var n = tradeLog.length;
  $("actStats").innerHTML = n
    ? t(n === 1 ? "{n} trade finished between {people} traders" : "{n} trades finished between {people} traders", { n: "<b>" + (n >= LOG_SIZE ? n + "+" : n) + "</b>", people: "<b>" + Object.keys(people).length + "</b>" }) +
      " · " + esc(t("last one {when}", { when: ago(tradeLog[0].done_at) }))
    : "";
  var mine = uid ? myFinished() : [];
  $("myHistWrap").hidden = !uid;
  var mh = $("myHist"); mh.innerHTML = "";
  mine.forEach(function (tr) { mh.appendChild(tradeRow(tr)); });
  $("myHistEmpty").hidden = mine.length > 0;
  var all = $("allHist"); all.innerHTML = "";
  tradeLog.forEach(function (tr) { all.appendChild(tradeRow(tr)); });
  $("allHistEmpty").hidden = n > 0;
  runMeta();
}
