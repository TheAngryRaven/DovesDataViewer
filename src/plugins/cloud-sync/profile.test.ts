import { describe, it, expect, beforeEach, vi } from "vitest";

// Configurable fake for the supabase query builder cloudClient exposes. The
// builder is a thenable so `update().eq()` resolves to the update result, while
// `select().eq().maybeSingle()` resolves the read result separately. The real
// profanity filter is left intact (pure) so the "profanity" branch is exercised
// end to end.
const { state } = vi.hoisted(() => ({
  state: {
    read: { data: null as unknown, error: null as unknown },
    update: { error: null as unknown },
    updateArg: undefined as unknown,
  },
}));

vi.mock("./cloudClient", () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => state.read,
    update: (arg: unknown) => {
      state.updateArg = arg;
      return builder;
    },
    then: (onFulfilled: (v: unknown) => unknown) => onFulfilled(state.update),
  };
  return {
    profiles: () => builder,
    isUniqueViolation: (err: unknown) =>
      typeof err === "object" && err !== null && (err as { code?: string }).code === "23505",
  };
});

import { getMyProfile, updateDisplayName } from "./profile";

beforeEach(() => {
  state.read = { data: null, error: null };
  state.update = { error: null };
  state.updateArg = undefined;
});

describe("getMyProfile", () => {
  it("returns the profile row when one exists", async () => {
    state.read = { data: { user_id: "u1", display_name: "Speedy" }, error: null };
    expect(await getMyProfile("u1")).toEqual({ user_id: "u1", display_name: "Speedy" });
  });

  it("returns null when the profile doesn't exist yet", async () => {
    state.read = { data: null, error: null };
    expect(await getMyProfile("u1")).toBeNull();
  });

  it("throws on a query error", async () => {
    state.read = { data: null, error: { message: "db down" } };
    await expect(getMyProfile("u1")).rejects.toThrow(/db down/);
  });
});

describe("updateDisplayName", () => {
  it("rejects an empty / whitespace-only name without hitting the DB", async () => {
    expect(await updateDisplayName("u1", "   ")).toEqual({ ok: false, reason: "empty" });
    expect(state.updateArg).toBeUndefined();
  });

  it("rejects a profane name", async () => {
    const result = await updateDisplayName("u1", "l33t cunt");
    expect(result).toEqual({ ok: false, reason: "profanity" });
    expect(state.updateArg).toBeUndefined();
  });

  it("trims and saves a clean name", async () => {
    const result = await updateDisplayName("u1", "  Fast Eddie  ");
    expect(result).toEqual({ ok: true });
    expect(state.updateArg).toMatchObject({ display_name: "Fast Eddie" });
  });

  it("reports a taken name distinctly (unique violation)", async () => {
    state.update = { error: { code: "23505", message: "duplicate key" } };
    expect(await updateDisplayName("u1", "Taken")).toEqual({ ok: false, reason: "taken" });
  });

  it("surfaces other DB errors as 'error' with the message", async () => {
    state.update = { error: { code: "08006", message: "connection lost" } };
    expect(await updateDisplayName("u1", "Eddie")).toEqual({
      ok: false,
      reason: "error",
      message: "connection lost",
    });
  });
});
