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
function swapFeeFor(chain) {
  var f = cfg.swapFee || {};
  return f.recipient && /^0x[0-9a-fA-F]{40}$/.test(f.recipient) && f.wei && f.wei[chain] ? { recipient: f.recipient, wei: String(f.wei[chain]) } : null;
}
function money(c) { return "$" + (c / 100).toFixed(c % 100 ? 2 : 0); }
function sentLine(o, side, label) {
  var at = o[side + "_sent_at"], how = o[side + "_sent_how"], car = o[side + "_carrier"], ref = o[side + "_ref"];
  var pressed = side === "owner" ? o.confirm_owner : o.confirm_from;
  var h = '<div class="sideline"><b>' + esc(label) + "</b>";
  if (!at) h += '<span class="no">' + (pressed ? "received theirs" : "not sent yet") + "</span>";
  else if (how === "in_person") h += "<span>handed over in person</span>";
  else if (how === "onchain") {
    var it = itemById(o.item_id), ch = CHAINS[(it && it.asset_chain) || o.asset_chain];
    h += "<span>sent on chain · " + (ch ? '<a href="' + ch.scan + "/tx/" + esc(ref) + '" target="_blank" rel="noopener">view transaction</a>' : esc(shortAddr(ref))) + "</span>";
  } else {
    var base = (CARRIERS.filter(function (c) { return c[0] === car; })[0] || [])[1];
    h += "<span>posted" + (car ? " · " + esc(car) : "") + " · " + (base ? '<a href="' + base + encodeURIComponent(ref) + '" target="_blank" rel="noopener">' + esc(ref) + "</a>" : esc(ref)) + "</span>";
  }
  return h + "</div>";
}
function protectEl(o, dir, other) {
  var me = dir === "in" ? "owner" : "from", them = dir === "in" ? "from" : "owner";
  var box = document.createElement("div"); box.className = "protect";
  var swap = swappable(o), late = o.ship_by && new Date(o.ship_by) < new Date();
  var h = "";
  if (o.status === "agreed") {
    h += '<div class="ph"><span>' + (swap ? "Swap on chain" : "Sending") + "</span>" +
      (o.ship_by && !o.swap_tx ? '<span class="' + (late ? "late" : "") + '">' + (late ? "ship-by date passed" : "send by " + new Date(o.ship_by).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })) + "</span>" : "") + "</div>";
    if (swap) {
      if (o.swap_tx) h += sentLine(o, "owner", "Done");
      else if (!o.swap_order) h += '<p class="phint">' + (dir === "in"
        ? "Both sides are NFTs on the same chain, so nobody has to send first. Sign the swap once — it’s free — and " + esc(who(other)) + " completes it in one transaction. Both NFTs move together, or neither does."
        : "Both sides are NFTs on the same chain, so nobody has to send first. " + esc(who(other)) + " signs the swap, then you complete it in one transaction.") + "</p>";
      else {
        var fee = window.DTP_SWAP.feeOf(o.swap_order), it = itemById(o.item_id);
        h += '<p class="phint">' + (dir === "in" ? "Your swap is set up. Waiting for " + esc(who(other)) + " to complete it — it stays open for 7 days."
          : "The swap is ready. Completing it moves both NFTs at once" + (fee !== "0" ? ", plus a " + esc(window.ethers.utils.formatEther(fee)) + " " + (SYMBOL[it.asset_chain] || "") + " board fee" : "") + ", and you pay the gas.") + "</p>";
      }
    } else {
      h += sentLine(o, me, "You") + sentLine(o, them, who(other));
    }
  }
  var bs = bondsBy[o.id] || [];
  if (caps.bond && !swap && (o.status === "agreed" || bs.length)) {
    var mine = bs.filter(function (b) { return b.user_id === uid; })[0], theirs = bs.filter(function (b) { return b.user_id !== uid; })[0];
    var word = function (b) {
      if (!b) return '<span class="no">no bond</span>';
      return { pending: '<span class="no">checkout not finished</span>', held: "<span>" + money(b.amount_cents) + " held</span>", released: "<span>released</span>",
        forfeited: '<span class="strike">' + money(b.amount_cents) + " forfeited</span>", expired: '<span class="no">hold lapsed</span>', failed: '<span class="no">card declined</span>' }[b.status] || esc(b.status);
    };
    h += '<div class="ph"><span>Bond</span><span>' + money(caps.bond.bond_cents) + " each · " + money(caps.bond.fee_cents) + " fee</span></div>" +
      '<div class="sideline"><b>You</b>' + word(mine) + '</div><div class="sideline"><b>' + esc(who(other)) + "</b>" + word(theirs) + "</div>";
    if (o.status === "agreed" && (!mine || mine.status !== "held")) h += '<p class="phint">A hold on your card, not a charge. If the trade completes it’s released and ' + money(caps.bond.fee_cents) +
      " is kept as the fee. If you send and they don’t, their bond is paid to you. Holds last about a week.</p>";
  }
  box.innerHTML = h;
  var acts = document.createElement("div"); acts.className = "acts";
  var btn = function (cls, text, fn) { var b = document.createElement("button"); b.type = "button"; b.className = "btn " + cls; b.textContent = text; b.addEventListener("click", fn); acts.appendChild(b); };
  if (o.status === "agreed") {
    if (swap && !o.swap_tx) {
      if (dir === "in" && !o.swap_order) btn("ok", "Set up the swap", function () { setupSwap(o); });
      if (dir === "out" && o.swap_order) btn("ok", "Complete the swap", function () { completeSwap(o); });
    }
    if (!swap && !o[me + "_sent_at"]) btn("ok", "Mark my side sent", function () { openSent(o); });
    var meDone = o[me + "_sent_at"] || (me === "owner" ? o.confirm_owner : o.confirm_from);
    var themDone = o[them + "_sent_at"] || (them === "owner" ? o.confirm_owner : o.confirm_from);
    if (late && meDone && !themDone) btn("no", "They didn’t send — close as a no-show", function () {
      if (!confirm("Close this trade as a no-show? " + who(other) + " gets a no-show on their record" + (bs.some(function (b) { return b.user_id !== uid && b.status === "held"; }) ? " and their bond is paid to you" : "") + ". Your item goes back on the board.")) return;
      sb.rpc("claim_no_show", { p_offer: o.id }).then(function (r) { if (r.error) return fail(r.error); toast("Closed as a no-show."); settleBond(o.id, true); load(); });
    });
    var myBond = bs.filter(function (b) { return b.user_id === uid; })[0];
    if (caps.bond && !swap && (!myBond || myBond.status !== "held")) btn("ghost", "Hold " + money(caps.bond.bond_cents) + " on my card", function () { startBond(o); });
  }
  if (acts.children.length) box.appendChild(acts);
  return box;
}

