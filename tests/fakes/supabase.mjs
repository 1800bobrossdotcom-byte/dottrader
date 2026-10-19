// A stand-in for npm:@supabase/supabase-js in tests: just enough of the query builder for the
// vision function, over the in-memory tables in globalThis.__db.
export function createClient() {
  const db = globalThis.__db;
  const query = (table) => {
    let rows = db[table] || [], head = false, count = null;
    const q = {
      select(_cols, opts) { if (opts && opts.count) { count = true; head = !!opts.head; } return q; },
      eq(k, v) { rows = rows.filter((r) => String(r[k]) === String(v)); return q; },
      gte(k, v) { rows = rows.filter((r) => r[k] >= v); return q; },
      single() { return Promise.resolve({ data: rows[0] || null }); },
      insert(row) { (db[table] = db[table] || []).push({ created_at: new Date().toISOString(), ...row }); return Promise.resolve({ error: null }); },
      update(v) { return { eq: () => Promise.resolve({ error: null }) }; },
      then(ok, no) { return Promise.resolve(count ? { count: rows.length, data: head ? null : rows } : { data: rows }).then(ok, no); },
    };
    return q;
  };
  const storage = { from: () => ({}) };
  return { from: query, storage, auth: { getUser: async (tok) => db.users[tok] ? { data: { user: { id: db.users[tok] } }, error: null } : { data: null, error: new Error("bad") } } };
}
