// A stand-in for npm:@anthropic-ai/sdk in tests: records every request and answers with whatever
// the test put in globalThis.__claude.next.
export default class Anthropic {
  constructor(opts) { this.opts = opts; }
  beta = { messages: { create: async (params) => { globalThis.__claude.calls.push(params); const n = globalThis.__claude.next; if (n instanceof Error) throw n; return n; } } };
  static APIError = class APIError extends Error { constructor(status, message) { super(message); this.status = status; } };
}
