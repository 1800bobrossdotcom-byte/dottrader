// Maps the Edge Functions' npm: imports to the fakes beside this file, so a function can be
// imported and exercised under Node.
const MAP = { "npm:@anthropic-ai/sdk": "anthropic.mjs", "npm:@supabase/supabase-js": "supabase.mjs" };
export async function resolve(spec, ctx, next) {
  for (const [k, f] of Object.entries(MAP)) if (spec.startsWith(k)) return { url: new URL(f, import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
