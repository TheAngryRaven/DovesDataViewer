import { describe, expect, it } from "vitest";
import { createLatestGate } from "./latestGate";

describe("createLatestGate", () => {
  it("keeps a claim current until something supersedes it", () => {
    const gate = createLatestGate();
    const isCurrent = gate.claim();
    expect(isCurrent()).toBe(true);
    expect(isCurrent()).toBe(true);
  });

  it("drops an older claim once a newer one starts", () => {
    const gate = createLatestGate();
    const first = gate.claim();
    const second = gate.claim();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("drops every in-flight claim on invalidate (session switch)", async () => {
    // Mirrors the native video copy: it resolves after the user switched
    // sessions, and must not attach its key to the new session.
    const gate = createLatestGate();
    const adopted: string[] = [];
    const isCurrent = gate.claim();
    const copy = Promise.resolve("session-a-key").then((key) => {
      if (isCurrent()) adopted.push(key);
    });
    gate.invalidate();
    await copy;
    expect(adopted).toEqual([]);
  });
});
