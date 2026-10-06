// Dot Trading Post — Proof of Item scoring.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name it `verify-item`,
// paste this file. Then Edge Functions → Secrets → add ANTHROPIC_API_KEY. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Called by the board after the owner uploads their proof photo to the private `proofs` bucket:
//   POST { verification_id, proof_path }   with the caller's Supabase session as the bearer token.
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
const CRITICAL = 15;  // name or code below this fails outright, whatever the rest says

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// What the model must return. The API guarantees the response parses as this, so there is no
// brace-hunting and no "AI response not parseable" path.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name_match", "name_read", "date_match", "date_read", "code_match", "code_read",
             "code_char_matches", "item_visible", "item_description", "note_handwritten",
             "photo_authentic", "overall_confidence", "flags", "summary"],
  properties: {
    name_match: { type: "integer", minimum: 0, maximum: 100 },
    name_read: { type: ["string", "null"] },
    date_match: { type: "integer", minimum: 0, maximum: 100 },
    date_read: { type: ["string", "null"] },
    code_match: { type: "integer", minimum: 0, maximum: 100 },
    code_read: { type: ["string", "null"] },
    code_char_matches: { type: "string", description: "One of Y, N or ? per position, e.g. YYNY" },
    item_visible: { type: "integer", minimum: 0, maximum: 100 },
    item_description: { type: ["string", "null"] },
    note_handwritten: { type: "integer", minimum: 0, maximum: 100 },
    photo_authentic: { type: "integer", minimum: 0, maximum: 100 },
    overall_confidence: { type: "integer", minimum: 0, maximum: 100 },
    flags: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

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

  let body: { verification_id?: string; proof_path?: string };
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
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

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  let scores: Record<string, unknown>;
  try {
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
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
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "empty verdict" }, 502);
    scores = JSON.parse(text.text);
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    console.error("[verify-item]", msg);
    return json({ error: "the checker is unavailable right now" }, 502);
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
