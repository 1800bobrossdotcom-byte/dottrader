// Dot Trading Post — atomic NFT-for-NFT swaps through Seaport 1.6.
//
// The lister signs an order: "my NFT, for your NFT paid to me, plus the board's fee". The other side
// fills it in one transaction. Seaport moves both NFTs (and the fee) together or reverts, so nobody
// has to send first and nothing is ever held by the board. Signing is free; the person filling the
// order pays gas and the fee.
//
// Approvals go to OpenSea's conduit, the same address almost every NFT holder has already approved
// for listing on OpenSea, so most swaps need no approval transaction at all.
//
// Seaport, the conduit controller and this conduit were checked on chain to exist at these
// addresses on every chain the board supports.
(function () {
  "use strict";

  var SEAPORT = "0x0000000000000068F116a894984e2DB1123eB395";
  var CONDUIT = "0x1E0049783F008A0085193E00003D00cd54003c71";
  var CONDUIT_KEY = "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000";
  var ZERO = "0x0000000000000000000000000000000000000000";
  var ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

  var TYPES = {
    OrderComponents: [
      { name: "offerer", type: "address" }, { name: "zone", type: "address" },
      { name: "offer", type: "OfferItem[]" }, { name: "consideration", type: "ConsiderationItem[]" },
      { name: "orderType", type: "uint8" }, { name: "startTime", type: "uint256" }, { name: "endTime", type: "uint256" },
      { name: "zoneHash", type: "bytes32" }, { name: "salt", type: "uint256" }, { name: "conduitKey", type: "bytes32" },
      { name: "counter", type: "uint256" }
    ],
    OfferItem: [
      { name: "itemType", type: "uint8" }, { name: "token", type: "address" }, { name: "identifierOrCriteria", type: "uint256" },
      { name: "startAmount", type: "uint256" }, { name: "endAmount", type: "uint256" }
    ],
    ConsiderationItem: [
      { name: "itemType", type: "uint8" }, { name: "token", type: "address" }, { name: "identifierOrCriteria", type: "uint256" },
      { name: "startAmount", type: "uint256" }, { name: "endAmount", type: "uint256" }, { name: "recipient", type: "address" }
    ]
  };

  var OFFER_T = "tuple(uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)";
  var CONS_T = "tuple(uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)";
  var PARAMS_T = "tuple(address offerer, address zone, " + OFFER_T + "[] offer, " + CONS_T + "[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems)";
  var COMP_T = "tuple(address offerer, address zone, " + OFFER_T + "[] offer, " + CONS_T + "[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 counter)";
  var SEAPORT_ABI = [
    "function getCounter(address offerer) view returns (uint256 counter)",
    "function getOrderHash(" + COMP_T + " order) view returns (bytes32 orderHash)",
    "function getOrderStatus(bytes32 orderHash) view returns (bool isValidated, bool isCancelled, uint256 totalFilled, uint256 totalSize)",
    "function validate(tuple(" + PARAMS_T + " parameters, bytes signature)[] orders) returns (bool validated)",
    "function fulfillOrder(tuple(" + PARAMS_T + " parameters, bytes signature) order, bytes32 fulfillerConduitKey) payable returns (bool fulfilled)"
  ];
  var NFT_ABI = [
    "function isApprovedForAll(address owner, address operator) view returns (bool)",
    "function setApprovalForAll(address operator, bool approved)"
  ];

  function E() { if (!window.ethers) throw new Error("Still loading — try again in a second."); return window.ethers; }
  function itemType(kind) { if (kind === "erc721") return 2; if (kind === "erc1155") return 3; throw new Error("Only NFTs can be swapped this way."); }
  function low(a) { return String(a || "").toLowerCase(); }

  // give: what the order's signer hands over · get: what they receive · fee: { recipient, wei }
  function buildOrder(o) {
    var now = Math.floor(Date.now() / 1000);
    var consideration = [{
      itemType: itemType(o.get.kind), token: low(o.get.contract), identifierOrCriteria: String(o.get.id),
      startAmount: "1", endAmount: "1", recipient: low(o.offerer)
    }];
    if (o.fee && o.fee.recipient && o.fee.wei && o.fee.wei !== "0") {
      consideration.push({ itemType: 0, token: ZERO, identifierOrCriteria: "0", startAmount: String(o.fee.wei), endAmount: String(o.fee.wei), recipient: low(o.fee.recipient) });
    }
    return {
      offerer: low(o.offerer), zone: ZERO,
      offer: [{ itemType: itemType(o.give.kind), token: low(o.give.contract), identifierOrCriteria: String(o.give.id), startAmount: "1", endAmount: "1" }],
      consideration: consideration,
      orderType: 0,                                   // full, open: anyone holding the asked-for NFT can fill it
      startTime: String(now - 60), endTime: String(now + (o.days || 7) * 86400),
      zoneHash: ZERO32,
      salt: E().BigNumber.from(E().utils.randomBytes(16)).toString(),
      conduitKey: CONDUIT_KEY,
      counter: String(o.counter)
    };
  }

  function domain(chainId) { return { name: "Seaport", version: "1.6", chainId: Number(chainId), verifyingContract: SEAPORT }; }
  // Seaport's "order hash" is the EIP-712 struct hash alone (what getOrderStatus is keyed by); the
  // signature covers that plus the domain.
  function orderHash(c) { return E().utils._TypedDataEncoder.from(TYPES).hash(c); }
  function params(c) {
    return {
      offerer: c.offerer, zone: c.zone, offer: c.offer, consideration: c.consideration, orderType: c.orderType,
      startTime: c.startTime, endTime: c.endTime, zoneHash: c.zoneHash, salt: c.salt, conduitKey: c.conduitKey,
      totalOriginalConsiderationItems: c.consideration.length
    };
  }
  function feeOf(c) { return c.consideration.length > 1 ? c.consideration[1].startAmount : "0"; }

  // The filler's own check, in their own browser, before anything is sent. An order is accepted only
  // if it is exactly: the listed NFT offered, the filler's NFT asked for and paid to the order's
  // signer, and at most the expected fee to the expected recipient. A signed order that asks for
  // anything more — another NFT from a collection the filler has approved, a bigger fee — stops here.
  function check(c, expect) {
    var bad = function (why) { throw new Error("This swap order doesn't match the trade (" + why + "). Nothing was sent."); };
    if (!c || !c.offer || c.offer.length !== 1) bad("offer");
    var o = c.offer[0];
    if (Number(o.itemType) !== itemType(expect.receive.kind) || low(o.token) !== low(expect.receive.contract) || String(o.identifierOrCriteria) !== String(expect.receive.id) || String(o.startAmount) !== "1" || String(o.endAmount) !== "1") bad("the item you get");
    if (!c.consideration || c.consideration.length < 1 || c.consideration.length > 2) bad("shape");
    var k = c.consideration[0];
    if (Number(k.itemType) !== itemType(expect.pay.kind) || low(k.token) !== low(expect.pay.contract) || String(k.identifierOrCriteria) !== String(expect.pay.id) || String(k.startAmount) !== "1" || String(k.endAmount) !== "1" || low(k.recipient) !== low(c.offerer)) bad("the item you give");
    if (low(c.offerer) !== low(expect.counterparty)) bad("who it's from");
    if (c.consideration.length === 2) {
      var f = c.consideration[1];
      if (Number(f.itemType) !== 0 || low(f.token) !== ZERO || String(f.startAmount) !== String(f.endAmount)) bad("fee");
      if (!expect.fee || low(f.recipient) !== low(expect.fee.recipient) || E().BigNumber.from(f.startAmount).gt(E().BigNumber.from(expect.fee.wei || "0"))) bad("fee");
    }
    if (String(c.conduitKey).toLowerCase() !== CONDUIT_KEY.toLowerCase() || low(c.zone) !== ZERO || Number(c.orderType) !== 0) bad("terms");
    if (Number(c.endTime) < Date.now() / 1000) throw new Error("This swap order has expired — ask them to set it up again.");
    return true;
  }

  function seaport(signerOrProvider) { return new (E().Contract)(SEAPORT, SEAPORT_ABI, signerOrProvider); }

  function ensureApproval(signer, contract, owner) {
    var nft = new (E().Contract)(contract, NFT_ABI, signer);
    return nft.isApprovedForAll(owner, CONDUIT).then(function (ok) {
      if (ok) return false;
      return nft.setApprovalForAll(CONDUIT, true).then(function (tx) { return tx.wait().then(function () { return true; }); });
    });
  }

  function sign(signer, c, chainId) { return signer._signTypedData(domain(chainId), TYPES, c); }

  function fulfill(signer, c, signature) {
    return seaport(signer).fulfillOrder({ parameters: params(c), signature: signature }, CONDUIT_KEY, { value: feeOf(c) });
  }

  window.DTP_SWAP = {
    SEAPORT: SEAPORT, CONDUIT: CONDUIT, CONDUIT_KEY: CONDUIT_KEY, TYPES: TYPES, ABI: SEAPORT_ABI,
    buildOrder: buildOrder, orderHash: orderHash, params: params, check: check, feeOf: feeOf, domain: domain,
    seaport: seaport, ensureApproval: ensureApproval, sign: sign, fulfill: fulfill
  };
})();