function openSent(o) {
  var veil = document.createElement("div"); veil.className = "veil";
  var form = document.createElement("form"); form.className = "sheet f";
  form.innerHTML = "<h3>Mark your side sent</h3>" +
    '<div class="radios">' +
      '<label><input type="radio" name="how" value="post" checked> Posted, with tracking</label>' +
      '<label><input type="radio" name="how" value="in_person"> Handed over in person</label>' +
      '<label><input type="radio" name="how" value="onchain"> Sent on chain</label></div>' +
    '<div id="s-post" class="rowf"><div><label for="s-car">Carrier</label><select id="s-car">' + CARRIERS.map(function (c) { return "<option>" + c[0] + "</option>"; }).join("") + "</select></div>" +
      '<div><label for="s-ref">Tracking number</label><input id="s-ref" maxlength="80" autocomplete="off"></div></div>' +
    '<div id="s-chain" hidden><label for="s-tx">Transaction hash</label><input id="s-tx" maxlength="66" placeholder="0x…" autocomplete="off"></div>' +
    '<p class="hint" style="margin:0">' + esc(who(o.owner_id === uid ? o.from_id : o.owner_id)) + " sees this straight away. Once it’s marked, you can’t cancel the trade — and if they never send theirs, you can close it as a no-show after the ship-by date.</p>" +
    '<div class="acts"><button class="btn ok" type="submit">Mark sent</button><button class="btn ghost" type="button" data-x>Cancel</button></div>';
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
    if (h === "post" && !ref) return toast("Add the tracking number.");
    if (h === "onchain" && !/^0x[0-9a-fA-F]{64}$/.test(ref)) return toast("That doesn’t look like a transaction hash.");
    sb.rpc("mark_sent", { p_offer: o.id, p_how: h, p_carrier: h === "post" ? form.querySelector("#s-car").value : "", p_ref: ref }).then(function (r) {
      if (r.error) return fail(r.error);
      close(); toast("Marked sent."); load();
    });
  });
}

