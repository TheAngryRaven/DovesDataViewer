import { describe, it, expect, vi } from "vitest";

// escapeLike is pure, but importing the module pulls in ./profile → ./cloudClient
// (which would instantiate the supabase client). Stub cloudClient so the import
// graph stays side-effect-free; we only exercise the pure escaping helper here.
vi.mock("./cloudClient", () => ({
  publicProfilesView: () => ({}),
  publicVehicles: () => ({}),
  userAvatars: () => ({}),
}));

import { escapeLike } from "./publicProfile";

describe("escapeLike", () => {
  it("passes a plain name through unchanged", () => {
    expect(escapeLike("Ayrton Senna")).toBe("Ayrton Senna");
  });

  it("escapes an underscore so it isn't an ilike single-char wildcard", () => {
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  it("escapes a percent so it isn't an ilike multi-char wildcard", () => {
    expect(escapeLike("50%")).toBe("50\\%");
  });

  it("escapes a literal backslash", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("escapes every wildcard in a mixed name", () => {
    expect(escapeLike("_100%\\done_")).toBe("\\_100\\%\\\\done\\_");
  });

  it("leaves the empty string empty", () => {
    expect(escapeLike("")).toBe("");
  });
});
