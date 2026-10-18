// The vision function's "describe this photo" action, with Claude, the database and storage
// replaced by fakes. Run: npm run test:describe
import { register } from "node:module";
register("./fakes/hooks.mjs", import.meta.url);

const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", ANTHROPIC_API_KEY: "sk-ant-test" };
let handler; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
const A = "a0000000-0000-0000-0000-000000000001", B = "b0000000-0000-0000-0000-000000000002";
globalThis.__db = { users: { tA: A, tB: B }, photo_reads: [] };
globalThis.__claude = { calls: [], next: null };
const answer = (o, stop = "end_turn") => ({ stop_reason: stop, content: [{ type: "text", text: JSON.stringify(o) }] });
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.startsWith("https://proj.supabase.co/storage/v1/object/public/photos/")) return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  return realFetch(url);
};
await import(new URL("../supabase/functions/verify-item/index.ts", import.meta.url).href);
const call = async (tok, body) => { const r = await handler(new Request("https://x/functions/v1/verify-item", { method: "POST", headers: tok ? { Authorization: "Bearer " + tok } : {}, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const res = []; const ok = (n, c, x) => res.push((c ? "PASS " : "FAIL ") + n + (c || !x ? "" : "  [" + x + "]"));
const mine = `https://proj.supabase.co/storage/v1/object/public/photos/${A}/abc123-x9.png`;
const CATS = ["Trading Cards", "Video Games", "Consoles & Retro", "Other"];

let [s, j] = await call(null, { action: "describe", photo_url: mine });
ok("no session is refused", s === 401);
[s, j] = await call("tB", { action: "describe", photo_url: mine, cats: CATS });
ok("someone else's photo is refused", s === 400 && /you uploaded/.test(j.error), j.error);
[s, j] = await call("tA", { action: "describe", photo_url: "https://evil.example/x.png", cats: CATS });
ok("a photo from anywhere else is refused", s === 400);
[s, j] = await call("tA", { action: "describe", photo_url: mine + "/../../other", cats: CATS });
ok("a path that climbs out of the folder is refused", s === 400);

__claude.next = answer({ title: "Game Boy Color, Atomic Purple", category: "Consoles & Retro", details: "Shell scuffed on the back; no cartridge.", sure: true });
[s, j] = await call("tA", { action: "describe", photo_url: mine, cats: CATS, lang: "es" });
ok("a clear photo comes back as a title, category and details", s === 200 && j.title === "Game Boy Color, Atomic Purple" && j.category === "Consoles & Retro" && j.sure === true, JSON.stringify(j));
const req = __claude.calls.at(-1);
ok("…asking Claude Opus 5.5 at low effort, with the photo and a schema", req.model === "claude-opus-5-5" && req.output_config.effort === "low" && req.output_config.format.type === "json_schema" && req.messages[0].content[0].type === "image");
ok("…whose category must be one the board has", JSON.stringify(req.output_config.format.schema.properties.category.enum) === JSON.stringify(CATS));
ok("…in the trader's language", /Spanish/.test(req.messages[0].content[1].text));
ok("…with the refusal fallback on", req.fallbacks === "default" && req.betas.includes("server-side-fallback-2026-07-01"));
ok("each read is counted against the day's allowance", __db.photo_reads.filter((r) => r.user_id === A).length === 1);

__claude.next = answer({ title: "x", category: "Spaceships", details: "", sure: false });
[s, j] = await call("tA", { action: "describe", photo_url: mine, cats: CATS });
ok("a category the board doesn't have becomes Other", j.category === "Other");
__claude.next = { stop_reason: "refusal", content: [] };
[s, j] = await call("tA", { action: "describe", photo_url: mine, cats: CATS });
ok("a declined photo says so, without a crash", s === 422);

__db.photo_reads = Array.from({ length: 30 }, () => ({ user_id: A, created_at: new Date().toISOString() }));
const before = __claude.calls.length;
[s, j] = await call("tA", { action: "describe", photo_url: mine, cats: CATS });
ok("after 30 reads in a day, the next is refused without calling Claude", s === 429 && __claude.calls.length === before, String(s));

console.log(res.join("\n")); if (res.some((r) => !r.startsWith("PASS"))) process.exitCode = 1;
