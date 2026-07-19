import { describe, expect, it } from "vitest";

import { decideUpdateAction } from "./updateFlow";

const base = { pathname: "/", sessionActive: false, alreadyAutoApplied: false };

describe("decideUpdateAction", () => {
  it("auto-applies on an idle home page", () => {
    expect(decideUpdateAction(base)).toBe("auto");
  });

  it("never yanks a loaded session — toast instead", () => {
    expect(decideUpdateAction({ ...base, sessionActive: true })).toBe("toast");
  });

  it("only the home page auto-applies (other routes are active use)", () => {
    for (const pathname of ["/simulator", "/leaderboards", "/s/abc", "/admin"]) {
      expect(decideUpdateAction({ ...base, pathname })).toBe("toast");
    }
  });

  it("an already-attempted commit falls back to the toast (no reload loops)", () => {
    expect(decideUpdateAction({ ...base, alreadyAutoApplied: true })).toBe("toast");
  });
});
