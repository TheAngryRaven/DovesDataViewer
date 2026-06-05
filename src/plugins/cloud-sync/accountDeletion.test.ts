import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub the supabase client (auth OTP, edge-function invoke, and the
// account_deletions table) so the thin client wrappers are testable in node.
const { sb } = vi.hoisted(() => ({
  sb: {
    otpError: null as { message: string } | null,
    invokeResult: { data: null as unknown, error: null as { message: string } | null },
    selectResult: { data: null as unknown, error: null as { message: string } | null },
    deleteResult: { error: null as { message: string } | null },
    deletedFilter: null as Record<string, string> | null,
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const filters: Record<string, string> = {};
    let op: "select" | "delete" = "select";
    const builder = {
      select: () => {
        op = "select";
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      eq: (col: string, val: string) => {
        filters[col] = val;
        if (op === "delete") sb.deletedFilter = { ...filters };
        return builder;
      },
      maybeSingle: async () => sb.selectResult,
      then: (resolve: (v: unknown) => unknown) => resolve(sb.deleteResult),
    };
    return builder;
  };
  return {
    supabase: {
      auth: {
        signInWithOtp: async () => ({ error: sb.otpError }),
      },
      functions: {
        invoke: async () => sb.invokeResult,
      },
      from: table,
    },
  };
});

import {
  sendDeletionCode,
  scheduleAccountDeletion,
  getPendingDeletion,
  cancelAccountDeletion,
} from "./accountDeletion";

beforeEach(() => {
  sb.otpError = null;
  sb.invokeResult = { data: null, error: null };
  sb.selectResult = { data: null, error: null };
  sb.deleteResult = { error: null };
  sb.deletedFilter = null;
});

describe("sendDeletionCode", () => {
  it("requests an email OTP without creating a new user", async () => {
    await expect(sendDeletionCode("a@b.com")).resolves.toBeUndefined();
  });

  it("throws on an auth error", async () => {
    sb.otpError = { message: "rate limited" };
    await expect(sendDeletionCode("a@b.com")).rejects.toThrow(/rate limited/);
  });
});

describe("scheduleAccountDeletion", () => {
  it("returns the scheduled-deletion row from the edge function", async () => {
    sb.invokeResult = {
      data: { requested_at: "2026-06-01", scheduled_for: "2026-06-08" },
      error: null,
    };
    expect(await scheduleAccountDeletion("123456 ")).toEqual({
      requested_at: "2026-06-01",
      scheduled_for: "2026-06-08",
    });
  });

  it("throws when the edge function errors (e.g. bad code)", async () => {
    sb.invokeResult = { data: null, error: { message: "invalid code" } };
    await expect(scheduleAccountDeletion("000000")).rejects.toThrow(/invalid code/);
  });
});

describe("getPendingDeletion", () => {
  it("returns the pending row when one exists", async () => {
    sb.selectResult = { data: { requested_at: "x", scheduled_for: "y" }, error: null };
    expect(await getPendingDeletion("u1")).toEqual({ requested_at: "x", scheduled_for: "y" });
  });

  it("returns null when there's no pending request", async () => {
    sb.selectResult = { data: null, error: null };
    expect(await getPendingDeletion("u1")).toBeNull();
  });

  it("throws on a query error", async () => {
    sb.selectResult = { data: null, error: { message: "boom" } };
    await expect(getPendingDeletion("u1")).rejects.toThrow(/boom/);
  });
});

describe("cancelAccountDeletion", () => {
  it("deletes the pending row scoped to the owner", async () => {
    await cancelAccountDeletion("u1");
    expect(sb.deletedFilter).toEqual({ user_id: "u1" });
  });

  it("throws when the delete fails", async () => {
    sb.deleteResult = { error: { message: "denied" } };
    await expect(cancelAccountDeletion("u1")).rejects.toThrow(/denied/);
  });
});
