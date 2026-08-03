import { describe, it, expect } from "vitest";
import { anonUser, seedMeal, serviceClient } from "../helpers/supabase";

/** Ages a user's auth row so the purge considers it stale. */
async function backdate(userId: string, days: number) {
  const svc = serviceClient();
  const { error } = await svc.rpc("test_backdate_user", {
    p_user_id: userId,
    p_days: days,
  });
  if (error) throw error;
}

async function purge(): Promise<number> {
  const svc = serviceClient();
  const { data, error } = await svc.rpc("purge_stale_anonymous_users");
  if (error) throw error;
  return data as number;
}

async function exists(userId: string): Promise<boolean> {
  const svc = serviceClient();
  const { data } = await svc.auth.admin.getUserById(userId);
  return data.user !== null;
}

describe("purge_stale_anonymous_users", () => {
  it("deletes empty anonymous accounts older than 30 days", async () => {
    const a = await anonUser();
    await backdate(a.id, 40);

    await purge();

    expect(await exists(a.id)).toBe(false);
  });

  it("keeps anonymous accounts that have meals", async () => {
    const a = await anonUser();
    await seedMeal(a);
    await backdate(a.id, 40);

    await purge();

    expect(await exists(a.id)).toBe(true);
  });

  it("keeps recent empty anonymous accounts", async () => {
    const a = await anonUser();

    await purge();

    expect(await exists(a.id)).toBe(true);
  });

  it("reports how many accounts it removed", async () => {
    const a = await anonUser();
    const b = await anonUser();
    await backdate(a.id, 40);
    await backdate(b.id, 40);

    const deleted = await purge();

    expect(deleted).toBeGreaterThanOrEqual(2);
  });

  it("cascades the profile row away with the user", async () => {
    const a = await anonUser();
    await backdate(a.id, 40);

    await purge();

    const svc = serviceClient();
    const { data } = await svc.from("profiles").select("id").eq("id", a.id);
    expect(data).toEqual([]);
  });

  it("is not callable by an ordinary user", async () => {
    const a = await anonUser();
    const { error } = await a.client.rpc("purge_stale_anonymous_users");
    expect(error).not.toBeNull();
  });
});
