import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { anonUser, seedMeal, serviceClient } from "../helpers/supabase";

describe("profiles RLS", () => {
  it("auto-creates a profile row for every new user", async () => {
    const a = await anonUser();
    const { data, error } = await a.client
      .from("profiles")
      .select("id, goal_calories")
      .eq("id", a.id)
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(a.id);
    expect(data?.goal_calories).toBe(2000);
  });

  it("hides other users' profiles", async () => {
    const a = await anonUser();
    const b = await anonUser();

    const { data } = await b.client.from("profiles").select("id").eq("id", a.id);
    expect(data).toEqual([]);
  });

  it("rejects updates to another user's profile", async () => {
    const a = await anonUser();
    const b = await anonUser();

    await b.client.from("profiles").update({ display_name: "hacked" }).eq("id", a.id);

    // Read the victim row back as its OWNER. Asserting on the update's own
    // return value proves nothing: UPDATE ... RETURNING is filtered by the
    // SELECT policy, so an attacker gets [] whether the write was blocked or
    // succeeded. Only reading the row back distinguishes those two worlds.
    const { data: victim } = await a.client
      .from("profiles")
      .select("display_name")
      .eq("id", a.id)
      .single();

    expect(victim?.display_name).not.toBe("hacked");
  });

  it("rejects repointing a profile row at another user's id", async () => {
    const a = await anonUser();
    const b = await anonUser();

    await b.client.from("profiles").update({ id: a.id }).eq("id", b.id);

    const { data: victim } = await a.client
      .from("profiles")
      .select("id")
      .eq("id", a.id)
      .single();

    expect(victim?.id).toBe(a.id);
  });

  it("lets a user update their own profile", async () => {
    const a = await anonUser();

    const { data: before } = await a.client
      .from("profiles")
      .select("created_at, updated_at")
      .eq("id", a.id)
      .single();

    const { data, error } = await a.client
      .from("profiles")
      .update({ display_name: "Asad", goal_calories: 2400 })
      .eq("id", a.id)
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.display_name).toBe("Asad");
    expect(data?.goal_calories).toBe(2400);

    // The BEFORE UPDATE trigger owns updated_at, and created_at is not in the
    // column-scoped grant, so neither is client-forgeable.
    expect(new Date(data!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before!.updated_at).getTime(),
    );
    expect(data?.created_at).toBe(before?.created_at);
  });

  it("ignores a client-supplied updated_at and rejects writing created_at", async () => {
    const a = await anonUser();

    // created_at is not in the grant, so PostgREST/Postgres must refuse it.
    const { error: createdErr } = await a.client
      .from("profiles")
      .update({ created_at: "1999-01-01T00:00:00Z" })
      .eq("id", a.id);

    expect(createdErr).not.toBeNull();

    // updated_at is likewise ungranted.
    const { error: updatedErr } = await a.client
      .from("profiles")
      .update({ updated_at: "1999-01-01T00:00:00Z" })
      .eq("id", a.id);

    expect(updatedErr).not.toBeNull();
  });

  it("denies an unauthenticated anon client access to profiles", async () => {
    // A bare anon client has the 'anon' Postgres role; nothing is granted to
    // that role on this table, so access must be fail-closed.
    const anon = createClient(process.env.API_URL!, process.env.ANON_KEY!);

    const { data, error } = await anon.from("profiles").select("id");

    // Either an explicit permission error is returned, or data is an empty
    // array (RLS returns zero rows). Either proves the anon role has no
    // access to profile data.
    const isAccessDenied = error !== null || (Array.isArray(data) && data.length === 0);
    expect(isAccessDenied).toBe(true);
  });
});

