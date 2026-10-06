// Dot Trading Post — matching: who wants what, mutual matches, and saved searches.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* ---- matching (matching.sql) ----
   A listing can name the categories its owner would take; keywords come from what it has and what
   it wants. The database does the matching — this file asks and shows the answers. */
var matchData = { pairs: [], counts: {}, wants: [], hits: {} };

function wantText(it) {
  var bits = [];
  if (it.want) bits.push(it.want);
  if (it.want_cats && it.want_cats.length) bits.push((it.want ? "or any " : "Any ") + it.want_cats.join(", "));
  if (!bits.length) return "Open to offers";
  // "Open to offers" typed as the want already says it.
  if (it.open_to_offers !== false && !/open to (other )?offers/i.test(it.want || "")) bits.push("open to other offers");
  return bits.join(" · ");
}

// The same thing as a phrase after someone's name: "Cara wants any Video Games".
function wantsLine(it) { var t = wantText(it); return t === "Open to offers" ? "is open to offers" : "wants " + t.replace(/^Any /, "any "); }

// Chips for the categories someone would take: the quick ones, plus any picked from the full list.
function catPicker(host, selected) {
  var sel = (selected || []).slice();
  function paint() {
    host.innerHTML = "";
    QUICK.concat(sel.filter(function (c) { return QUICK.indexOf(c) < 0; })).forEach(function (c) {
      var b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = c;
      b.style.setProperty("--c", hueOf(c)); b.setAttribute("aria-pressed", String(sel.indexOf(c) >= 0));
      b.addEventListener("click", function () {
        var i = sel.indexOf(c);
        if (i >= 0) sel.splice(i, 1); else if (sel.length >= 8) return toast("Eight categories is plenty."); else sel.push(c);
        paint();
      });
      host.appendChild(b);
    });
    var more = document.createElement("select"); more.className = "catpick"; more.setAttribute("aria-label", "Add another category");
    groupedOptions(more, "More categories…");
    more.addEventListener("change", function () { var c = more.value; if (c && sel.indexOf(c) < 0 && sel.length < 8) sel.push(c); paint(); });
    host.appendChild(more);
  }
  paint();
  return { get: function () { return sel.slice(); }, set: function (v) { sel = (v || []).slice(); paint(); } };
}
var postPicker = catPicker($("f-wantcats"), []);

function loadMatches() {
  if (!caps.matching || !sb) return Promise.resolve();
  var openIds = items.filter(function (it) { return it.status === "open"; }).slice(0, 200).map(function (it) { return it.id; });
  return Promise.all([
    openIds.length ? sb.rpc("wanted_counts", { p_items: openIds }) : Promise.resolve({ data: [] }),
    uid ? sb.rpc("my_matches") : Promise.resolve({ data: [] }),
    uid ? sb.from("saved_wants").select("*").order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    uid ? sb.rpc("my_search_hits") : Promise.resolve({ data: [] })
  ]).then(function (r) {
    var arr = function (x) { return Array.isArray(x && x.data) ? x.data : []; };
    matchData.counts = {}; arr(r[0]).forEach(function (c) { matchData.counts[c.item_id] = c; });
    matchData.pairs = arr(r[1]);
    matchData.wants = arr(r[2]);
    matchData.hits = {}; arr(r[3]).forEach(function (h) { (matchData.hits[h.want_id] = matchData.hits[h.want_id] || []).push(h.item_id); });
    render();
  });
}

function wantedTag(it) {
  var c = matchData.counts[it.id]; if (!c) return "";
  var n = c.listings + c.searches; if (!n) return "";
  return '<span class="tag want" title="' + esc((c.listings ? c.listings + (c.listings === 1 ? " listing wants" : " listings want") + " something like this. " : "") +
    (c.searches ? c.searches + (c.searches === 1 ? " person is" : " people are") + " searching for it." : "")) + '">' + n + " want this</span>";
}

