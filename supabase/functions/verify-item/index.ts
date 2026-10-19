// Dot Trading Post — Proof of Item scoring.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name it `verify-item`,
// paste this file. Then Edge Functions → Secrets → add ANTHROPIC_API_KEY. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Called by the board after the owner uploads their proof photo to the private `proofs` bucket:
//   POST { verification_id, proof_path }   with the caller's Supabase session as the bearer token.
//
// It also reads a listing photo for the post form, so posting can start from a picture:
//   POST { action: "describe", photo_url, cats, lang }
// The photo must be one the caller uploaded to the public `photos` bucket. The answer is a
// suggested title, category and details, which the form fills in for the person to check. Each
// account gets DESCRIBE_PER_DAY of these a day (photo_reads in supabase/storage.sql).
//
// This runs here and not in the page for one reason: the vision model needs an API key, and a key
// in a browser is a key everyone has. The caller is identified from their session token, the
// verification row is checked to be theirs and still pending, the photo is read from the private
// bucket with the service role and sent to the model, and the verdict is written back with the service role — the only
// thing anywhere that can mark an item verified.
//
// Lifted from cbay's item_verify.js. Two changes: the model returns a typed JSON object through
// structured outputs rather than prose that gets regex-mined for a brace, and a safety refusal
// falls through to another model rather than failing the check.

import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY3467";
const PASS = 45;      // weighted score needed
const DESCRIBE_PER_DAY = 30;
const CRITICAL = 15;  // name or code below this fails outright, whatever the rest says

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// What the model must return. The API guarantees the response parses as this, so there is no
// brace-hunting and no "AI response not parseable" path. Structured outputs reject number limits
// (minimum/maximum) and list-of-types, so scores are plain integers, kept to 0–100 by n() below,
// and "may be missing" is anyOf string/null.
const SCORE = { type: "integer", description: "0 to 100" };
const MAYBE = { anyOf: [{ type: "string" }, { type: "null" }] };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name_match", "name_read", "date_match", "date_read", "code_match", "code_read",
             "code_char_matches", "item_visible", "item_description", "note_handwritten",
             "photo_authentic", "overall_confidence", "flags", "summary"],
  properties: {
    name_match: SCORE,
    name_read: MAYBE,
    date_match: SCORE,
    date_read: MAYBE,
    code_match: SCORE,
    code_read: MAYBE,
    code_char_matches: { type: "string", description: "One of Y, N or ? per position, e.g. YYNY" },
    item_visible: SCORE,
    item_description: MAYBE,
    note_handwritten: SCORE,
    photo_authentic: SCORE,
    overall_confidence: SCORE,
    flags: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

// What a listing photo suggests. The category must be one the board has.
const describeSchema = (cats: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["title", "category", "details", "sure"],
  properties: {
    title: { type: "string", description: "A listing title a collector would search for: brand, model, edition, set, year if visible. At most 70 characters." },
    category: { type: "string", enum: cats },
    details: { type: "string", description: "One or two short sentences on what is visible: condition, box, accessories. Nothing guessed." },
    sure: { type: "boolean", description: "False if the photo is unclear or shows no single item to trade." },
  },
});
// One request to Claude. It asks for the refusal fallback first; an account that doesn't accept that
// option (a 400 or 404 about it) gets the same request without it, so the check still runs.
// deno-lint-ignore no-explicit-any
async function askClaude(client: Anthropic, params: any) {
  try {
    return await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  } catch (e) {
    if (!(e instanceof Anthropic.APIError) || (e.status !== 400 && e.status !== 404)) throw e;
    console.error("[claude] retrying without the fallback option:", `${e.status}: ${e.message}`);
    return await client.messages.create(params);
  }
}
// What went wrong, short enough to show on the board and read back: a status code, never a secret.
function failCode(e: unknown) {
  if (e instanceof Anthropic.APIError) return String(e.status ?? "api");
  return e instanceof SyntaxError ? "unreadable" : "network";
}

const LANG_NAME: Record<string, string> = { en: "English", es: "Spanish", ja: "Japanese", pt: "Brazilian Portuguese" };

