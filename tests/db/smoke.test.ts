import { describe, it, expect } from "vitest";
import { anonUser, serviceClient } from "../helpers/supabase";

describe("local stack", () => {
  it("creates an anonymous user with a real auth row", async () => {
    const user = await anonUser();
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);

    const svc = serviceClient();
    const { data, error } = await svc.auth.admin.getUserById(user.id);
    expect(error).toBeNull();
    expect(data.user?.is_anonymous).toBe(true);
  });
});
