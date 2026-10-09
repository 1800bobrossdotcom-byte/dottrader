// Dot Trading Post — Protected trades: sending, no-shows, atomic swaps, bonds and payouts.
//
// One of the board's scripts, loaded in order by app.html. They share one global scope on purpose:
// the board was a single script until it outgrew one file, and splitting it this way keeps every
// name it already used. Load order matters only for code that runs immediately.
"use strict";

/* ---- protected trades: sending, no-shows, swaps, bonds (trades.sql) ---- */
var CARRIERS = [
  ["USPS", "https://tools.usps.com/go/TrackConfirmAction?tLabels="], ["UPS", "https://www.ups.com/track?tracknum="],
  ["FedEx", "https://www.fedex.com/fedextrack/?trknbr="], ["DHL", "https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id="],
  ["Royal Mail", "https://www.royalmail.com/track-your-item#/tracking-results/"], ["Canada Post", "https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor="],
  ["Other", ""]
];
function itemById(id) { return items.filter(function (x) { return x.id === id; })[0]; }
function isNft(k) { return k === "erc721" || k === "erc1155"; }
function swappable(o) { var it = itemById(o.item_id); return !!(it && isNft(it.asset_kind) && isNft(o.asset_kind) && Number(it.asset_chain) === Number(o.asset_chain) && window.DTP_SWAP); }
// The board's fee on a swap, for a chain: the swap_fees table when the project has one (the
// database holds a signed order to the same rows), otherwise whatever config.js says.
function swapFeeFor(chain) {
  if (Array.isArray(swapFees)) {
    var row = swapFees.filter(function (r) { return Number(r.chain) === Number(chain); })[0];
    return row && row.recipient && /^0x[0-9a-fA-F]{40}$/.test(row.recipient) && /^[0-9]+$/.test(String(row.wei)) && BigInt(row.wei) > 0n
      ? { recipient: row.recipient, wei: String(row.wei) } : null;
  }
  var f = cfg.swapFee || {};
  return f.recipient && /^0x[0-9a-fA-F]{40}$/.test(f.recipient) && f.wei && f.wei[chain] ? { recipient: f.recipient, wei: String(f.wei[chain]) } : null;
}
// "0.0005 ETH", or null where the chain carries no fee.
function swapFeeText(chain) {
  var f = swapFeeFor(chain);
  if (!f || !window.ethers) return null;
  return window.ethers.utils.formatEther(f.wei) + " " + (SYMBOL[chain] || "");
}
function money(c) { return "$" + (c / 100).toFixed(c % 100 ? 2 : 0); }
function sentLine(o, side, label) {
  var at = o[side + "_sent_at"], how = o[side + "_sent_how"], car = o[side + "_carrier"], ref = o[side + "_ref"];
  var pressed = side === "owner" ? o.confirm_owner : o.confirm_from;
  var st = o[side + "_tx_status"], note = o[side + "_tx_note"];
  var h = '<div class="sideline"><b>' + esc(label) + "</b>";
  if (!at && st === "rejected") h += '<span class="no">' + esc(t("couldn’t confirm on chain — {why}. Mark it sent again with the right transaction.", { why: note || "" })) + "</span>";
  else if (!at) h += '<span class="no">' + esc(t(pressed ? "received theirs" : "not sent yet")) + "</span>";
  else if (how === "in_person") h += "<span>" + esc(t("handed over in person")) + "</span>";
  else if (how === "onchain") {
    // The owner sends the listed NFT, the offerer the offered one — each on its own chain.
    var it = itemById(o.item_id), ch = CHAINS[side === "owner" ? it && it.asset_chain : o.asset_chain];
    var link = ch ? '<a href="' + ch.scan + "/tx/" + esc(ref) + '" target="_blank" rel="noopener">' + esc(t("view transaction")) + "</a>" : esc(shortAddr(ref));
    h += st === "verified" ? '<span class="ok" title="' + esc(note || "") + '">\u2713 ' + esc(t("NFT delivered on chain")) + " · " + link + "</span>"
      : st === "checking" ? "<span>" + esc(t("sent on chain · checking the chain…")) + " · " + link + "</span>"
      : "<span>" + esc(t("sent on chain")) + " · " + link + "</span>";
  } else {
    var base = (CARRIERS.filter(function (c) { return c[0] === car; })[0] || [])[1];
    h += "<span>" + esc(t("posted")) + (car ? " · " + esc(car === "Other" ? t("Other") : car) : "") + " · " + (base ? '<a href="' + base + encodeURIComponent(ref) + '" target="_blank" rel="noopener">' + esc(ref) + "</a>" : esc(ref)) + "</span>";
  }
  return h + "</div>";
}
function protectEl(o, dir, other) {
  var me = dir === "in" ? "owner" : "from", them = dir === "in" ? "from" : "owner";
  var box = document.createElement("div"); box.className = "protect";
  var swap = swappable(o), late = o.ship_by && new Date(o.ship_by) < new Date();
  var h = "";
  if (o.status === "agreed") {
    h += '<div class="ph"><span>' + esc(t(swap ? "Swap on chain" : "Sending")) + "</span>" +
      (o.ship_by && !o.swap_tx ? '<span class="' + (late ? "late" : "") + '">' + esc(late ? t("ship-by date passed") : t("send by {date}", { date: fmtDate(o.ship_by, { weekday: "short", month: "short", day: "numeric" }) })) + "</span>" : "") + "</div>";
    if (swap) {
      if (o.swap_tx) h += sentLine(o, "owner", t("Done"));
      else if (!o.swap_order) {
        var feeTxt = swapFeeText((itemById(o.item_id) || {}).asset_chain);
        h += '<p class="phint">' + esc(dir === "in"
          ? t("Both sides are NFTs on the same chain, so nobody has to send first. Sign the swap once — it’s free — and {who} completes it in one transaction. Both NFTs move together, or neither does.", { who: who(other) })
            + (feeTxt ? " " + t("{who} pays the gas and a {fee} board fee.", { who: who(other), fee: feeTxt }) : "")
          : t("Both sides are NFTs on the same chain, so nobody has to send first. {who} signs the swap, then you complete it in one transaction.", { who: who(other) })
            + (feeTxt ? " " + t("You pay the gas and a {fee} board fee.", { fee: feeTxt }) : "")) + "</p>";
      }
      else {
        var fee = window.DTP_SWAP.feeOf(o.swap_order), it = itemById(o.item_id);
        h += '<p class="phint">' + esc(dir === "in" ? t("Your swap is set up. Waiting for {who} to complete it — it stays open for 7 days.", { who: who(other) })
          : fee !== "0" ? t("The swap is ready. Completing it moves both NFTs at once, plus a {fee} board fee, and you pay the gas.", { fee: window.ethers.utils.formatEther(fee) + " " + (SYMBOL[it.asset_chain] || "") })
          : t("The swap is ready. Completing it moves both NFTs at once, and you pay the gas.")) + "</p>";
      }
    } else {
      h += sentLine(o, me, t("You")) + sentLine(o, them, who(other));
    }
  }
  var bs = bondsBy[o.id] || [];
  if (caps.bond && !swap && (o.status === "agreed" || bs.length)) {
    var mine = bs.filter(function (b) { return b.user_id === uid; })[0], theirs = bs.filter(function (b) { return b.user_id !== uid; })[0];
    var word = function (b) {
      if (!b) return '<span class="no">' + esc(t("no bond")) + "</span>";
      return { pending: '<span class="no">' + esc(t("checkout not finished")) + "</span>", held: "<span>" + esc(t("{amount} held", { amount: money(b.amount_cents) })) + "</span>", released: "<span>" + esc(t("released")) + "</span>",
        forfeited: '<span class="strike">' + esc(t("{amount} forfeited", { amount: money(b.amount_cents) })) + "</span>", expired: '<span class="no">' + esc(t("hold lapsed")) + "</span>", failed: '<span class="no">' + esc(t("card declined")) + "</span>" }[b.status] || esc(b.status);
    };
    h += '<div class="ph"><span>' + esc(t("Bond")) + "</span><span>" + esc(t("{bond} each · {fee} fee", { bond: money(caps.bond.bond_cents), fee: money(caps.bond.fee_cents) })) + "</span></div>" +
      '<div class="sideline"><b>' + esc(t("You")) + "</b>" + word(mine) + '</div><div class="sideline"><b>' + esc(who(other)) + "</b>" + word(theirs) + "</div>";
    if (o.status === "agreed" && (!mine || mine.status !== "held")) h += '<p class="phint">' + esc(t("A hold on your card, not a charge. If the trade completes it’s released and {fee} is kept as the fee. If you send and they don’t, their bond is paid to you. Holds last about a week.", { fee: money(caps.bond.fee_cents) })) + "</p>";
  }
  box.innerHTML = h;
  var acts = document.createElement("div"); acts.className = "acts";
  var btn = function (cls, text, fn) { var b = document.createElement("button"); b.type = "button"; b.className = "btn " + cls; b.textContent = text; b.addEventListener("click", fn); acts.appendChild(b); };
  if (o.status === "agreed") {
    if (swap && !o.swap_tx) {
      if (dir === "in" && !o.swap_order) btn("ok", t("Set up the swap"), function () { setupSwap(o); });
      if (dir === "out" && o.swap_order) btn("ok", t("Complete the swap"), function () { completeSwap(o); });
    }
    if (!swap && !o[me + "_sent_at"]) btn("ok", t("Mark my side sent"), function () { openSent(o); });
    var meDone = o[me + "_sent_at"] || (me === "owner" ? o.confirm_owner : o.confirm_from);
    var themDone = o[them + "_sent_at"] || (them === "owner" ? o.confirm_owner : o.confirm_from);
    if (late && meDone && !themDone) btn("no", t("They didn’t send — close as a no-show"), function () {
      var paid = bs.some(function (b) { return b.user_id !== uid && b.status === "held"; });
      if (!confirm(t(paid ? "Close this trade as a no-show? {who} gets a no-show on their record and their bond is paid to you. Your item goes back on the board."
        : "Close this trade as a no-show? {who} gets a no-show on their record. Your item goes back on the board.", { who: who(other) }))) return;
      sb.rpc("claim_no_show", { p_offer: o.id }).then(function (r) { if (r.error) return fail(r.error); toast(t("Closed as a no-show.")); settleBond(o.id, true); load(); });
    });
    var myBond = bs.filter(function (b) { return b.user_id === uid; })[0];
    if (caps.bond && !swap && (!myBond || myBond.status !== "held")) btn("ghost", t("Hold {amount} on my card", { amount: money(caps.bond.bond_cents) }), function () { startBond(o); });
  }
  if (acts.children.length) box.appendChild(acts);
  return box;
}

