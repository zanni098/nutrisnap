import { describe, it, expect } from "vitest";
import { anonUser, serviceClient } from "../helpers/supabase";

const FREE_LIMIT = 3;

interface QuotaResult {
  allowed: boolean;
  used: number;
  quota: number;
}

async function consume(userId: string): Promise<QuotaResult> {
  const svc = serviceClient();
  const { data, error } = await svc.rpc("consume_analysis_quota", {
    p_user_id: userId,
  });
  if (error) throw error;
  return (data as QuotaResult[])[0];
}

/** Gives the user an active pro subscription ending `msFromNow` in the future. */
async function subscribe(userId: string, status: string, msFromNow: number) {
  const svc = serviceClient();
  const { error } = await svc.from("subscriptions").insert({
    user_id: userId,
    status,
    plan: "pro",
    current_period_end: new Date(Date.now() + msFromNow).toISOString(),
  });
  if (error) throw error;
}

describe("consume_analysis_quota", () => {
  it("allows the first call and reports usage", async () => {
    const a = await anonUser();
    const r = await consume(a.id);

    expect(r.allowed).toBe(true);
    expect(r.used).toBe(1);
    expect(r.quota).toBe(FREE_LIMIT);
  });

  it("blocks the call after the limit is reached", async () => {
    const a = await anonUser();
    for (let i = 0; i < FREE_LIMIT; i++) await consume(a.id);

    const r = await consume(a.id);
    expect(r.allowed).toBe(false);
    expect(r.used).toBe(FREE_LIMIT);
  });

  // The reason the check and increment are a single statement. A read-then-write
  // implementation hands out extra analyses to anyone firing parallel requests.
  it("allows exactly the limit under concurrent load", async () => {
    const a = await anonUser();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => consume(a.id)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(FREE_LIMIT);

    const svc = serviceClient();
    const { data } = await svc
      .from("usage_daily")
      .select("analyses_used")
      .eq("user_id", a.id)
      .single();

    expect(data?.analyses_used).toBe(FREE_LIMIT);
  });

  it("does not meter an active subscriber", async () => {
    const a = await anonUser();
    await subscribe(a.id, "active", 86_400_000);

    for (let i = 0; i < 10; i++) {
      expect((await consume(a.id)).allowed).toBe(true);
    }

    const svc = serviceClient();
    const { data } = await svc
      .from("usage_daily")
      .select("analyses_used")
      .eq("user_id", a.id);

    expect(data).toEqual([]);
  });

  // Cancelling is not the same as losing access. Checking status = 'active'
  // alone would cut off a paid-up user the moment they clicked cancel.
  it("still serves a canceled subscriber inside their paid period", async () => {
    const a = await anonUser();
    await subscribe(a.id, "canceled", 86_400_000);

    const r = await consume(a.id);
    expect(r.allowed).toBe(true);
    expect(r.quota).toBe(-1);
  });

  it("meters a canceled subscriber once their period has ended", async () => {
    const a = await anonUser();
    await subscribe(a.id, "canceled", -86_400_000);

    expect((await consume(a.id)).quota).toBe(FREE_LIMIT);
  });

  // Refunds and chargebacks cut access immediately, period end notwithstanding.
  it("meters a revoked subscriber even inside the paid period", async () => {
    const a = await anonUser();
    await subscribe(a.id, "revoked", 86_400_000);

    expect((await consume(a.id)).quota).toBe(FREE_LIMIT);
  });

  it("is not callable by an ordinary user", async () => {
    const a = await anonUser();
    const { error } = await a.client.rpc("consume_analysis_quota", {
      p_user_id: a.id,
    });
    expect(error).not.toBeNull();
  });

  it("meters each user independently", async () => {
    const a = await anonUser();
    const b = await anonUser();

    for (let i = 0; i < FREE_LIMIT; i++) await consume(a.id);

    expect((await consume(a.id)).allowed).toBe(false);
    expect((await consume(b.id)).allowed).toBe(true);
  });
});

describe("refund_analysis_quota", () => {
  it("returns a consumed analysis to the pool", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await consume(a.id);
    await consume(a.id);
    await svc.rpc("refund_analysis_quota", { p_user_id: a.id });

    expect((await consume(a.id)).used).toBe(2);
  });

  it("never drops below zero", async () => {
    const a = await anonUser();
    const svc = serviceClient();

    await consume(a.id);
    for (let i = 0; i < 5; i++) {
      await svc.rpc("refund_analysis_quota", { p_user_id: a.id });
    }

    const { data } = await svc
      .from("usage_daily")
      .select("analyses_used")
      .eq("user_id", a.id)
      .single();

    expect(data?.analyses_used).toBe(0);
  });

  it("is not callable by an ordinary user", async () => {
    const a = await anonUser();
    const { error } = await a.client.rpc("refund_analysis_quota", {
      p_user_id: a.id,
    });
    expect(error).not.toBeNull();
  });
});
