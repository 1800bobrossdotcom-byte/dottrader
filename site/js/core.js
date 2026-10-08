// Dot Trading Post — Categories, chains and reading them: the constants and the raw on-chain checks.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

var $ = function (id) { return document.getElementById(id); };
// An Edge Function's URL, by its address in config.js (see the note there).
// A listing's public address: its title as words, then its id (kept in step with api/_lib.js).
var ACC = "\u00e1\u00e0\u00e2\u00e4\u00e3\u00e5\u0101\u00e9\u00e8\u00ea\u00eb\u0113\u00ed\u00ec\u00ee\u00ef\u012b\u00f3\u00f2\u00f4\u00f6\u00f5\u00f8\u014d\u00fa\u00f9\u00fb\u00fc\u016b\u00f1\u00e7\u00fd\u00ff", PLAIN = "aaaaaaaeeeeeiiiiiooooooouuuuuncyy";
function itemPath(it) {
  var s = String(it.title || "").toLowerCase().replace(/[^\x00-\x7f]/g, function (c) { var i = ACC.indexOf(c); return i < 0 ? " " : PLAIN[i]; });
  s = s.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length > 60) s = s.slice(0, 60).replace(/-[^-]*$/, "");
  return "/item/" + (s ? s + "-" : "") + it.id;
}
function fnUrl(k) {
  var c = window.DTP_CONFIG || {}, f = (c.functions || {})[k] || { verify: "verify-item", bond: "bond" }[k];
  return c.url + "/functions/v1/" + f;
}

var GROUPS = [
  ["Collectables", ["Trading Cards", "NFTs", "Comics", "Collectibles", "Coins & Stamps", "Memorabilia", "Antiques"]],
  ["Games & Tech", ["Video Games", "Consoles & Retro", "Computers", "Phones", "Electronics", "Cameras", "Audio & Hi-Fi"]],
  ["Media", ["Books", "Music & Vinyl", "Film & TV", "Board Games & Puzzles"]],
  ["Home", ["Furniture", "Home & Kitchen", "Tools & DIY", "Garden", "Appliances"]],
  ["Wearables", ["Clothing", "Shoes & Trainers", "Watches", "Jewellery", "Bags", "Beauty"]],
  ["Sport & Outdoors", ["Sports Gear", "Bikes", "Camping & Outdoors", "Fitness"]],
  ["Hobbies", ["Musical Instruments", "Art", "Craft & Sewing", "Models & Hobby", "Toys & Figures"]],
  ["Vehicles", ["Cars & Parts", "Motorbikes"]],
  ["Everything else", ["Baby & Kids", "Pet Supplies", "Office", "Industrial", "Tickets", "Services & Skills", "Other"]]
];
// The quick buttons lead with where the board is liveliest: cards, games, retro and collectibles.
var QUICK = ["Trading Cards", "NFTs", "Video Games", "Consoles & Retro", "Collectibles", "Comics", "Toys & Figures", "Electronics"];
// One colour per group, so a card tells you its corner of the board before you read it.
var HUES = ["var(--rose)", "var(--have)", "var(--plum)", "var(--want)", "var(--teal)", "var(--dot)", "var(--pop)", "#6B7280", "var(--faint)"];
var CAT_HUE = {};
GROUPS.forEach(function (g, gi) { g[1].forEach(function (c) { CAT_HUE[c] = HUES[gi]; }); });
function hueOf(cat) { return CAT_HUE[cat] || "var(--line)"; }
function initial(id) { var n = who(id); return id && id === uid ? (profiles[id] && profiles[id].name ? profiles[id].name : "Y").charAt(0) : n.charAt(0); }
var RANKS = [[0, "New trader"], [3, "Known"], [8, "Trusted"], [16, "Well vouched"], [30, "Pillar of the post"]];