function paintMatches() {
  var box = $("matchBox");
  // Best first: the database scores each pair (both ways, categories, shared words, distance, proof).
  // An older database sends no score; then mutual first, then the ones that want yours.
  var rank = function (p) { return typeof p.score === "number" ? -p.score : p.they_want_mine && p.i_want_theirs ? -2 : p.they_want_mine ? -1 : 0; };
  var pairs = uid && caps.matching ? matchData.pairs.filter(function (p) { return itemById(p.their_item) && itemById(p.my_item); })
    .sort(function (a, b) { return rank(a) - rank(b); }) : [];
  if (!pairs.length) {
    // No matches yet: say what would make some, rather than showing nothing.
    var mineOpen = uid ? items.filter(function (it) { return it.owner_id === uid && it.status === "open"; }) : [];
    var saysWant = mineOpen.some(function (it) { return it.want || (it.want_cats && it.want_cats.length); });
    box.hidden = !(uid && caps.matching);
    box.innerHTML = box.hidden ? "" : '<div class="sub">Matches for you</div><div class="mempty">' + (!mineOpen.length
      ? "<span>Post something you'd trade, and Dot finds people who want it \u2014 especially people who have what you want.</span><button class=\"btn ok\" type=\"button\" data-go=\"post\">Post something</button>"
      : !saysWant
        ? "<span>Say what you'd take on your listings \u2014 a few words or a category. That's what Dot matches on.</span><button class=\"btn ok\" type=\"button\" data-go=\"mine\">Edit my listings</button>"
        : "<span>No matches yet. New listings are checked against yours as they're posted" + (caps.notify ? ", and you'll get an email when one fits." : ".") + "</span>") + "</div>";
    return;
  }
  box.hidden = false;
  var mutual = pairs.filter(function (p) { return p.they_want_mine && p.i_want_theirs; }).length;
  box.innerHTML = '<div class="sub">' + (mutual ? mutual + (mutual === 1 ? " mutual match" : " mutual matches") + " · " : "") + "Matches for you</div>";
  var row = document.createElement("div"); row.className = "mrow";
  pairs.slice(0, 12).forEach(function (p) {
    var mine = itemById(p.my_item), theirs = itemById(p.their_item);
    var kind = p.they_want_mine && p.i_want_theirs ? ["mutual", "Both ways"] : p.they_want_mine ? ["wants", "Wants yours"] : ["you", "You might want"];
    var c = document.createElement("article"); c.className = "mcard"; c.style.setProperty("--c", hueOf(theirs.cat));
    c.innerHTML = '<span class="mtags"><span class="mtag ' + kind[0] + '">' + kind[1] + "</span>" +
      (p.nearby ? '<span class="mtag near">Nearby</span>' : "") + (badges[theirs.id] ? '<span class="mtag proof">Proof</span>' : "") + "</span>" +
      '<a href="#" class="mtitle" data-jump="' + esc(theirs.id) + '">' + esc(theirs.title) + "</a>" +
      '<span class="mby">' + esc(who(theirs.owner_id)) + " " + esc(wantsLine(theirs)) + "</span>" +
      '<span class="mfor">for your <b>' + esc(mine.title) + "</b></span>";
    var b = document.createElement("button"); b.type = "button"; b.className = "btn ok"; b.textContent = "Offer it";
    b.addEventListener("click", function () { openOffer(theirs, mine); });
    c.appendChild(b); row.appendChild(c);
  });
  box.appendChild(row);
}

