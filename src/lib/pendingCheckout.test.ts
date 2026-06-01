import { describe, it, expect } from "vitest";
import { parsePendingCheckout } from "./pendingCheckout";

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("parsePendingCheckout", () => {
  it("returns null for empty / malformed input", () => {
    expect(parsePendingCheckout(null, NOW)).toBeNull();
    expect(parsePendingCheckout("not json", NOW)).toBeNull();
    expect(parsePendingCheckout("{}", NOW)).toBeNull();
  });

  it("rejects the free tier and unknown intervals", () => {
    expect(parsePendingCheckout(JSON.stringify({ tier: "free", interval: "monthly", ts: NOW }), NOW)).toBeNull();
    expect(parsePendingCheckout(JSON.stringify({ tier: "pro", interval: "weekly", ts: NOW }), NOW)).toBeNull();
  });

  it("expires intents older than 24h", () => {
    const stale = { tier: "pro", interval: "annual", ts: NOW - DAY - 1 };
    expect(parsePendingCheckout(JSON.stringify(stale), NOW)).toBeNull();
  });

  it("parses a valid, fresh paid intent", () => {
    const intent = { tier: "plus", interval: "annual", ts: NOW - 1000 };
    expect(parsePendingCheckout(JSON.stringify(intent), NOW)).toEqual(intent);
  });
});
