import { describe, it, expect } from "vitest";
import { decideSync, recordUpdatedAt } from "./merge";

const base = { hasLocal: true, hasCloud: true, localT: 0, cloudT: 0, pending: false };

describe("decideSync", () => {
  it("pushes a pending local change regardless of timestamps (priority-1)", () => {
    expect(decideSync({ ...base, pending: true, localT: 1, cloudT: 999 })).toBe("push");
  });

  it("skips a pending change with no local record (a pending delete)", () => {
    // The delete is flushed separately; we must not resurrect it from the cloud.
    expect(decideSync({ ...base, pending: true, hasLocal: false, hasCloud: true })).toBe("skip");
  });

  it("pushes a local-only record (e.g. anon → new account migration)", () => {
    expect(decideSync({ ...base, hasCloud: false })).toBe("push");
  });

  it("pulls a cloud-only record", () => {
    expect(decideSync({ ...base, hasLocal: false })).toBe("pull");
  });

  it("last-write-wins when both exist", () => {
    expect(decideSync({ ...base, localT: 200, cloudT: 100 })).toBe("push");
    expect(decideSync({ ...base, localT: 100, cloudT: 200 })).toBe("pull");
    expect(decideSync({ ...base, localT: 100, cloudT: 100 })).toBe("skip");
  });

  it("skips when neither side has the record", () => {
    expect(decideSync({ ...base, hasLocal: false, hasCloud: false })).toBe("skip");
  });
});

describe("recordUpdatedAt", () => {
  it("reads a numeric updatedAt, else 0", () => {
    expect(recordUpdatedAt({ updatedAt: 42 })).toBe(42);
    expect(recordUpdatedAt({})).toBe(0);
    expect(recordUpdatedAt(null)).toBe(0);
    expect(recordUpdatedAt({ updatedAt: "nope" })).toBe(0);
  });
});
