// Dot Trading Post — Dots, tabs, navigation, categories, search, and the digital-asset fields on the post form.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* dots: counted from the trade record, never stored as a number anyone can write */
// Two accounts trading back and forth used to mint dots for nothing. Now the first finished trade
// with a person counts in full, the second half, and the rest not at all; a vouch counts once per
// person; a trade earns more when it was tracked both ways or swapped on chain; and walking away
// from an agreed trade costs three. Farming needs many genuinely different, finished partners.
function scoreOf(id) {
  if (!id) return { dots: 0, trades: 0, partners: 0, verified: 0, vouches: 0, profile: 0, noShows: 0, tradePts: 0, verifiedPts: 0 };
  // Other traders: the database adds up their record (scale.sql) by these same rules. The viewer's
  // own is counted here from their own offers, which they can all see, for the full breakdown.
  var st = id !== uid && statsBy[id];
  if (st) return { dots: st.dots, trades: st.trades, partners: st.partners, verified: st.verified, vouches: st.vouches, profile: st.profile, noShows: st.no_shows, tradePts: 0, verifiedPts: 0 };
  var trades = 0, vouches = 0, noShows = 0, verified = 0, tradePts = 0, verifiedPts = 0, per = {}, vouchedBy = {};
  signals.slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }).forEach(function (o) {
    if (o.defaulted_by && o.defaulted_by === id) noShows++;
    var side = o.from_id === id ? "from" : (o.owner_id === id ? "owner" : null);
    if (!side) return;
    var partner = side === "from" ? o.owner_id : o.from_id;
    if (o.status === "done") {
      trades++;
      var k = per[partner] = (per[partner] || 0) + 1, w = k === 1 ? 1 : k === 2 ? 0.5 : 0;
      var ver = !!(o.swapped || (o.owner_sent_how === "post" && o.from_sent_how === "post"));
      if (ver) verified++;
      tradePts += 2 * w; if (ver) verifiedPts += w;
    }
    var vouched = side === "from" ? o.confirm_owner : o.confirm_from;
    if (vouched && !vouchedBy[partner]) { vouchedBy[partner] = true; vouches++; }
  });
  var p = profiles[id];
  var profile = p && (p.area || p.note) ? 1 : 0;
  return { dots: Math.max(0, Math.floor(tradePts + verifiedPts + vouches + profile - noShows * 3)), trades: trades, partners: Object.keys(per).length,
           verified: verified, vouches: vouches, profile: profile, noShows: noShows, tradePts: tradePts, verifiedPts: verifiedPts };
}
function rankOf(n) { var r = RANKS[0][1]; RANKS.forEach(function (x) { if (n >= x[0]) r = x[1]; }); return r; }
function level(n) { var lv = 0; RANKS.forEach(function (x) { if (n >= x[0]) lv++; }); return Math.max(1, Math.min(5, lv)); }
function dotRow(n) {
  var lv = n > 0 ? level(n) : 0;
  var h = '<span class="dots" title="' + n + ' dots — ' + esc(rankOf(n)) + '">';
  for (var i = 0; i < 5; i++) h += "<s" + (i < lv ? ' class="on"' : "") + "></s>";
  return h + "<em>" + n + "</em></span>";
}

function show(which) {
  ["browse", "post", "mine", "activity", "profile"].forEach(function (k) {
    $(k).hidden = k !== which;
    if ($("t-" + k)) $("t-" + k).setAttribute("aria-selected", String(k === which));
  });
  $("profBtn").setAttribute("aria-pressed", String(which === "profile"));
  render();
}
["browse", "post", "mine", "activity"].forEach(function (k) {
  $("t-" + k).addEventListener("click", function () {
    if (!uid && (k === "post" || k === "mine")) return needAccount(k === "post" ? "Make an account to post. It takes a minute." : "Make an account to trade. It takes a minute.", function () { show(k); });
    show(k);
  });
});
$("postCta").addEventListener("click", function () {
  if (!uid) return needAccount("Make an account to post. It takes a minute.", function () { show("post"); });
  show("post"); setTimeout(function () { $("f-title").focus(); }, 30);
});
function openProfile() {
  show("profile");
  setTimeout(function () { $("p-name").focus(); $("p-name").scrollIntoView({ block: "center", behavior: "smooth" }); }, 30);
}
$("nudgeGo").addEventListener("click", openProfile);
$("profBtn").addEventListener("click", function () { show("profile"); window.scrollTo(0, 0); });
document.addEventListener("click", function (e) {
  var go = e.target && e.target.getAttribute && e.target.getAttribute("data-go");
  if (!go) return;
  if (go === "clear") { filter.cat = ""; filter.q = ""; filter.radius = 0; $("q").value = ""; $("radius").value = "0"; syncCats(); render(); refilter(); return; }
  if (!uid && (go === "post" || go === "loc" || go === "mine" || go === "profile")) return needAccount("Make an account to post. It takes a minute.", function () { show(go === "loc" ? "profile" : go); });
  if (go === "loc") { show("profile"); setTimeout(function () { $("locBtn").scrollIntoView({ block: "center", behavior: "smooth" }); }, 30); return; }
  show(go);
});

