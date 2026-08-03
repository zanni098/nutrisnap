import { describe, it, expect } from "vitest";
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

    const { data } = await b.client
      .from("profiles")
      .update({ display_name: "hacked" })
      .eq("id", a.id)
      .select();

    // RLS filters the row out, so nothing is updated.
    expect(data).toEqual([]);
  });

  it("lets a user update their own profile", async () => {
    const a = await anonUser();

    const { data, error } = await a.client
      .from("profiles")
      .update({ display_name: "Asad", goal_calories: 2400 })
      .eq("id", a.id)
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.display_name).toBe("Asad");
    expect(data?.goal_calories).toBe(2400);
  });
});
