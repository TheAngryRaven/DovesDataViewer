import { describe, it, expect, afterEach } from "vitest";
import { setActiveUserId, getActiveUserId, userScope } from "./activeUser";

// Module-level state — reset after each test so cases don't leak into each other.
afterEach(() => setActiveUserId(null));

describe("active user partition", () => {
  it("defaults to signed-out (null id, 'anon' scope)", () => {
    expect(getActiveUserId()).toBeNull();
    expect(userScope()).toBe("anon");
  });

  it("tracks the signed-in user's id and scopes by it", () => {
    setActiveUserId("user-42");
    expect(getActiveUserId()).toBe("user-42");
    expect(userScope()).toBe("user-42");
  });

  it("falls back to 'anon' on sign-out so anon data never leaks into an account", () => {
    setActiveUserId("user-42");
    setActiveUserId(null);
    expect(getActiveUserId()).toBeNull();
    expect(userScope()).toBe("anon");
  });
});