function groupedOptions(sel, allLabel) {
  if (allLabel) { var a = document.createElement("option"); a.value = ""; a.textContent = allLabel; sel.appendChild(a); }
  GROUPS.forEach(function (g) {
    var og = document.createElement("optgroup"); og.label = g[0];
    g[1].forEach(function (c) { var o = document.createElement("option"); o.value = c; o.textContent = c; og.appendChild(o); });
    sel.appendChild(og);
  });
}
(function buildCats() {
  var wrap = $("cats");
  var all = document.createElement("button");
  all.className = "chip all"; all.type = "button"; all.textContent = "All";
  all.setAttribute("aria-pressed", "true");
  all.addEventListener("click", function () { filter.cat = ""; syncCats(); render(); refilter(); });
  wrap.appendChild(all);
  QUICK.forEach(function (c) {
    var b = document.createElement("button");
    b.className = "chip"; b.type = "button"; b.textContent = c; b.dataset.cat = c; b.style.setProperty("--c", hueOf(c));
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", function () { filter.cat = filter.cat === c ? "" : c; syncCats(); render(); refilter(); });
    wrap.appendChild(b);
  });
  groupedOptions($("catPick"), "All categories");
  $("catPick").addEventListener("change", function (e) { filter.cat = e.target.value; syncCats(); render(); refilter(); });
  groupedOptions($("f-cat"), null);
  $("f-cat").value = "Other";
})();
function syncCats() {
  Array.prototype.forEach.call($("cats").children, function (b) {
    b.setAttribute("aria-pressed", String((b.dataset.cat || "") === filter.cat));
  });
  if ($("catPick").value !== filter.cat) $("catPick").value = filter.cat;
}
$("q").addEventListener("input", function (e) { filter.q = e.target.value.trim().toLowerCase(); render(); refilter(); });
$("radius").addEventListener("change", function (e) {
  filter.radius = Number(e.target.value) || 0;
  if (filter.radius && !locOf(uid)) toast("Set your location on your Profile first.");
  render(); refilter();
});

(function buildChains() {
  [$("f-chain")].forEach(function (sel) {
    if (!sel) return;
    CHAIN_IDS.forEach(function (id) {
      var o = document.createElement("option"); o.value = id; o.textContent = CHAINS[id].name; sel.appendChild(o);
    });
    sel.value = "8453";
  });
  $("f-isasset").addEventListener("change", function (e) {
    $("f-assetfields").hidden = !e.target.checked;
    // A token can't be picked up; the local-only choice is for things.
    $("f-localwrap").hidden = !caps.local || e.target.checked;
    if (e.target.checked) $("f-local").checked = false;
    $("f-photohint").textContent = e.target.checked ? "— optional for a digital asset: the artwork comes from the chain" : "— up to 4 · location data is removed before upload";
    if (e.target.checked) previewAsset();
  });
  ["f-chain", "f-kind", "f-contract", "f-tokid"].forEach(function (id) { $(id).addEventListener("input", previewAsset); $(id).addEventListener("change", previewAsset); });
  $("f-kind").addEventListener("change", function (e) { $("f-tokidwrap").hidden = e.target.value === "erc20"; });
})();

// Live preview while listing a digital asset: find which chain the contract is on (people pick
// the wrong one constantly), then show the artwork and name, and fill the title if it is empty.
var previewT = null, previewSeq = 0;
function previewAsset() {
  clearTimeout(previewT);
  previewT = setTimeout(function () {
    var box = $("f-preview"), kind = $("f-kind").value, contract = $("f-contract").value.trim(), tok = $("f-tokid").value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(contract) || (kind !== "erc20" && !/^\d+$/.test(tok))) { box.hidden = true; return; }
    var seq = ++previewSeq;
    box.hidden = false; box.innerHTML = '<div class="artph small">Looking it up…</div>';
    chainsWithCode(contract).then(function (found) {
      if (seq !== previewSeq) return;
      var chosen = Number($("f-chain").value);
      if (found.length && found.indexOf(chosen) < 0) {
        $("f-chain").value = String(found[0]);
        toast("That contract lives on " + CHAINS[found[0]].name + " — switched the chain for you.");
      } else if (!found.length) {
        box.innerHTML = '<div class="artph small">No contract at that address on any chain we know. Check the address.</div>';
        return;
      }
      var a = { asset_kind: kind, asset_chain: Number($("f-chain").value), asset_contract: contract.toLowerCase(), asset_token_id: kind === "erc20" ? null : tok };
      return assetMeta(a).then(function (m) {
        if (seq !== previewSeq) return;
        if (!m) { box.innerHTML = '<div class="artph small">Found the contract, but could not read this token.</div>'; return; }
        var title = [genericCollection(m.collection) ? "" : m.collection, m.name].filter(Boolean).join(" · ");
        box.innerHTML = (m.image ? '<img src="' + esc(m.image) + '" alt="">' : '<span class="wi">&#9679;</span>') +
          "<div><b>" + esc(m.name || m.symbol || "Found it") + "</b><span>" + esc(genericCollection(m.collection) ? "" : (m.collection || "")) + " · " + esc(CHAINS[a.asset_chain].name) + "</span></div>";
        if (!$("f-title").value.trim() && (m.name || m.symbol)) $("f-title").value = (m.name || m.symbol).slice(0, 80);
      });
    });
  }, 450);
}

// Reading the asset fields is the same job on the post form and in the offer sheet.
function readAsset(scope, on) {
  if (!on) return { asset_kind: null, asset_chain: null, asset_contract: null, asset_token_id: null };
  var kind = scope.kind.value;
  var contract = scope.contract.value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) throw new Error("That contract address does not look right.");
  var tok = kind === "erc20" ? null : scope.tokid.value.trim();
  if (kind !== "erc20" && !/^\d+$/.test(tok || "")) throw new Error("Token ID should be a number.");
  return { asset_kind: kind, asset_chain: Number(scope.chain.value), asset_contract: contract.toLowerCase(), asset_token_id: tok };
}
