import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { anonUser } from "../helpers/supabase";

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
