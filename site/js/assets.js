// Dot Trading Post — What a digital asset looks like, and whether a wallet link is genuine.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* ---- what a digital asset looks like, read from the chain ----
   tokenURI / uri → metadata JSON → image. IPFS and Arweave go through public gateways; data: URIs
   are decoded in place. Nothing here is trusted for ownership — that is checkOwnership's job. */
var metaCache = {};
function abiString(hex) {
  try {
    var h = hex.slice(2);
    var off = parseInt(h.slice(0, 64), 16) * 2;
    var len = parseInt(h.slice(off, off + 64), 16);
    var data = h.slice(off + 64, off + 64 + len * 2);
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = parseInt(data.substr(i * 2, 2), 16);
    return new TextDecoder().decode(bytes);
  } catch (e) { return ""; }
}
// ipfs.io and most public IPFS gateways stopped serving direct requests in 2026; Filebase still
// does, with open CORS. Same rule as api/nft.js: ipfs:// and links to any gateway go to Filebase.
function gateway(u) {
  if (!u || typeof u !== "string") return null;
  var m = /^ipfs:\/\/(?:ipfs\/)?(.+)$/.exec(u) || /^https?:\/\/[^/]+\/ipfs\/(.+)$/.exec(u);
  if (m) return "https://ipfs.filebase.io/ipfs/" + m[1];
  var sub = /^https?:\/\/((?:Qm|baf)[a-z0-9]+)\.ipfs\.[^/]+\/?(.*)$/i.exec(u);
  if (sub) return "https://ipfs.filebase.io/ipfs/" + sub[1] + (sub[2] ? "/" + sub[2] : "");
  if (u.indexOf("ar://") === 0) return "https://arweave.net/" + u.slice(5);
  return u;
}
function readJsonUri(u) {
  var m = /^data:application\/json(;[^,]*)?,([\s\S]*)$/.exec(u);
  if (m) return Promise.resolve(JSON.parse(/base64/.test(m[1] || "") ? atob(m[2]) : decodeURIComponent(m[2])));
  return fetch(gateway(u)).then(function (r) { if (!r.ok) throw new Error("metadata " + r.status); return r.json(); });
}
function assetMeta(a) {
  if (!a || !a.asset_kind || !a.asset_contract || !CHAINS[a.asset_chain]) return Promise.resolve(null);
  var key = [a.asset_chain, a.asset_contract, a.asset_kind, a.asset_token_id].join("|").toLowerCase();
  if (metaCache[key]) return metaCache[key];
  var collection = rpc(a.asset_chain, a.asset_contract, "0x06fdde03").then(abiString).catch(function () { return ""; });
  var p;
  if (a.asset_kind === "erc20") {
    p = Promise.all([
      rpc(a.asset_chain, a.asset_contract, "0x95d89b41").then(abiString).catch(function () { return ""; }),
      collection
    ]).then(function (r) { return { kind: "erc20", symbol: r[0], name: r[1], collection: r[1], image: null }; });
  } else {
    var idHex = pad32(BigInt(a.asset_token_id).toString(16));
    var sel = a.asset_kind === "erc721" ? "0xc87b56dd" : "0x0e89341c";
    // The site's own server function first (api/nft.js): it can read metadata hosts that block
    // browsers, and its answers are cached at the edge. Reading straight from the chain in the
    // browser is the fallback for when it is unreachable.
    var viaServer = fetch("/api/nft?chain=" + a.asset_chain + "&contract=" + a.asset_contract +
        "&id=" + encodeURIComponent(a.asset_token_id) + "&kind=" + a.asset_kind)
      .then(function (r) { if (!r.ok) throw new Error("api " + r.status); return r.json(); })
      .then(function (m) {
        if (m.partial && !m.name) throw new Error("partial");
        return { kind: a.asset_kind, name: m.name || "", image: m.image || null, description: m.description || "", collection: m.collection || "" };
      });
    p = viaServer.catch(function () { return direct(); });
  }
  function direct() {
    return rpc(a.asset_chain, a.asset_contract, sel + idHex).then(abiString).then(function (uri) {
      uri = (uri || "").replace(/\{id\}/g, idHex);
      if (!uri) throw new Error("no uri");
      return readJsonUri(uri);
    }).then(function (j) {
      return collection.then(function (cn) {
        var img = j.image || j.image_url || j.imageUrl || j.animation_url || (j.properties && j.properties.image);
        return { kind: a.asset_kind, name: j.name || "", image: gateway(img), description: j.description || "", collection: cn };
      });
    }, function () {
      return collection.then(function (cn) { return { kind: a.asset_kind, name: "", image: null, description: "", collection: cn, partial: true }; });
    });
  }
  metaCache[key] = p.catch(function () { return null; });
  return metaCache[key];
}
// Shared minting contracts (OpenSea's storefront, Rarible's, Manifold-style factories) put every
// artist under one name; that name says nothing about the piece, so it is left off.
function genericCollection(n) { return /shared storefront|^rarible|^opensea collections?$|^mintable/i.test(n || ""); }
function shortId(t) { t = String(t == null ? "" : t); return t.length > 14 ? t.slice(0, 6) + "\u2026" + t.slice(-4) : t; }
var pendingMeta = [];
function runMeta() {
  var jobs = pendingMeta; pendingMeta = [];
  jobs.forEach(function (j) {
    assetMeta(j.asset).then(function (m) {
      var art = document.querySelector('[data-art="' + j.id + '"]');
      var nm = document.querySelector('[data-nftname="' + j.id + '"]');
      if (nm) {
        var bits = [];
        if (m && m.collection && !genericCollection(m.collection)) bits.push(m.collection);
        if (m && m.name) bits.push(m.name);
        if (m && m.kind === "erc20" && m.symbol) bits.push(m.symbol);
        nm.textContent = bits.join(" · ");
        nm.hidden = !bits.length;
      }
      if (art) {
        if (m && m.image) {
          art.innerHTML = '<img src="' + esc(m.image) + '" alt="' + esc(m.name || "") + '" loading="lazy">';
        } else {
          art.innerHTML = '<div class="artph">' + (m && m.partial ? "Artwork not reachable from here" : "No artwork on chain") + "</div>";
        }
      }
    });
  });
}

// The signature is public, so each viewer recovers the address themselves rather than taking
// the stored `wallet_address` at its word.
var sigCache = {};
function verifiedWallet(p) {
  if (!p || !p.wallet_address || !p.wallet_sig || !p.wallet_msg) return null;
  var key = p.wallet_sig;
  if (key in sigCache) return sigCache[key];
  var ok = false;
  try {
    ok = window.ethers &&
      window.ethers.utils.verifyMessage(p.wallet_msg, p.wallet_sig).toLowerCase() === p.wallet_address.toLowerCase();
  } catch (e) { ok = false; }
  sigCache[key] = ok ? p.wallet_address : null;
  return sigCache[key];
}
function shortAddr(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : ""; }
