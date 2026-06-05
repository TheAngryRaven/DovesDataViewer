import { describe, it, expect, beforeEach, vi } from "vitest";

// The real supabase client calls createClient() at import time and wires
// auth.storage to `localStorage`, which doesn't exist in the node test env. Stub
// it so cloudClient's pure helpers (and the rpc-backed usage reader) are testable.
const { rpcResult } = vi.hoisted(() => ({
  rpcResult: { value: { data: null as unknown, error: null as unknown } },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({}),
    storage: { from: () => ({}) },
    rpc: async () => rpcResult.value,
  },
}));

import {
  SYNC_BUCKET,
  isQuotaError,
  isUniqueViolation,
  fetchStorageUsage,
  type StorageUsageRow,
} from "./cloudClient";

describe("isQuotaError", () => {
  it("flags the server's pooled-quota rejection (case-insensitive)", () => {
    expect(isQuotaError(new Error("quota_exceeded"))).toBe(true);
    expect(isQuotaError(new Error("ERROR: Quota_Exceeded for tier"))).toBe(true);
  });

  it("ignores unrelated errors and non-errors", () => {
    expect(isQuotaError(new Error("network down"))).toBe(false);
    expect(isQuotaError("quota_exceeded")).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe("isUniqueViolation", () => {
  it("detects the Postgres unique-violation code", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("detects it from the message text when the code is absent", () => {
    expect(isUniqueViolation({ message: "duplicate key value violates unique constraint" })).toBe(true);
    expect(isUniqueViolation({ message: "violates UNIQUE constraint" })).toBe(true);
  });

  it("returns false for other errors and non-objects", () => {
    expect(isUniqueViolation({ code: "23503", message: "fk violation" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("nope")).toBe(false);
  });
});

describe("fetchStorageUsage", () => {
  beforeEach(() => {
    rpcResult.value = { data: null, error: null };
  });

  it("returns the single usage row from the RPC", async () => {
    const row: StorageUsageRow = {
      documents_bytes: 10,
      logs_bytes: 20,
      snapshots_bytes: 5,
      total_limit_bytes: 1000,
    };
    rpcResult.value = { data: [row], error: null };
    expect(await fetchStorageUsage()).toEqual(row);
  });

  it("returns null when the RPC yields no rows", async () => {
    rpcResult.value = { data: [], error: null };
    expect(await fetchStorageUsage()).toBeNull();
  });

  it("throws with the server message on RPC error", async () => {
    rpcResult.value = { data: null, error: { message: "boom" } };
    await expect(fetchStorageUsage()).rejects.toThrow(/boom/);
  });
});

describe("SYNC_BUCKET", () => {
  it("is the private per-user file bucket", () => {
    expect(SYNC_BUCKET).toBe("user-files");
  });
});
