// Dot Trading Post — NFT metadata, fetched server-side.
//
// GET /api/nft?chain=1&contract=0x…&id=123&kind=erc721|erc1155
//
// Why this exists: a browser can only read metadata from servers that allow cross-site reads, and
// a lot of NFT metadata hosts don't — or they answer with a redirect that doesn't, which the
// browser then refuses to follow (OpenSea's shared-storefront metadata and Art Blocks both do
// this). A server has no such rule, so the board asks here first.
//
// It takes no URL from the caller. It asks the chain for the token's metadata address itself,
// then fetches that, following at most a few redirects, refusing anything that points at a
// private or local network, with a time and size cap. Responses are cached at the edge for a day.

const RPC = {
  1: "https://ethereum-rpc.publicnode.com",
  8453: "https://mainnet.base.org",
  42161: "https://arbitrum-one-rpc.publicnode.com",
  10: "https://optimism-rpc.publicnode.com",
  137: "https://polygon-bor-rpc.publicnode.com",
  56: "https://bsc-rpc.publicnode.com",
  43114: "https://avalanche-c-chain-rpc.publicnode.com",
  7777777: "https://rpc.zora.energy",
};
const MAX_BYTES = 1024 * 1024;

function pad32(hex) { return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0"); }

async function ethCall(chain, to, data) {
  const r = await fetch(RPC[chain], {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json();
  if (j.error || !j.result || j.result === "0x") throw new Error("call failed");
  return j.result;
}

function abiString(hex) {
  const h = hex.slice(2);
  const off = parseInt(h.slice(0, 64), 16) * 2;
  const len = parseInt(h.slice(off, off + 64), 16);
  return Buffer.from(h.slice(off + 64, off + 64 + len * 2), "hex").toString("utf8");
}

function gateway(u) {
  if (!u || typeof u !== "string") return null;
  if (u.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + u.slice(7).replace(/^ipfs\//, "");
  if (u.startsWith("ar://")) return "https://arweave.net/" + u.slice(5);
  return u;
}

// Hostnames that would let a contract author point this server at something internal.
function forbiddenHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  if (h.includes(":") && (h === "::1" || /^f[cd]/.test(h) || /^fe80/.test(h) || h.startsWith("::ffff:"))) return true;
  return false;
}

async function fetchJson(url) {
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad scheme");
    if (forbiddenHost(u.hostname)) throw new Error("forbidden host");
    const r = await fetch(u, { redirect: "manual", headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { url = new URL(r.headers.get("location"), u).toString(); continue; }
    if (!r.ok) throw new Error("metadata " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("too large");
    return JSON.parse(buf.toString("utf8"));
  }
  throw new Error("too many redirects");
}

async function readMeta(uri) {
  const m = /^data:application\/json(;[^,]*)?,([\s\S]*)$/.exec(uri);
  if (m) return JSON.parse(/base64/.test(m[1] || "") ? Buffer.from(m[2], "base64").toString("utf8") : decodeURIComponent(m[2]));
  return fetchJson(gateway(uri));
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const chain = Number(q.chain), contract = String(q.contract || ""), id = String(q.id || ""), kind = String(q.kind || "erc721");
  if (!RPC[chain] || !/^0x[0-9a-fA-F]{40}$/.test(contract) || !/^\d{1,80}$/.test(id) || !/^erc(721|1155)$/.test(kind)) {
    res.statusCode = 400; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ error: "bad request" }));
  }
  const idHex = pad32(BigInt(id).toString(16));
  const out = { name: "", image: null, description: "", collection: "" };
  const [uriRes, nameRes] = await Promise.allSettled([
    ethCall(chain, contract, (kind === "erc721" ? "0xc87b56dd" : "0x0e89341c") + idHex).then(abiString),
    ethCall(chain, contract, "0x06fdde03").then(abiString),
  ]);
  if (nameRes.status === "fulfilled") out.collection = nameRes.value;
  let status = 200;
  if (uriRes.status === "fulfilled" && uriRes.value) {
    try {
      const j = await readMeta(uriRes.value.replace(/\{id\}/g, idHex));
      out.name = String(j.name || "").slice(0, 200);
      out.description = String(j.description || "").slice(0, 600);
      out.image = gateway(j.image || j.image_url || j.imageUrl || (j.properties && j.properties.image) || j.animation_url || null);
    } catch (e) { out.partial = true; status = 200; }
  } else { out.partial = true; }
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  // A token's metadata rarely changes; a day at the edge, a week of stale-while-revalidate.
  res.setHeader("cache-control", out.partial ? "public, s-maxage=300" : "public, s-maxage=86400, stale-while-revalidate=604800");
  res.end(JSON.stringify(out));
};
