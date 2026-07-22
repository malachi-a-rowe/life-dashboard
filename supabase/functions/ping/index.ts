// ping — the smallest possible proof that the whole chain works:
// browser -> Edge Function -> verified JWT -> database read (under RLS).
// If this returns your user id and row counts, the backend is wired correctly.

import { handler, json } from "../_shared/http.ts";

Deno.serve(handler(async (req, { userId, client }) => {
  const origin = req.headers.get("origin");

  // These reads run as the caller, so RLS decides what is visible.
  const [tx, accounts, workouts] = await Promise.all([
    client.from("transactions").select("id", { count: "exact", head: true }),
    client.from("accounts").select("id", { count: "exact", head: true }),
    client.from("workouts").select("id", { count: "exact", head: true }),
  ]);

  return json({
    ok: true,
    userId,
    serverTime: new Date().toISOString(),
    counts: {
      transactions: tx.count ?? 0,
      accounts: accounts.count ?? 0,
      workouts: workouts.count ?? 0,
    },
  }, 200, origin);
}));