describe("meals RLS", () => {
  it("lets a user read back their own meal", async () => {
    const a = await anonUser();
    const id = await seedMeal(a, "My lunch");

    const { data, error } = await a.client
      .from("meals")
      .select("id, title")
      .eq("id", id)
      .single();

    expect(error).toBeNull();
    expect(data?.title).toBe("My lunch");
  });

  it("hides one user's meals from another", async () => {
    const a = await anonUser();
    const b = await anonUser();
    await seedMeal(a, "Private lunch");

    const { data } = await b.client.from("meals").select("id");
    expect(data).toEqual([]);
  });

  it("rejects inserting a meal owned by someone else", async () => {
    const a = await anonUser();
    const b = await anonUser();

    const { error } = await b.client.from("meals").insert({
      user_id: a.id,
      meal_type: "dinner",
      title: "Forged",
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
    });

    expect(error).not.toBeNull();
  });

  it("rejects updating another user's meal", async () => {
    const a = await anonUser();
    const b = await anonUser();
    const id = await seedMeal(a, "Original");

    await b.client.from("meals").update({ title: "hacked" }).eq("id", id);

    // serviceClient bypasses RLS: the only witness that cannot be masked by
    // the SELECT policy. See the plan's note on testing cross-tenant writes.
    const svc = serviceClient();
    const { data } = await svc.from("meals").select("title").eq("id", id).single();
    expect(data?.title).toBe("Original");
  });

  it("rejects reassigning a meal to another user", async () => {
    const a = await anonUser();
    const b = await anonUser();
    const id = await seedMeal(a);

    await b.client.from("meals").update({ user_id: b.id }).eq("id", id);

    // Verified: this still passes with every meals policy opened to using(true),
    // because user_id sits outside the column-scoped UPDATE grant. Two
    // independent barriers block reassignment; this test proves the grant, and
    // the policy's `with check` is the second. Do not read it as policy coverage.
    const svc = serviceClient();
    const { data } = await svc.from("meals").select("user_id").eq("id", id).single();
    expect(data?.user_id).toBe(a.id);
  });

  it("rejects deleting another user's meal", async () => {
    const a = await anonUser();
    const b = await anonUser();
    const id = await seedMeal(a);

    await b.client.from("meals").delete().eq("id", id);

    const svc = serviceClient();
    const { data } = await svc.from("meals").select("id").eq("id", id);
    expect(data).toHaveLength(1);
  });

  it("refuses a client-supplied created_at", async () => {
    const a = await anonUser();
    const id = await seedMeal(a);

    // created_at sits outside the column-scoped UPDATE grant, so backdating
    // must be impossible even for the row's own owner.
    const { error } = await a.client
      .from("meals")
      .update({ created_at: "1999-01-01T00:00:00Z" })
      .eq("id", id);

    expect(error).not.toBeNull();
  });

  it("lets a user correct their own meal", async () => {
    const a = await anonUser();
    const id = await seedMeal(a);

    const { data, error } = await a.client
      .from("meals")
      .update({ servings: 2, title: "Corrected" })
      .eq("id", id)
      .select()
      .single();

    expect(error).toBeNull();
    expect(Number(data?.servings)).toBe(2);
    expect(data?.title).toBe("Corrected");
  });
});

describe("billing tables are not client-writable", () => {
  it("rejects a user granting themselves a subscription", async () => {
    const a = await anonUser();

    const { error } = await a.client.from("subscriptions").insert({
      user_id: a.id,
      status: "active",
      plan: "pro",
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(error).not.toBeNull();
  });

  it("lets a user read their own subscription written by the service role", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    const { error: insertErr } = await svc.from("subscriptions").insert({
      user_id: a.id,
      status: "active",
      plan: "pro",
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(insertErr).toBeNull();

    const { data, error } = await a.client
      .from("subscriptions")
      .select("plan, status")
      .single();

    expect(error).toBeNull();
    expect(data?.plan).toBe("pro");
  });

  it("hides another user's subscription", async () => {
    const a = await anonUser();
    const b = await anonUser();
    const svc = serviceClient();

    await svc.from("subscriptions").insert({
      user_id: a.id,
      status: "active",
      plan: "pro",
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const { data } = await b.client.from("subscriptions").select("plan");
    expect(data).toEqual([]);
  });

  it("rejects a user upgrading an existing subscription row", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await svc.from("subscriptions").insert({
      user_id: a.id,
      status: "canceled",
      plan: "free",
      current_period_end: new Date(Date.now() - 1000).toISOString(),
    });

    await a.client.from("subscriptions").update({ plan: "pro" }).eq("user_id", a.id);

    // serviceClient is the RLS-independent witness.
    const { data } = await svc
      .from("subscriptions")
      .select("plan")
      .eq("user_id", a.id)
      .single();

    expect(data?.plan).toBe("free");
  });

  it("rejects a user deleting their subscription to escape a revoked state", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await svc.from("subscriptions").insert({
      user_id: a.id,
      status: "revoked",
      plan: "pro",
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });

    await a.client.from("subscriptions").delete().eq("user_id", a.id);

    const { data } = await svc.from("subscriptions").select("status").eq("user_id", a.id);
    expect(data).toHaveLength(1);
  });

  it("rejects writing usage counters directly", async () => {
    const a = await anonUser();

    const { error } = await a.client
      .from("usage_daily")
      .insert({ user_id: a.id, day: "2026-08-03", analyses_used: 0 });

    expect(error).not.toBeNull();
  });

  it("rejects resetting an existing usage counter", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await svc
      .from("usage_daily")
      .insert({ user_id: a.id, day: "2026-08-03", analyses_used: 3 });

    await a.client
      .from("usage_daily")
      .update({ analyses_used: 0 })
      .eq("user_id", a.id)
      .eq("day", "2026-08-03");

    const { data } = await svc
      .from("usage_daily")
      .select("analyses_used")
      .eq("user_id", a.id)
      .single();

    expect(data?.analyses_used).toBe(3);
  });

  it("lets a user read their own usage so the UI can show a quota", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await svc
      .from("usage_daily")
      .insert({ user_id: a.id, day: "2026-08-03", analyses_used: 2 });

    const { data, error } = await a.client
      .from("usage_daily")
      .select("analyses_used")
      .single();

    expect(error).toBeNull();
    expect(data?.analyses_used).toBe(2);
  });

  it("hides webhook events entirely", async () => {
    const a = await anonUser();
    const { data } = await a.client.from("webhook_events").select("id");
    expect(data ?? []).toEqual([]);
  });
});
