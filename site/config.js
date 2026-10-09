// Supabase connection for the Trading Post.
//
// Both values are public by design: the anon key is meant to ship in the page, and what actually
// protects the data is the row-level security in supabase/schema.sql. The service_role key is the
// one that must never appear here.
window.DTP_CONFIG = {
  url: "https://yujxwfghmauajrpduagl.supabase.co",
  anonKey: "sb_publishable_3bOvzS08UOQsu1376idqDg_XHPmOgfp",

  // Edge Function addresses: the last part of each function's URL in Supabase → Edge Functions.
  // The dashboard editor can give a function a random address whatever it is labelled, so the
  // board asks for each one by the address written here.
  functions: { verify: "swift-processor", bond: "bond" },

  // Atomic NFT swaps: a flat fee paid by whoever completes a swap, in each chain's own coin,
  // written into the signed order so it is paid in the same transaction. Once the project has the
  // swap_fees table (supabase/trades.sql) those rows are used instead and the database refuses an
  // order without the fee; this block only serves a project that has not run that SQL yet. Leave
  // `recipient` empty to charge nothing. Amounts are in wei (1 ETH = 1000000000000000000).
  swapFee: {
    recipient: "0x8455cf296e1265b494605207e97884813de21950",
    wei: {
      1: "500000000000000",            // Ethereum  0.0005 ETH
      8453: "500000000000000",         // Base      0.0005 ETH
      42161: "500000000000000",        // Arbitrum  0.0005 ETH
      10: "500000000000000",           // Optimism  0.0005 ETH
      7777777: "500000000000000",      // Zora      0.0005 ETH
      137: "5000000000000000000",      // Polygon   5 POL
      56: "2500000000000000",          // BNB Chain 0.0025 BNB
      43114: "60000000000000000"       // Avalanche 0.06 AVAX
    }
  }
};