// Cross-chain works because nothing is swapped atomically: each side is simply checked on its
// own chain. Adding a chain is one line here and nothing else.
var CHAINS = {
  1:        { name: "Ethereum",  rpc: "https://ethereum-rpc.publicnode.com",        scan: "https://etherscan.io" },
  8453:     { name: "Base",      rpc: "https://mainnet.base.org",                   scan: "https://basescan.org" },
  42161:    { name: "Arbitrum",  rpc: "https://arbitrum-one-rpc.publicnode.com",    scan: "https://arbiscan.io" },
  10:       { name: "Optimism",  rpc: "https://optimism-rpc.publicnode.com",        scan: "https://optimistic.etherscan.io" },
  137:      { name: "Polygon",   rpc: "https://polygon-bor-rpc.publicnode.com",     scan: "https://polygonscan.com" },
  56:       { name: "BNB Chain", rpc: "https://bsc-rpc.publicnode.com",             scan: "https://bscscan.com" },
  43114:    { name: "Avalanche", rpc: "https://avalanche-c-chain-rpc.publicnode.com", scan: "https://snowtrace.io" },
  7777777:  { name: "Zora",      rpc: "https://rpc.zora.energy",                    scan: "https://explorer.zora.energy" }
};
var CHAIN_IDS = [8453, 1, 42161, 10, 137, 56, 43114, 7777777];

function pad32(hex) { return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0"); }
function rpc(chainId, to, data) {
  var c = CHAINS[chainId];
  if (!c) return Promise.reject(new Error("unknown chain"));
  return fetch(c.rpc, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: to, data: data }, "latest"] })
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (j.error || !j.result) throw new Error((j.error && j.error.message) || "read failed");
    if (j.result === "0x") { var e = new Error("no contract at that address on this chain"); e.nocontract = true; throw e; }
    return j.result;
  });
}
// Which of our chains actually has code at this address. Used to catch "wrong chain" before it
// turns into a false "no longer held".
var codeCache = {};
function chainsWithCode(contract) {
  var key = contract.toLowerCase();
  if (codeCache[key]) return codeCache[key];
  codeCache[key] = Promise.all(CHAIN_IDS.map(function (id) {
    return fetch(CHAINS[id].rpc, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [contract, "latest"] }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { return j.result && j.result !== "0x" ? id : null; })
      .catch(function () { return null; });
  })).then(function (r) { return r.filter(Boolean); });
  return codeCache[key];
}

// Does `holder` still hold this asset? Answered by the chain, in the viewer's own browser, so
// the board never has to be believed about it. Null means the question could not be reached —
// deliberately different from "no", which would brand an honest listing a fake on a flaky RPC.
var ownCache = {};
function checkOwnership(a, holder) {
  if (!a || !a.asset_kind || !holder || !CHAINS[a.asset_chain]) return Promise.resolve(null);
  var key = [a.asset_chain, a.asset_contract, a.asset_token_id, holder].join("|");
  if (key in ownCache) return Promise.resolve(ownCache[key]);
  var p;
  if (a.asset_kind === "erc721") {
    p = rpc(a.asset_chain, a.asset_contract, "0x6352211e" + pad32(BigInt(a.asset_token_id).toString(16)))
      .then(function (res) { return "0x" + res.slice(-40).toLowerCase() === holder.toLowerCase(); });
  } else if (a.asset_kind === "erc1155") {
    p = rpc(a.asset_chain, a.asset_contract, "0x00fdd58e" + pad32(holder) + pad32(BigInt(a.asset_token_id).toString(16)))
      .then(function (res) { return BigInt(res) > 0n; });
  } else {
    p = rpc(a.asset_chain, a.asset_contract, "0x70a08231" + pad32(holder))
      .then(function (res) { return BigInt(res) > 0n; });
  }
  return p.then(function (v) { ownCache[key] = v; return v; })
          .catch(function (e) { return e && e.nocontract ? "nocontract" : null; });
}
// The same question for a trader with several wallets: true if any holds it, false only when
// every one of them answered no.
function heldByAny(a, holders) {
  if (!holders || !holders.length) return Promise.resolve(false);
  return Promise.all(holders.map(function (h) { return checkOwnership(a, h); })).then(function (rs) {
    if (rs.indexOf(true) >= 0) return true;
    if (rs.indexOf("nocontract") >= 0) return "nocontract";
    return rs.indexOf(null) >= 0 ? null : false;
  });
}
// Who holds an ERC-721 right now, so "not in your wallets" can say where it is instead.
function holderOf(a) {
  if (!a || a.asset_kind !== "erc721" || !CHAINS[a.asset_chain]) return Promise.resolve(null);
  return rpc(a.asset_chain, a.asset_contract, "0x6352211e" + pad32(BigInt(a.asset_token_id).toString(16)))
    .then(function (res) { return "0x" + res.slice(-40).toLowerCase(); }, function () { return null; });
}