// Who wants one of my listings: the open listings whose wants fit it, each with a one-tap offer.
function openWanting(it) {
  var sh = sheet("Who wants your " + esc(it.title), '<div class="wlist" id="wantList"><p class="hint" style="margin:0">Looking…</p></div>');
  sb.rpc("listings_wanting", { p_item: it.id }).then(function (r) {
    if (r.error) { sh.close(); return fail(r.error); }
    var ids = (Array.isArray(r.data) ? r.data : []).map(function (x) { return typeof x === "string" ? x : x.listings_wanting; });
    var missing = ids.filter(function (id) { return !itemById(id); });
    return (missing.length ? sb.from("items").select("*").in("id", missing) : Promise.resolve({ data: [] })).then(function (m) {
      (m.data || []).forEach(function (x) { items.push(x); });
      var host = sh.box.querySelector("#wantList"); host.innerHTML = "";
      if (!ids.length) { host.innerHTML = '<p class="hint" style="margin:0">No listings want it yet. Saved searches that fit still count toward “want this”.</p>'; return; }
      ids.forEach(function (id) {
        var y = itemById(id); if (!y) return;
        var b = document.createElement("button"); b.type = "button";
        b.innerHTML = '<span class="wi" style="background:' + cssColor(hueOf(y.cat)) + '"></span><span>' + esc(y.title) + "<small>" + esc(who(y.owner_id)) + " " + esc(wantsLine(y)) + "</small></span>";
        b.addEventListener("click", function () { sh.close(); openOffer(y, it); });
        host.appendChild(b);
      });
    });
  });
}

/* ---- saved searches: "looking for" ---- */
function paintLooking() {
  var wrap = $("lookWrap"); wrap.hidden = !(uid && caps.matching); if (wrap.hidden) return;
  var host = $("lookList"); host.innerHTML = "";
  if (!matchData.wants.length) { host.innerHTML = '<p class="hint" style="margin:0">Nothing saved yet. Save what you’re after and it collects every listing that fits.</p>'; return; }
  matchData.wants.forEach(function (w) {
    var hits = (matchData.hits[w.id] || []).filter(function (id) { return itemById(id); });
    var row = document.createElement("div"); row.className = "look";
    row.innerHTML = "<span><b>" + esc(w.label || w.cats.join(", ")) + "</b>" + (w.label && w.cats.length ? '<small>in ' + esc(w.cats.join(", ")) + "</small>" : "") + "</span>";
    var see = document.createElement("button"); see.type = "button"; see.className = "btn " + (hits.length ? "ok" : "ghost"); see.disabled = !hits.length;
    see.textContent = hits.length ? hits.length + (hits.length === 1 ? " listing fits" : " listings fit") : "nothing yet";
    see.addEventListener("click", function () { openHits(w, hits); });
    var x = document.createElement("button"); x.type = "button"; x.className = "linkbtn"; x.textContent = "remove";
    x.addEventListener("click", function () { sb.from("saved_wants").delete().eq("id", w.id).then(function (r) { if (r.error) return fail(r.error); loadMatches(); }); });
    row.appendChild(see); row.appendChild(x); host.appendChild(row);
  });
}
function openHits(w, ids) {
  var sh = sheet(esc(w.label || w.cats.join(", ")), '<div class="wlist" id="hitList"></div>');
  var host = sh.box.querySelector("#hitList");
  ids.forEach(function (id) {
    var y = itemById(id); if (!y) return;
    var b = document.createElement("button"); b.type = "button";
    b.innerHTML = '<span class="wi" style="background:' + cssColor(hueOf(y.cat)) + '"></span><span>' + esc(y.title) + "<small>" + esc(who(y.owner_id)) + " " + esc(wantsLine(y)) + "</small></span>";
    b.addEventListener("click", function () { sh.close(); openOffer(y); });
    host.appendChild(b);
  });
}
function saveSearch(label, cats) {
  if (!uid) return needAccount("Make an account to save searches. It takes a minute.", null);
  sb.from("saved_wants").insert({ user_id: uid, label: (label || "").slice(0, 80), cats: cats || [] }).then(function (r) {
    if (r.error) return fail(r.error);
    toast("Saved. Everything that fits collects under My trades → Looking for.");
    loadMatches();
  });
}
groupedOptions($("look-cat"), "Any category");
$("lookForm").addEventListener("submit", function (e) {
  e.preventDefault();
  var q = $("look-q").value.trim(), c = $("look-cat").value;
  if (!q && !c) return toast("Say what you’re looking for, or pick a category.");
  saveSearch(q, c ? [c] : []); $("look-q").value = ""; $("look-cat").value = "";
});
$("saveSearch").addEventListener("click", function () { saveSearch(filter.q, filter.cat ? [filter.cat] : []); });
