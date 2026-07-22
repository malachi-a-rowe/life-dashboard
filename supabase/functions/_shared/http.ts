// Shared helpers for every Life Dashboard Edge Function.
// Keeps CORS, auth and error shape identical across functions.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// The app is served from GitHub Pages; allow that origin plus local testing.
const ALLOWED = [
  "https://malachirowe.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

export function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

export function preflight(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req.headers.get("origin")) });
  }
  return null;
}

export type Caller = { userId: string; client: SupabaseClient };

/**
 * Verifies the caller's Supabase JWT and returns their user id plus a client
 * scoped to that user, so row-level security still applies to everything the
 * function reads or writes. Throws if the token is missing or invalid.
 */
export async function requireUser(req: Request): Promise<Caller> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token");
  }

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) throw new HttpError(401, "Invalid or expired token");

  return { userId: data.user.id, client };
}

/**
 * Service-role client. Bypasses RLS — only use for work the user cannot do
 * themselves (e.g. writing rows on behalf of a webhook). Never return raw
 * results from this client without filtering by user id first.
 */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Wraps a handler with preflight, auth errors and a consistent error shape. */
export function handler(fn: (req: Request, caller: Caller) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    const pre = preflight(req);
    if (pre) return pre;

    try {
      const caller = await requireUser(req);
      return await fn(req, caller);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : "Internal error";
      if (status === 500) console.error(err);
      return json({ error: message }, status, origin);
    }
  };
}