async function describe(service: ReturnType<typeof createClient>, url: string, uid: string, body: Record<string, unknown>) {
  const photo = String(body.photo_url ?? "");
  const own = `${url}/storage/v1/object/public/photos/${uid}/`;
  if (!photo.startsWith(own) || !/^[A-Za-z0-9._-]+$/.test(photo.slice(own.length))) return json({ error: "the photo must be one you uploaded" }, 400);
  const cats = (Array.isArray(body.cats) ? body.cats : []).map(String).filter((c) => c.length > 0 && c.length <= 40).slice(0, 80);
  if (!cats.includes("Other")) cats.push("Other");
  const lang = LANG_NAME[String(body.lang ?? "en")] ? String(body.lang) : "en";

  // A daily allowance per account: each read costs real money.
  const since = new Date(Date.now() - 86400e3).toISOString();
  const { count } = await service.from("photo_reads").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", since);
  if ((count ?? 0) >= DESCRIBE_PER_DAY) return json({ error: "that's enough photo reads for today — fill it in by hand" }, 429);
  await service.from("photo_reads").insert({ user_id: uid });

  const img = await fetch(photo);
  if (!img.ok) return json({ error: "could not fetch the photo" }, 400);
  const mediaType = (img.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) return json({ error: "unsupported image type" }, 415);
  const bytes = new Uint8Array(await img.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) return json({ error: "photo too large" }, 413);
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  b64 = btoa(b64);

  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "the photo reader is unavailable right now", code: "no-key" }, 503);
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  try {
    const res = await askClaude(client, {
      model: "claude-opus-5-5",
      max_tokens: 4096,
      output_config: { effort: "low", format: { type: "json_schema", schema: describeSchema(cats) } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: b64 } },
          { type: "text", text: `This photo is for a listing on a barter board for collectibles, games and other things people swap. Suggest the listing's title, category and a short description of what is visible. Write the title and details in ${LANG_NAME[lang]}. Name only what you can see or read; if a detail isn't visible, leave it out rather than guess.` },
        ],
      }],
    });
    if (res.stop_reason === "refusal") return json({ error: "couldn't read that photo" }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "the photo reader is unavailable right now", code: "cut-off" }, 502);
    // deno-lint-ignore no-explicit-any
    const text = res.content.find((b: any) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "couldn't read that photo" }, 502);
    const out = JSON.parse(text.text);
    return json({ title: String(out.title ?? "").slice(0, 80), category: cats.includes(out.category) ? out.category : "Other", details: String(out.details ?? "").slice(0, 600), sure: !!out.sure });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    console.error("[describe]", msg);
    return json({ error: "the photo reader is unavailable right now", code: failCode(e) }, 502);
  }
}

