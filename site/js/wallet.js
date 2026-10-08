// Dot Trading Post — Wallet discovery (EIP-6963), linking by signature, switching and unlinking.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* ---- wallet ----
   Wallets are found with EIP-6963: every installed wallet announces itself on request, so
   MetaMask turns up even when another extension (Coinbase, Phantom, Brave) has taken over
   window.ethereum. Wallets that only inject the old way are the fallback. On a phone browser
   nothing is injected at all, so the way in is to open this page inside the wallet's app. */
function myWallet() { return verifiedWallet(profiles[uid]); }
function myWallets() { return uid ? walletsOf(uid) : []; }
function paintWallet() {
  var all = myWallets(), w = myWallet() || all[0];
  var btn = $("connectBtn"), el = $("walletState");
  var broken = !w && profiles[uid] && profiles[uid].wallet_address;
  el.textContent = w ? shortAddr(w) + (all.length > 1 ? " +" + (all.length - 1) : "") : t(broken ? "Reconnect wallet" : "Connect wallet");
  btn.className = "wal" + (w ? " on" : "");
  btn.title = w ? (all.length > 1 ? t("{n} wallets are linked to your account. Click to see them, add another or unlink one.", { n: all.length })
                                  : t("Wallet {addr} is linked to your account. Click to switch or unlink.", { addr: w })) :
    t(broken ? "The saved signature did not verify — connect again." : "Connect a wallet to list or offer digital assets");
}
var wallets = [];
window.addEventListener("eip6963:announceProvider", function (e) {
  var d = e.detail; if (!d || !d.provider || !d.info) return;
  if (wallets.some(function (w) { return w.info.uuid === d.info.uuid || w.provider === d.provider; })) return;
  wallets.push(d);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function walletName(p) {
  if (p.isRabby) return "Rabby";
  if (p.isBraveWallet) return "Brave Wallet";
  if (p.isCoinbaseWallet) return "Coinbase Wallet";
  if (p.isPhantom) return "Phantom";
  if (p.isTrust || p.isTrustWallet) return "Trust Wallet";
  if (p.isMetaMask) return "MetaMask";
  return "Browser wallet";
}
function installedWallets() {
  var out = wallets.slice();
  // Old-style injection: add anything not already announced, so a wallet that only sets
  // window.ethereum still shows up next to the ones that announced themselves.
  var eth = window.ethereum;
  var legacy = eth ? (Array.isArray(eth.providers) && eth.providers.length ? eth.providers : [eth]) : [];
  legacy.forEach(function (p) {
    if (!p || out.some(function (w) { return w.provider === p; })) return;
    var name = walletName(p);
    if (name !== "Browser wallet" && out.some(function (w) { return w.info.name === name; })) return;
    out.push({ info: { name: name, icon: null, uuid: "" }, provider: p });
  });
  return out;
}
function isPhone() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }

function sheet(title, bodyHtml) {
  var veil = document.createElement("div"); veil.className = "veil";
  var box = document.createElement("div"); box.className = "sheet";
  box.innerHTML = "<h3>" + title + "</h3>" + bodyHtml +
    '<div class="acts"><button class="btn ghost" type="button" data-x>' + esc(t("Close")) + "</button></div>";
  veil.appendChild(box); document.body.appendChild(veil);
  var close = function () { veil.remove(); };
  box.querySelector("[data-x]").addEventListener("click", close);
  veil.addEventListener("click", function (e) { if (e.target === veil) close(); });
  return { box: box, close: close };
}

function pickWallet(list) {
  var sh = sheet(t("Which wallet?"), '<div class="wlist" id="wlist"></div>');
  var host = sh.box.querySelector("#wlist");
  list.forEach(function (w) {
    var b = document.createElement("button"); b.type = "button";
    var ic = w.info.icon ? '<img src="' + esc(w.info.icon) + '" alt="">' : '<span class="wi">&#9679;</span>';
    b.innerHTML = ic + "<span>" + esc(w.info.name) + "</span>";
    b.addEventListener("click", function () { sh.close(); connectWith(w); });
    host.appendChild(b);
  });
}

function noWallet() {
  var here = location.host + location.pathname;
  if (isPhone()) {
    sheet(t("Open the board inside your wallet app"),
      '<p class="hint" style="margin:0">' + esc(t("Phone browsers cannot see wallet apps. Open this page in the wallet’s own browser and connect there. You will sign in with your email again inside it.")) + "</p>" +
      '<div class="wlist">' +
        '<a href="https://metamask.app.link/dapp/' + esc(here) + '"><span class="wi">&#129418;</span><span>' + esc(t("Open in MetaMask")) + "<small>" + esc(t("Needs the MetaMask app installed")) + "</small></span></a>" +
        '<a href="https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(location.href) + '"><span class="wi">&#128309;</span><span>' + esc(t("Open in Coinbase Wallet")) + "</span></a>" +
      "</div>");
  } else {
    var sh = sheet(t("No wallet answered"),
      '<p class="hint" style="margin:0">' + esc(t("No wallet extension replied to this page. If MetaMask is installed: click its icon in the toolbar, unlock it, then try again. Some browsers also need the extension allowed on this site.")) + "</p>" +
      '<div class="wlist">' +
        '<button type="button" data-retry><span class="wi">&#8635;</span><span>' + esc(t("Try again")) + "</span></button>" +
        '<a href="https://metamask.io/download/" target="_blank" rel="noopener"><span class="wi">&#129418;</span><span>' + esc(t("Get MetaMask")) + "<small>" + esc(t("Free browser extension")) + "</small></span></a>" +
      "</div>");
    sh.box.querySelector("[data-retry]").addEventListener("click", function () { sh.close(); startConnect(); });
  }
}

// With a wallet already linked, the pill opens choices instead of launching a new connection.
// Several wallets can be linked (wallets.sql): a listing counts as held if any of them holds it,
// and the main one is where the board points people who send you something.
function walletMenu() {
  if (!caps.wallets) return walletMenuOne();
  var all = myWallets(), main = myWallet();
  var rows = all.map(function (a) {
    var isMain = a === main;
    return '<div class="wrow"><span class="waddr" title="' + esc(a) + '">' + esc(shortAddr(a)) + "</span>" +
      (isMain ? '<span class="tag">' + esc(t("main")) + "</span>" : '<button class="btn ghost sm" type="button" data-main="' + esc(a) + '">' + esc(t("Make main")) + "</button>") +
      '<button class="btn ghost sm" type="button" data-unlink="' + esc(a) + '">' + esc(t("Unlink")) + "</button></div>";
  }).join("");
  var sh = sheet(t(all.length > 1 ? "Your wallets" : "Your wallet"),
    '<p class="hint" style="margin:0">' + esc(t("A digital listing counts as held if any of these wallets holds it. People sending you an NFT are pointed to your main wallet. They stay linked across sign-ins until you unlink them.")) + "</p>" +
    '<div class="wrows">' + rows + "</div>" +
    '<div class="wlist"><button type="button" data-add><span class="wi">+</span><span>' + esc(t("Link another wallet")) + "<small>" + esc(t("Switch to it in your wallet app, then sign a message with it")) + "</small></span></button></div>");
  sh.box.querySelector("[data-add]").addEventListener("click", function () { sh.close(); startConnect(); });
  sh.box.querySelectorAll("[data-main]").forEach(function (b) {
    b.addEventListener("click", function () { sh.close(); makeMain(b.getAttribute("data-main")); });
  });
  sh.box.querySelectorAll("[data-unlink]").forEach(function (b) {
    b.addEventListener("click", function () { sh.close(); unlinkWallet(b.getAttribute("data-unlink")); });
  });
}
function rowFor(addr) { return (linkedBy[uid] || []).filter(function (w) { return w.address === addr; })[0]; }
function setMain(w) {
  return sb.from("profiles").upsert({ id: uid, wallet_address: w ? w.address : null, wallet_msg: w ? w.msg : null, wallet_sig: w ? w.sig : null, updated_at: new Date().toISOString() });
}
function makeMain(addr) {
  var w = rowFor(addr); if (!w) return;
  setMain(w).then(function (r) { if (r.error) return fail(r.error); toast(t("{addr} is now your main wallet.", { addr: shortAddr(addr) })); load(); });
}
function unlinkWallet(addr) {
  var wasMain = addr === myWallet();
  sb.from("linked_wallets").delete().eq("owner_id", uid).eq("address", addr).then(function (r) {
    if (r.error) return fail(r.error);
    // Unlinking the main wallet hands that role to the next one, if there is one.
    var next = wasMain ? rowFor(myWallets().filter(function (a) { return a !== addr; })[0]) : null;
    return (wasMain ? setMain(next) : Promise.resolve({})).then(function (r2) {
      if (r2.error) return fail(r2.error);
      sigCache = {}; toast(t("Wallet unlinked. You are still signed in.")); load();
    });
  });
}
// Before wallets.sql adds linked_wallets: one wallet per account, as it always was.
function walletMenuOne() {
  var w = myWallet();
  var sh = sheet(t("Your wallet"),
    '<p class="hint" style="margin:0">' + t("Linked to this account: {addr}.", { addr: '<b style="font-family:var(--mono)">' + esc(w) + "</b>" }) + " " +
    esc(t("It stays linked across sign-ins until you unlink it. Unlinking does not sign you out.")) + "</p>" +
    '<div class="wlist">' +
      '<button type="button" data-switch><span class="wi">&#8646;</span><span>' + esc(t("Link a different wallet")) + "<small>" + esc(t("Sign a message with the new one")) + "</small></span></button>" +
      '<button type="button" data-unlink><span class="wi">&#10005;</span><span>' + esc(t("Unlink this wallet")) + "<small>" + esc(t("Digital listings will show “no wallet linked” until you link one")) + "</small></span></button>" +
    "</div>");
  sh.box.querySelector("[data-switch]").addEventListener("click", function () { sh.close(); startConnect(); });
  sh.box.querySelector("[data-unlink]").addEventListener("click", function () {
    sh.close();
    setMain(null).then(function (r) { if (r.error) return fail(r.error); sigCache = {}; toast(t("Wallet unlinked. You are still signed in.")); load(); });
  });
}
$("connectBtn").addEventListener("click", function () {
  if (myWallets().length) return walletMenu();
  startConnect();
});
function startConnect() {
  if (!window.ethers) { toast(t("Still loading — try again in a second.")); return; }
  // Ask again at click time: some wallets inject after the page has finished loading.
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  setTimeout(function () {
    var list = installedWallets();
    if (!list.length) return noWallet();
    if (list.length === 1) return connectWith(list[0]);
    pickWallet(list);
  }, 80);
}

function connectWith(w) {
  var eth = w.provider, btn = $("connectBtn"); btn.disabled = true;
  var addr, adding = caps.wallets && myWallets().length > 0;
  // Adding another wallet: ask the wallet to let them pick which account(s) to share, since it
  // would otherwise hand back the one already linked. Wallets that can't do that just carry on.
  (adding ? eth.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] }).catch(function (e) {
    var code = e && (e.code || (e.error && e.error.code));
    if (code === 4001 || code === "ACTION_REJECTED") throw e;
  }) : Promise.resolve())
    .then(function () { return eth.request({ method: "eth_requestAccounts" }); })
    .then(function (accts) {
      var mine = myWallets(), list = (accts || []).map(function (x) { return String(x).toLowerCase(); });
      addr = adding ? list.filter(function (x) { return mine.indexOf(x) < 0; })[0] : list[0];
      if (adding && !addr && list.length) throw new Error(t("{addr} is already linked. Switch to a different account in {wallet}, then try again.", { addr: shortAddr(list[0]), wallet: w.info.name }));
      if (!addr) throw new Error(t("No account selected in {wallet}.", { wallet: w.info.name }));
      // Signed, not just typed: the message names this account, so the signature proves control
      // of the address rather than knowledge of it.
      var msg = "Dot Trading Post\nLinking this wallet to my account\n" + uid + "\n" + new Date().toISOString();
      return new window.ethers.providers.Web3Provider(eth).getSigner(addr).signMessage(msg)
        .then(function (sig) { return { msg: msg, sig: sig }; });
    })
    .then(function (r) {
      var row = { address: addr.toLowerCase(), msg: r.msg, sig: r.sig };
      if (!caps.wallets) return setMain(row);
      // Added to the account's wallets; it becomes the main one only if there isn't one yet.
      return sb.from("linked_wallets").upsert({ owner_id: uid, address: row.address, msg: row.msg, sig: row.sig }).then(function (r2) {
        var main = myWallet();
        return r2.error || (main && main !== row.address) ? r2 : setMain(row);
      });
    })
    .then(function (r) {
      btn.disabled = false;
      if (r.error) return fail(r.error);
      sigCache = {};
      toast(t("{wallet} connected and verified.", { wallet: w.info.name }));
      load();
    })
    .catch(function (e) {
      btn.disabled = false;
      var code = e && (e.code || (e.error && e.error.code));
      if (code === 4001 || code === "ACTION_REJECTED") return toast(t("You closed the wallet prompt — nothing was linked."));
      if (code === -32002) return toast(t("{wallet} already has a request open. Click its icon to finish.", { wallet: w.info.name }));
      var m = e && e.message ? e.message : "";
      toast(/dynamically imported module|chrome-extension|moz-extension/i.test(m)
        ? t("{wallet} is not working in this browser — pick a different wallet.", { wallet: w.info.name })
        : (m ? m.slice(0, 90) : t("Could not connect.")));
      // Another wallet may well work: bring the list straight back.
      var others = installedWallets().filter(function (x) { return x.provider !== w.provider; });
      if (others.length) setTimeout(function () { pickWallet(installedWallets()); }, 900);
    });
}
