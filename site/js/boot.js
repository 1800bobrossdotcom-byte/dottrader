// Dot Trading Post — Feature probes and start-up.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* ---- what this project has switched on ---- */
function applyCaps() {
  $("f-wantwrap").hidden = !caps.matching;
  $("f-photowrap").hidden = !caps.photos;
  $("p-locwrap").hidden = !caps.location;
  $("p-notifywrap").hidden = !caps.notify;
  $("t-activity").hidden = !caps.history;
  $("f-localwrap").hidden = !caps.local || $("f-isasset").checked;
  $("radius").hidden = !caps.location || !uid;
  $("mapBtn").hidden = !caps.location;
}
function probe() {
  var has = function (q) { return q.then(function (r) { return !r.error; }, function () { return false; }); };
  return Promise.all([
    has(sb.from("items").select("photos").limit(1)),
    has(sb.from("profiles").select("lat").limit(1)),
    has(sb.from("messages").select("id").limit(1)),
    // A plain GET has no preflight; "not deployed" is a 404 from the gateway, anything else means it is there.
    fetch(fnUrl("verify")).then(function (r) { return r.status !== 404; }, function () { return true; }),
    has(sb.from("offers").select("ship_by").limit(1)),
    has(sb.from("bonds").select("id").limit(1)),
    has(sb.from("items").select("want_cats").limit(1)),
    has(sb.from("profiles").select("email_notify").limit(1)),
    has(sb.from("offers").select("give_items").limit(1)),
    has(sb.from("trade_history").select("id").limit(1)),
    has(sb.from("items").select("local_only").limit(1)),
    has(sb.rpc("board_page", { p_limit: 1 })),
    has(sb.rpc("trader_stats", { p_ids: [] })),
    has(sb.from("profiles").select("lang").limit(1)),
    has(sb.from("linked_wallets").select("address").limit(1)),
    sb.from("swap_fees").select("*").then(function (r) { return r.error ? null : (r.data || []); }, function () { return null; }),
    // The bond function answers a plain GET with its price; 401 means it is there behind JWT checks.
    fetch(fnUrl("bond")).then(function (r) {
      if (r.status === 200) return r.json();
      return r.status === 404 ? null : { bond_cents: 2500, fee_cents: 150 };
    }, function () { return null; })
  ]).then(function (r) {
    caps = { photos: r[0], location: r[1], messages: r[2], verify: r[3], trades: r[4], bond: r[4] && r[5] && r[16] ? r[16] : null, matching: r[6], notify: r[7], giveItems: r[8], history: r[9], local: r[10], paging: r[11], stats: r[12], lang: r[13], wallets: r[14] };
    swapFees = r[15];
    syncLang();
    applyCaps(); render(); loadMatches(); loadHistory(); noteVisit();
    if (caps.bond) sb.channel("bonds").on("postgres_changes", { event: "*", schema: "public", table: "bonds" }, load).subscribe();
    if (caps.messages) {
      sb.channel("threads").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, load).subscribe();
    }
  });
}

/* ---- visits and members, at the foot (stats.sql) ---- */
function noteVisit() {
  var id = null; try { id = localStorage.getItem("dtp-vid"); if (!id) { id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2); localStorage.setItem("dtp-vid", id); } } catch (e) {}
  sb.rpc("note_visit", { p_client: id }).then(function (r) {
    var c = !r.error && (Array.isArray(r.data) ? r.data[0] : r.data); if (!c) return;
    var fmt = function (n) { try { return new Intl.NumberFormat(LOCALE[LANG]).format(n); } catch (e) { return String(n); } };
    var chip = function (n, one, many) { return "<span><b>" + esc(fmt(n)) + "</b> " + esc(Number(n) === 1 ? one : many) + "</span>"; };
    $("siteStats").innerHTML = chip(c.visits, t("visit"), t("visits")) + chip(c.members, t("member"), t("members")); $("siteStats").hidden = false;
  }, function () {});
}

/* ---- boot ---- */
// How did we get here? An email link leaves its type (or its error) in the URL fragment, and the
// client clears that fragment as soon as it starts, so it has to be read first.
var cfg = window.DTP_CONFIG || {};
var frag = location.hash || "";
var arrivedBy = (/[#&]type=(magiclink|signup|recovery|invite)/.exec(frag) || [])[1] || "";
var linkFailed = /[#&]error_code=(otp_expired|access_denied)|[#&]error=access_denied/.test(frag);
// Back from Stripe: a finished bond checkout, a cancelled one, or payout onboarding.
var qs = new URLSearchParams(location.search);
var stripeBack = { session: qs.get("bond") === "ok" ? qs.get("session_id") : null, cancelled: qs.get("bond") === "cancelled", payout: !!qs.get("payout") };

(function boot() {
  if (!cfg.url || cfg.url.indexOf("PASTE_") === 0) {
    note(t("This board is not connected to its database yet. Paste the Supabase project URL and anon key into {file}.", { file: "<b>site/config.js</b>" }), "bad");
    return;
  }
  if (qs.get("bond") || qs.get("payout")) { try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {} }

  sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  probing = probe();
  sb.auth.getSession().then(function (r) { enter(r.data.session); });
  sb.auth.onAuthStateChange(function (ev, session) {
    enter(session);
    if (ev === "PASSWORD_RECOVERY") openAuth("newpass", "");
  });
  if (linkFailed) {
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    setTimeout(function () {
      openAuth("code", t("That email link had expired or was already used — links only work once. Get a code instead; it works in any browser."));
    }, 400);
  }

  // Live: anyone's new listing or offer lands without a refresh.
  sb.channel("board")
    .on("postgres_changes", { event: "*", schema: "public", table: "items" }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "offers" }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, reload)
    .subscribe();
})();