function prompt(name: string, code: string, title: string) {
  const now = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const iso = now.toISOString().slice(0, 10);
  const d = now.getDate(), m = now.getMonth() + 1, y = now.getFullYear();
  const mon = now.toLocaleDateString("en-US", { month: "short" });
  return `You are checking a proof-of-possession photo for a barter board. The person who listed an item photographed a handwritten note beside it.

THE NOTE SHOULD HAVE THREE LINES:
  1. ${name}            (their display name on the board)
  2. ${mon} ${d}, ${y}  (today's date, any format)
  3. ${code}            (a 4-character code, all caps)

It is handwritten in pen or marker and may be messy, angled or partly hidden. Read carefully.

OCR GUIDANCE
- The code uses only these characters: ${CODE_ALPHABET.split("").join(" ")}. There is no O, I, L, S, B or Z and no 0, 1, 2, 5 or 8 in a valid code.
- The date may be written ${m}/${d}/${y}, ${d}/${m}/${y}, ${mon} ${d} ${y}, ${iso} or similar. Yesterday (${yesterday.toISOString().slice(0, 10)}) is also acceptable.
- Handwriting varies. If a character could plausibly be the expected one, lean toward matching.
- The item "${title}" should be physically present near the note.

Score each 0–100. Be generous with handwriting; be strict about whether things are actually present.
- name_match: 100 clearly "${name}"; 70–90 mostly readable; 40–60 partial; 0–30 absent, wrong or illegible.
- date_match: 100 today; 85 yesterday; 50 within three days; 0 absent, old or illegible.
- code_match: compare to "${code}" character by character. 100 all four; 75 three; 50 two; 25 one; 0 none.
- item_visible: 100 clearly "${title}"; 60–80 an item is present; 30–50 something unclear; 0 nothing.
- note_handwritten: 100 pen or marker on real paper; 50 unsure; 0 printed or digitally overlaid.
- photo_authentic: 100 an original camera photo; 50 unsure; 0 a screenshot, a photo of a screen, or edited.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "sign in first" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Who is calling — from their own token, never from the request body.
  const { data: who, error: whoErr } = await service.auth.getUser(auth.slice(7));
  if (whoErr || !who?.user) return json({ error: "sign in first" }, 401);
  const uid = who.user.id;

  let body: { verification_id?: string; proof_path?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  if (body.action === "describe") return describe(service, url, uid, body as Record<string, unknown>);
  const vid = String(body.verification_id ?? "");
  const proofPath = String(body.proof_path ?? "");
  if (!vid || !proofPath) return json({ error: "verification_id and proof_path are required" }, 400);

  // The proof must be in the private proofs bucket, under the caller's own folder. Anything else is
  // someone pointing the checker at an arbitrary image.
  if (!proofPath.startsWith(`${uid}/`) || proofPath.includes("..") || !/^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(proofPath)) {
    return json({ error: "proof photo must be one you uploaded" }, 400);
  }

  const { data: v } = await service.from("verifications").select("*").eq("id", vid).single();
  if (!v) return json({ error: "verification not found" }, 404);
  if (v.owner_id !== uid) return json({ error: "not yours" }, 403);
  if (v.status !== "pending") return json({ error: `already ${v.status}` }, 409);
  if (new Date(v.expires_at) < new Date()) {
    await service.from("verifications").update({ status: "expired" }).eq("id", vid);
    return json({ error: "this code expired — start a new one" }, 410);
  }

  const [{ data: item }, { data: prof }] = await Promise.all([
    service.from("items").select("title").eq("id", v.item_id).single(),
    service.from("profiles").select("name").eq("id", uid).single(),
  ]);
  const name = (prof?.name || "").trim() || "trader";

  // Read the photo ourselves, from the private bucket, rather than trusting bytes from the browser.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const img = await fetch(`${url}/storage/v1/object/proofs/${proofPath}`, { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } });
  if (!img.ok) return json({ error: "could not fetch the proof photo" }, 400);
  const mediaType = (img.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) return json({ error: "unsupported image type" }, 415);
  const bytes = new Uint8Array(await img.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) return json({ error: "photo too large" }, 413);
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  b64 = btoa(b64);

  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "the checker is unavailable right now", code: "no-key" }, 503);
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  let scores: Record<string, unknown>;
  try {
    const res = await askClaude(client, {
      model: "claude-opus-5-5",
      max_tokens: 8192,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: b64 } },
          { type: "text", text: prompt(name, v.code, item?.title || "item") },
        ],
      }],
    });
    if (res.stop_reason === "refusal") return json({ error: "the checker declined to look at this photo" }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "the checker is unavailable right now", code: "cut-off" }, 502);
    // deno-lint-ignore no-explicit-any
    const text = res.content.find((b: any) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "empty verdict" }, 502);
    scores = JSON.parse(text.text);
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    console.error("[verify-item]", msg);
    return json({ error: "the checker is unavailable right now", code: failCode(e) }, 502);
  }

  const dims = ["name_match", "code_match", "date_match", "item_visible", "note_handwritten", "photo_authentic"] as const;
  const weights = { name_match: .20, code_match: .20, date_match: .15, item_visible: .15, note_handwritten: .15, photo_authentic: .15 };
  const n = (k: string) => Math.max(0, Math.min(100, Math.round(Number(scores[k]) || 0)));
  const weighted = Math.round(dims.reduce((s, k) => s + n(k) * weights[k], 0));
  const criticalFail = n("name_match") < CRITICAL || n("code_match") < CRITICAL;
  const passed = weighted >= PASS && !criticalFail;

  const analysis = { scores: { ...scores, weighted_score: weighted }, passed, threshold: PASS, model: "claude-opus-5-5", at: new Date().toISOString() };
  // proof_url holds the private path; the verifications table is readable only by its owner.
  const update: Record<string, unknown> = { proof_url: proofPath, analysis, status: passed ? "verified" : "failed" };
  if (passed) update.verified_at = new Date().toISOString();
  const { error: upErr } = await service.from("verifications").update(update).eq("id", vid);
  if (upErr) return json({ error: "could not save the verdict" }, 500);

  return json({
    passed, weighted_score: weighted, threshold: PASS,
    summary: scores.summary, flags: scores.flags,
    read: { name: scores.name_read, date: scores.date_read, code: scores.code_read, chars: scores.code_char_matches },
  });
});
