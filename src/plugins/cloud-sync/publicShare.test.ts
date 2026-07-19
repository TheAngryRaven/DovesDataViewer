import { describe, it, expect, beforeEach, vi } from "vitest";

// publicShare is the anon read side of shared sessions (plan 0009). Its cloud seam
// (`./cloudClient`) is mocked with a tiny chainable builder whose terminal result
// (`maybeSingle` for the single fetch, `order` for the list) is set per test — the
// same style as the other cloud-sync unit tests, kept minimal for these pure maps.

const state = vi.hoisted(() => ({
  single: { data: null as unknown, error: null as { message: string } | null },
  list: { data: null as unknown, error: null as { message: string } | null },
  publicUrl: undefined as string | undefined,
  lastPath: undefined as string | undefined,
}));

vi.mock("./cloudClient", () => {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = () => Promise.resolve(state.single);
  builder.order = () => Promise.resolve(state.list);
  return {
    sharedSessions: () => builder,
    sharedFiles: () => ({
      getPublicUrl: (path: string) => {
        state.lastPath = path;
        return { data: state.publicUrl ? { publicUrl: state.publicUrl } : null };
      },
    }),
  };
});

import {
  fetchSharedSession,
  fetchSharedSessionsByUser,
  sharedBlobUrl,
} from "./publicShare";

const fullRow = (overrides: Record<string, unknown> = {}) => ({
  token: "tok123",
  user_id: "user-1",
  file_ext: "dovex",
  course: { name: "OKC" },
  track_name: "Orlando Kart Center",
  course_name: "Full",
  session_date: "2026-06-30T12:00:00.000Z",
  fastest_lap_ms: 41234,
  size_bytes: 2048,
  profiles: { display_name: "Dove" },
  ...overrides,
});

beforeEach(() => {
  state.single = { data: null, error: null };
  state.list = { data: null, error: null };
  state.publicUrl = undefined;
  state.lastPath = undefined;
});

describe("fetchSharedSession", () => {
  it("returns null for an empty/whitespace token without touching the cloud", async () => {
    // If it queried, maybeSingle's null data would still yield null, so also assert
    // via a non-null row that a blank token short-circuits before the map runs.
    state.single = { data: fullRow(), error: null };
    expect(await fetchSharedSession("")).toBeNull();
    expect(await fetchSharedSession("   ")).toBeNull();
  });

  it("maps a full row, parsing the session date and the object-shaped profile embed", async () => {
    state.single = { data: fullRow(), error: null };
    const s = await fetchSharedSession("  tok123  ");
    expect(s).not.toBeNull();
    expect(s!.token).toBe("tok123");
    expect(s!.userId).toBe("user-1");
    expect(s!.fileExt).toBe("dovex");
    expect(s!.course).toEqual({ name: "OKC" });
    expect(s!.trackName).toBe("Orlando Kart Center");
    expect(s!.fastestLapMs).toBe(41234);
    expect(s!.sessionDate).toBeInstanceOf(Date);
    expect(s!.sessionDate!.toISOString()).toBe("2026-06-30T12:00:00.000Z");
    expect(s!.driverName).toBe("Dove");
  });

  it("reads the display name from the array-shaped profile embed", async () => {
    state.single = { data: fullRow({ profiles: [{ display_name: "Raven" }] }), error: null };
    const s = await fetchSharedSession("tok123");
    expect(s!.driverName).toBe("Raven");
  });

  it("yields a null driver name when the profile embed is absent or empty", async () => {
    state.single = { data: fullRow({ profiles: null }), error: null };
    expect((await fetchSharedSession("tok123"))!.driverName).toBeNull();
    state.single = { data: fullRow({ profiles: [] }), error: null };
    expect((await fetchSharedSession("tok123"))!.driverName).toBeNull();
  });

  it("yields a null session date when the row has none", async () => {
    state.single = { data: fullRow({ session_date: null }), error: null };
    expect((await fetchSharedSession("tok123"))!.sessionDate).toBeNull();
  });

  it("returns null when the token resolves to no row", async () => {
    state.single = { data: null, error: null };
    expect(await fetchSharedSession("missing")).toBeNull();
  });

  it("throws the cloud error message", async () => {
    state.single = { data: null, error: { message: "boom" } };
    await expect(fetchSharedSession("tok123")).rejects.toThrow("boom");
  });
});

describe("fetchSharedSessionsByUser", () => {
  it("maps rows newest-first, null-guarding both dates", async () => {
    state.list = {
      data: [
        fullRow({ token: "a", created_at: "2026-07-01T00:00:00.000Z" }),
        fullRow({ token: "b", session_date: null, created_at: null }),
      ],
      error: null,
    };
    const list = await fetchSharedSessionsByUser("user-1");
    expect(list).toHaveLength(2);
    expect(list[0].token).toBe("a");
    expect(list[0].createdAt).toBeInstanceOf(Date);
    expect(list[0].sessionDate).toBeInstanceOf(Date);
    expect(list[1].sessionDate).toBeNull();
    expect(list[1].createdAt).toBeNull();
  });

  it("returns an empty array when the driver has no shares", async () => {
    state.list = { data: null, error: null };
    expect(await fetchSharedSessionsByUser("user-1")).toEqual([]);
  });

  it("throws the cloud error message", async () => {
    state.list = { data: null, error: { message: "nope" } };
    await expect(fetchSharedSessionsByUser("user-1")).rejects.toThrow("nope");
  });
});

describe("sharedBlobUrl", () => {
  it("builds the public URL from user id + token and returns it", () => {
    state.publicUrl = "https://cdn.example/shared/user-1/tok123";
    expect(sharedBlobUrl("user-1", "tok123")).toBe("https://cdn.example/shared/user-1/tok123");
    expect(state.lastPath).toBe("user-1/tok123");
  });

  it("returns null when no public URL is available", () => {
    state.publicUrl = undefined;
    expect(sharedBlobUrl("user-1", "tok123")).toBeNull();
  });
});
