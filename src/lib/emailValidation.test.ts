import { describe, it, expect } from "vitest";
import { emailDomain, isDisposableEmail, looksLikeEmail } from "./emailValidation";

describe("emailDomain", () => {
  it("returns the lower-cased domain", () => {
    expect(emailDomain("Driver@Gmail.COM")).toBe("gmail.com");
  });
  it("returns null without a usable domain", () => {
    expect(emailDomain("no-at-sign")).toBeNull();
    expect(emailDomain("trailing@")).toBeNull();
  });
});

describe("isDisposableEmail", () => {
  it("flags known disposable providers (case-insensitive)", () => {
    expect(isDisposableEmail("a@mailinator.com")).toBe(true);
    expect(isDisposableEmail("a@Guerrillamail.com")).toBe(true);
    expect(isDisposableEmail("a@yopmail.com")).toBe(true);
  });
  it("allows normal providers", () => {
    expect(isDisposableEmail("a@gmail.com")).toBe(false);
    expect(isDisposableEmail("racer@hackthetrack.net")).toBe(false);
  });
  it("is false for malformed input", () => {
    expect(isDisposableEmail("not-an-email")).toBe(false);
  });
});

describe("looksLikeEmail", () => {
  it("accepts a basic address and rejects obvious junk", () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("a@b")).toBe(false);
    expect(looksLikeEmail("a b@c.com")).toBe(false);
  });
});