function openSent(o) {
  var it0 = itemById(o.item_id) || {}, local = !!it0.local_only;
  // Only an NFT can be sent on chain: the listing's if you listed it, the offer's if you offered it.
  var mine = o.owner_id === uid ? it0 : o, nft = isNft(mine.asset_kind), ch = CHAINS[mine.asset_chain];
  var them = who(o.owner_id === uid ? o.from_id : o.owner_id), dest = verifiedWallet(profiles[o.owner_id === uid ? o.from_id : o.owner_id]);
  var veil = document.createElement("div"); veil.className = "veil";
  var form = document.createElement("form"); form.className = "sheet f";
  form.innerHTML = "<h3>" + esc(t("Mark your side sent")) + "</h3>" +
    '<div class="radios">' +
      (nft ? '<label><input type="radio" name="how" value="onchain" checked> ' + esc(t("Sent on chain")) + "</label>" : "") +
      (local || nft ? "" : '<label><input type="radio" name="how" value="post" checked> ' + esc(t("Posted, with tracking")) + "</label>") +
      (nft ? "" : '<label><input type="radio" name="how" value="in_person"' + (local ? " checked" : "") + "> " + esc(t("Handed over in person")) + "</label>") + "</div>" +
    (local ? '<p class="localnote">' + esc(t("Local pickup only — this trade is a meet-up, so there’s no posting.")) + "</p>" : "") +
    '<div id="s-post" class="rowf"' + (local || nft ? " hidden" : "") + '><div><label for="s-car">' + esc(t("Carrier")) + '</label><select id="s-car">' + CARRIERS.map(function (c) { return '<option value="' + c[0] + '">' + esc(c[0] === "Other" ? t("Other") : c[0]) + "</option>"; }).join("") + "</select></div>" +
      '<div><label for="s-ref">' + esc(t("Tracking number")) + '</label><input id="s-ref" maxlength="80" autocomplete="off"></div></div>' +
    '<div id="s-chain"' + (nft ? "" : " hidden") + '><label for="s-tx">' + esc(t("Transaction hash")) + '</label><input id="s-tx" maxlength="66" placeholder="0x…" autocomplete="off">' +
      (nft ? '<p class="hint" style="margin:8px 0 0">' + esc(t("Send the NFT to {who}’s linked wallet on {chain}, then paste the transaction. Dot reads it on chain and confirms that exact NFT reached them. No bridge needed — each NFT stays on its own chain.", { who: them, chain: ch ? ch.name : t("its chain") })) + "</p>" +
        (dest ? '<p class="hint" style="margin:6px 0 0">' + t("Their main wallet: {addr}", { addr: '<b style="font-family:var(--mono);word-break:break-all">' + esc(dest) + "</b>" }) + "</p>" : "") : "") + "</div>" +
    '<p class="hint" style="margin:0">' + esc(t("{who} sees this straight away. Once it’s marked, you can’t cancel the trade — and if they never send theirs, you can close it as a no-show after the ship-by date.", { who: them })) + "</p>" +
    '<div class="acts"><button class="btn ok" type="submit">' + esc(t("Mark sent")) + '</button><button class="btn ghost" type="button" data-x>' + esc(t("Cancel")) + "</button></div>";
  veil.appendChild(form); document.body.appendChild(veil);
  var close = function () { veil.remove(); };
  form.querySelector("[data-x]").addEventListener("click", close);
  veil.addEventListener("click", function (e) { if (e.target === veil) close(); });
  var how = function () { return form.querySelector("input[name=how]:checked").value; };
  Array.prototype.forEach.call(form.querySelectorAll("input[name=how]"), function (r) {
    r.addEventListener("change", function () { form.querySelector("#s-post").hidden = how() !== "post"; form.querySelector("#s-chain").hidden = how() !== "onchain"; });
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var h = how(), ref = h === "post" ? form.querySelector("#s-ref").value.trim() : h === "onchain" ? form.querySelector("#s-tx").value.trim() : "";
    if (h === "post" && !ref) return toast(t("Add the tracking number."));
    if (h === "onchain" && !/^0x[0-9a-fA-F]{64}$/.test(ref)) return toast(t("That doesn’t look like a transaction hash."));
    sb.rpc("mark_sent", { p_offer: o.id, p_how: h, p_carrier: h === "post" ? form.querySelector("#s-car").value : "", p_ref: ref }).then(function (r) {
      if (r.error) return fail(r.error);
      close(); toast(t(h === "onchain" ? "Marked sent — checking the chain now." : "Marked sent.")); load();
    });
  });
}