// The wallet that controls this account's linked address, on the right chain.
function walletSigner(chainId) {
  var want = myWallet();
  if (!want) return Promise.reject(new Error("Link your wallet first — tap the wallet button at the top."));
  var list = installedWallets();
  if (!list.length) return Promise.reject(new Error("No wallet found in this browser. On a phone, open the board inside your wallet app."));
  return Promise.all(list.map(function (w) {
    return w.provider.request({ method: "eth_accounts" }).then(function (a) { return { w: w, a: (a || []).map(function (x) { return String(x).toLowerCase(); }) }; }, function () { return { w: w, a: [] }; });
  })).then(function (rs) {
    var hit = rs.filter(function (r) { return r.a.indexOf(want.toLowerCase()) >= 0; })[0];
    var w = (hit || rs[0]).w;
    return w.provider.request({ method: "eth_requestAccounts" }).then(function (acc) {
      if (!acc || String(acc[0]).toLowerCase() !== want.toLowerCase()) throw new Error("Switch your wallet to " + shortAddr(want) + " — that’s the wallet linked to this account.");
      return w.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + Number(chainId).toString(16) }] }).catch(function (e) {
        if (e && (e.code === 4902 || /unrecognized|not been added|not added/i.test(e.message || ""))) throw new Error("Add " + CHAINS[chainId].name + " to your wallet first, then try again.");
        throw e;
      }).then(function () { return new window.ethers.providers.Web3Provider(w.provider, "any").getSigner(); });
    });
  });
}
function walletFail(e) {
  var code = e && (e.code || (e.error && e.error.code));
  if (code === 4001 || code === "ACTION_REJECTED") return toast("Cancelled in your wallet — nothing happened.");
  if (code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test((e && e.message) || "")) return toast("Not enough in that wallet for the gas" + " and fee.");
  console.error(e);
  toast(((e && (e.reason || e.message)) || "The wallet didn’t finish.").slice(0, 120));
}
function setupSwap(o) {
  var it = itemById(o.item_id), chain = Number(it.asset_chain), signer, addr;
  toast("Open your wallet…");
  walletSigner(chain).then(function (s) { signer = s; return s.getAddress(); })
    .then(function (a) { addr = a; return window.DTP_SWAP.ensureApproval(signer, it.asset_contract, addr); })
    .then(function (approved) { if (approved) toast("Approved. Now sign the swap — signing is free."); return window.DTP_SWAP.seaport(signer).getCounter(addr); })
    .then(function (counter) {
      var c = window.DTP_SWAP.buildOrder({ offerer: addr, counter: counter.toString(), fee: swapFeeFor(chain),
        give: { kind: it.asset_kind, contract: it.asset_contract, id: it.asset_token_id },
        get: { kind: o.asset_kind, contract: o.asset_contract, id: o.asset_token_id } });
      return window.DTP_SWAP.sign(signer, c, chain).then(function (sig) { return sb.rpc("post_swap", { p_offer: o.id, p_order: c, p_sig: sig }); });
    })
    .then(function (r) { if (r.error) return fail(r.error); toast("Swap set up. " + who(o.from_id) + " can complete it now."); load(); })
    .catch(walletFail);
}
function completeSwap(o) {
  var it = itemById(o.item_id), chain = Number(it.asset_chain), signer;
  var lister = profiles[o.owner_id] && profiles[o.owner_id].wallet_address;
  try {
    window.DTP_SWAP.check(o.swap_order, { counterparty: lister, fee: swapFeeFor(chain) || { recipient: "", wei: "0" },
      receive: { kind: it.asset_kind, contract: it.asset_contract, id: it.asset_token_id },
      pay: { kind: o.asset_kind, contract: o.asset_contract, id: o.asset_token_id } });
  } catch (e) { return toast(e.message); }
  toast("Open your wallet…");
  walletSigner(chain).then(function (s) { signer = s; return s.getAddress(); })
    .then(function (addr) { return window.DTP_SWAP.ensureApproval(signer, o.asset_contract, addr); })
    .then(function () { toast("Confirm the swap in your wallet."); return window.DTP_SWAP.fulfill(signer, o.swap_order, o.swap_sig); })
    .then(function (tx) { toast("Swapping — waiting for the chain…"); return tx.wait(); })
    .then(function (rc) {
      if (!rc || rc.status !== 1) throw new Error("The swap transaction failed on chain. Nothing moved.");
      return sb.rpc("record_swap", { p_offer: o.id, p_tx: rc.transactionHash });
    })
    .then(function (r) { if (r && r.error) return fail(r.error); toast("Swapped — both NFTs moved. Press your dot to close the trade."); load(); })
    .catch(walletFail);
}

function bondCall(body) {
  return sb.auth.getSession().then(function (r) {
    var t = r.data && r.data.session && r.data.session.access_token;
    if (!t) throw new Error("Sign in again first.");
    return fetch(cfg.url + "/functions/v1/bond", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t, apikey: cfg.anonKey }, body: JSON.stringify(body) });
  }).then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error(j.error || "The bond service didn’t answer."); return j; }); });
}
function startBond(o) {
  toast("Opening a secure Stripe checkout…");
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
  box.innerHTML = "<span>You’re owed " + money(total) + " from a trade where the other side never sent." + (ready ? "" : " It’s being reviewed — usually within a day.") + "</span>";
  if (ready) {
    var b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.textContent = "Claim " + money(total);
    b.addEventListener("click", claimPayout); box.appendChild(b);
  }
}
function claimPayout() {
  toast("One moment…");
  bondCall({ action: "payout" }).then(function (j) {
    if (j.onboarding) { toast("Stripe needs a few details to pay you — opening it now."); return setTimeout(function () { location.href = j.onboarding; }, 600); }
    toast(j.paid ? "Paid — it lands in your bank in a few days." : "Nothing ready to pay yet."); load();
  }).catch(fail);
}
