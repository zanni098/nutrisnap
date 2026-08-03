import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// `supabase status -o env` emits API_URL / ANON_KEY / SERVICE_ROLE_KEY.
// Fail loudly rather than defaulting: a silent localhost fallback turns a
// misconfigured environment into a confusing test failure much later.
const URL = process.env.API_URL;
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  throw new Error(
    "Missing API_URL / ANON_KEY / SERVICE_ROLE_KEY. " +
      "Run: npx supabase status -o env > .env.test",
  );
}

/** Bypasses RLS. Use for setup, assertions, and calling service-only RPCs. */
export function serviceClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}

export interface TestUser {
  client: SupabaseClient;
  id: string;
}

/** Creates a fresh anonymous user and returns a client authenticated as them. */
export async function anonUser(): Promise<TestUser> {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { client, id: data.user!.id };
}
