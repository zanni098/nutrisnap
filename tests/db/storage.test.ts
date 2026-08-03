import { describe, it, expect } from "vitest";
import { anonUser } from "../helpers/supabase";

const BUCKET = "meal-photos";

/** Minimal valid PNG header — enough for a mime-typed upload. */
function png(): Blob {
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
    type: "image/png",
  });
}

describe("meal-photos bucket", () => {
  it("lets a user upload into their own folder", async () => {
    const a = await anonUser();

    const { error } = await a.client.storage
      .from(BUCKET)
      .upload(`${a.id}/meal-1.png`, png());

    expect(error).toBeNull();
  });

  it("lets a user read back their own photo", async () => {
    const a = await anonUser();
    await a.client.storage.from(BUCKET).upload(`${a.id}/mine.png`, png());

    const { data, error } = await a.client.storage
      .from(BUCKET)
      .download(`${a.id}/mine.png`);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it("rejects uploading into another user's folder", async () => {
    const a = await anonUser();
    const b = await anonUser();

    const { error } = await b.client.storage
      .from(BUCKET)
      .upload(`${a.id}/forged.png`, png());

    expect(error).not.toBeNull();
  });

  it("rejects downloading another user's photo", async () => {
    const a = await anonUser();
    const b = await anonUser();
    await a.client.storage.from(BUCKET).upload(`${a.id}/private.png`, png());

    const { error } = await b.client.storage
      .from(BUCKET)
      .download(`${a.id}/private.png`);

    expect(error).not.toBeNull();
  });

  it("rejects deleting another user's photo", async () => {
    const a = await anonUser();
    const b = await anonUser();
    const path = `${a.id}/keepme.png`;
    await a.client.storage.from(BUCKET).upload(path, png());

    await b.client.storage.from(BUCKET).remove([path]);

    // The owner must still be able to fetch it.
    const { error } = await a.client.storage.from(BUCKET).download(path);
    expect(error).toBeNull();
  });

  it("hides other users' objects from a listing", async () => {
    const a = await anonUser();
    const b = await anonUser();
    await a.client.storage.from(BUCKET).upload(`${a.id}/secret.png`, png());

    const { data } = await b.client.storage.from(BUCKET).list(a.id);
    expect(data ?? []).toEqual([]);
  });

  it("is a private bucket — no anonymous public URL access", async () => {
    const a = await anonUser();
    const path = `${a.id}/private2.png`;
    await a.client.storage.from(BUCKET).upload(path, png());

    const { data } = a.client.storage.from(BUCKET).getPublicUrl(path);
    const res = await fetch(data.publicUrl);

    expect(res.ok).toBe(false);
  });

  it("rejects a disallowed mime type", async () => {
    const a = await anonUser();

    const { error } = await a.client.storage
      .from(BUCKET)
      .upload(`${a.id}/payload.html`, new Blob(["<script>"], { type: "text/html" }));

    expect(error).not.toBeNull();
  });
});
