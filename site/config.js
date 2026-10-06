// Supabase connection for the Trading Post.
//
// Both values are public by design: the anon key is meant to ship in the page, and what actually
// protects the data is the row-level security in supabase/schema.sql. The service_role key is the
// one that must never appear here.
window.DTP_CONFIG = {
  url: "https://yujxwfghmauajrpduagl.supabase.co",
  anonKey: "sb_publishable_3bOvzS08UOQsu1376idqDg_XHPmOgfp"
};
