import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// `supabase status -o env` emits API_URL / ANON_KEY / SERVICE_ROLE_KEY.
// Fail loudly rather than defaulting: a silent localhost fallback turns a
// misconfigured environment into a confusing test failure much later.
const rawUrl = process.env.API_URL;
const rawAnon = process.env.ANON_KEY;
const rawService = process.env.SERVICE_ROLE_KEY;

if (!rawUrl || !rawAnon || !rawService) {
  throw new Error(
    "Missing API_URL / ANON_KEY / SERVICE_ROLE_KEY. " +
      "Run: npx supabase status -o env > .env.test",
  );
}

// Re-bound as string after the guard. TypeScript does not carry module-level
// narrowing into function bodies, so referencing the raw consts inside the
// helpers below would widen them back to `string | undefined`.
const URL: string = rawUrl;
const ANON: string = rawAnon;
const SERVICE: string = rawService;

/** Bypasses RLS. Use for setup, assertions, and calling service-only RPCs. */
export function serviceClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}

export interface TestUser {
  client: SupabaseClient;
  id: string;
}

/** Inserts one meal owned by the given user and returns its id. */
export async function seedMeal(user: TestUser, title = "Test meal"): Promise<string> {
  const { data, error } = await user.client
    .from("meals")
    .insert({
      user_id: user.id,
      meal_type: "lunch",
      title,
      calories: 500,
      protein: 30,
      carbs: 50,
      fat: 20,
      items: [
        { name: "rice", quantity: "1 cup", calories: 200, protein: 4, carbs: 44, fat: 0 },
      ],
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

/** Creates a fresh anonymous user and returns a client authenticated as them. */
export async function anonUser(): Promise<TestUser> {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { client, id: data.user!.id };
}