// A signer for one of this account's linked wallets, on the right chain. `wants` narrows it to the
// wallets that can do the job (the one holding the NFT); the first is the one asked for.
function walletSigner(chainId, wants) {
  wants = (wants && wants.length ? wants : myWallets()).map(function (x) { return x.toLowerCase(); });
  var want = wants[0];
  if (!want) return Promise.reject(new Error(t("Link your wallet first — tap the wallet button at the top.")));
  var list = installedWallets();
  if (!list.length) return Promise.reject(new Error(t("No wallet found in this browser. On a phone, open the board inside your wallet app.")));
  return Promise.all(list.map(function (w) {
    return w.provider.request({ method: "eth_accounts" }).then(function (a) { return { w: w, a: (a || []).map(function (x) { return String(x).toLowerCase(); }) }; }, function () { return { w: w, a: [] }; });
  })).then(function (rs) {
    var hit = rs.filter(function (r) { return r.a.some(function (a) { return wants.indexOf(a) >= 0; }); })[0];
    var w = (hit || rs[0]).w;
    return w.provider.request({ method: "eth_requestAccounts" }).then(function (acc) {
      if (!acc || wants.indexOf(String(acc[0]).toLowerCase()) < 0) throw new Error(t("Switch your wallet to {addr} — that’s the linked wallet holding this NFT.", { addr: shortAddr(want) }));
      return w.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + Number(chainId).toString(16) }] }).catch(function (e) {
        if (e && (e.code === 4902 || /unrecognized|not been added|not added/i.test(e.message || ""))) throw new Error(t("Add {chain} to your wallet first, then try again.", { chain: CHAINS[chainId].name }));
        throw e;
      }).then(function () { return new window.ethers.providers.Web3Provider(w.provider, "any").getSigner(); });
    });
  });
}
function walletFail(e) {
  var code = e && (e.code || (e.error && e.error.code));
  if (code === 4001 || code === "ACTION_REJECTED") return toast(t("Cancelled in your wallet — nothing happened."));
  if (code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test((e && e.message) || "")) return toast(t("Not enough in that wallet for the gas and fee."));
  console.error(e);
  toast(((e && (e.reason || e.message)) || t("The wallet didn’t finish.")).slice(0, 120));
}
// Which of my linked wallets hold this NFT; all of them if the chain can't say.
function holdingWallets(a) {
  var mine = myWallets();
  return Promise.all(mine.map(function (w) { return checkOwnership(a, w); })).then(function (rs) {
    var yes = mine.filter(function (w, i) { return rs[i] === true; });
    return yes.length ? yes : mine;
  });
}
function setupSwap(o) {
  var it = itemById(o.item_id), chain = Number(it.asset_chain), signer, addr;
  toast(t("Open your wallet…"));
  holdingWallets(it).then(function (ws) { return walletSigner(chain, ws); }).then(function (s) { signer = s; return s.getAddress(); })
    .then(function (a) { addr = a; return window.DTP_SWAP.ensureApproval(signer, it.asset_contract, addr); })
    .then(function (approved) { if (approved) toast(t("Approved. Now sign the swap — signing is free.")); return window.DTP_SWAP.seaport(signer).getCounter(addr); })
    .then(function (counter) {
      var c = window.DTP_SWAP.buildOrder({ offerer: addr, counter: counter.toString(), fee: swapFeeFor(chain),
        give: { kind: it.asset_kind, contract: it.asset_contract, id: it.asset_token_id },
        get: { kind: o.asset_kind, contract: o.asset_contract, id: o.asset_token_id } });
      return window.DTP_SWAP.sign(signer, c, chain).then(function (sig) { return sb.rpc("post_swap", { p_offer: o.id, p_order: c, p_sig: sig }); });
    })
    .then(function (r) { if (r.error) return fail(r.error); toast(t("Swap set up. {who} can complete it now.", { who: who(o.from_id) })); load(); })
    .catch(walletFail);
}
function completeSwap(o) {
  var it = itemById(o.item_id), chain = Number(it.asset_chain), signer;
  // The order may come from any wallet the lister has linked, but only from one of those.
  var listers = walletsOf(o.owner_id), from = String((o.swap_order || {}).offerer || "").toLowerCase();
  var lister = listers.indexOf(from) >= 0 ? from : listers[0];
  try {
    window.DTP_SWAP.check(o.swap_order, { counterparty: lister, fee: swapFeeFor(chain) || { recipient: "", wei: "0" },
      receive: { kind: it.asset_kind, contract: it.asset_contract, id: it.asset_token_id },
      pay: { kind: o.asset_kind, contract: o.asset_contract, id: o.asset_token_id } });
  } catch (e) { return toast(e.message); }
  toast(t("Open your wallet…"));
  holdingWallets(o).then(function (ws) { return walletSigner(chain, ws); }).then(function (s) { signer = s; return s.getAddress(); })
    .then(function (addr) { return window.DTP_SWAP.ensureApproval(signer, o.asset_contract, addr); })
    .then(function () { toast(t("Confirm the swap in your wallet.")); return window.DTP_SWAP.fulfill(signer, o.swap_order, o.swap_sig); })
    .then(function (tx) { toast(t("Swapping — waiting for the chain…")); return tx.wait(); })
    .then(function (rc) {
      if (!rc || rc.status !== 1) throw new Error(t("The swap transaction failed on chain. Nothing moved."));
      return sb.rpc("record_swap", { p_offer: o.id, p_tx: rc.transactionHash });
    })
    .then(function (r) { if (r && r.error) return fail(r.error); toast(t("Swapped — both NFTs moved. Press your dot to close the trade.")); load(); })
    .catch(walletFail);
}

function bondCall(body) {
  return sb.auth.getSession().then(function (r) {
    var tok = r.data && r.data.session && r.data.session.access_token;
    if (!tok) throw new Error(t("Sign in again first."));
    return fetch(fnUrl("bond"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok, apikey: cfg.anonKey }, body: JSON.stringify(body) });
  }).then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error(j.error || t("The bond service didn’t answer.")); return j; }); });
}
function startBond(o) {
  toast(t("Opening a secure Stripe checkout…"));
  bondCall({ action: "start", offer_id: o.id }).then(function (j) { location.href = j.url; }).catch(fail);
}
function settleBond(offerId, now) {
  if (!caps.bond || (settledOnce[offerId] && !now)) return;
  settledOnce[offerId] = true;
  bondCall({ action: "settle", offer_id: offerId }).then(function (j) { if (j.settled) load(); }).catch(function (e) { settledOnce[offerId] = false; console.error(e); });
}
function paintPayouts() {
  var box = $("payoutBox"), owed = payouts.filter(function (p) { return p.status === "owed"; });
  box.hidden = !owed.length; if (!owed.length) return;
  var total = owed.reduce(function (s, p) { return s + p.amount_cents; }, 0), ready = owed.some(function (p) { return p.approved; });
  box.innerHTML = "<span>" + esc(t("You’re owed {amount} from a trade where the other side never sent.", { amount: money(total) }) + (ready ? "" : " " + t("It’s being reviewed — usually within a day."))) + "</span>";
  if (ready) {
    var b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.textContent = t("Claim {amount}", { amount: money(total) });
    b.addEventListener("click", claimPayout); box.appendChild(b);
  }
}
function claimPayout() {
  toast(t("One moment…"));
  bondCall({ action: "payout" }).then(function (j) {
    if (j.onboarding) { toast(t("Stripe needs a few details to pay you — opening it now.")); return setTimeout(function () { location.href = j.onboarding; }, 600); }
    toast(t(j.paid ? "Paid — it lands in your bank in a few days." : "Nothing ready to pay yet.")); load();
  }).catch(fail);
}
