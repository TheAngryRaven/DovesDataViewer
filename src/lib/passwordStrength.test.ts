import { describe, it, expect } from "vitest";
import {
  evaluatePassword,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULE_IDS,
  type PasswordRuleId,
} from "./passwordStrength";

function ruleMap(password: string): Record<PasswordRuleId, boolean> {
  const { rules } = evaluatePassword(password);
  return Object.fromEntries(rules.map((r) => [r.id, r.passed])) as Record<
    PasswordRuleId,
    boolean
  >;
}

describe("evaluatePassword rules", () => {
  it("exposes every rule in a stable order, even for an empty password", () => {
    const { rules } = evaluatePassword("");
    expect(rules.map((r) => r.id)).toEqual(PASSWORD_RULE_IDS);
    expect(rules.every((r) => !r.passed)).toBe(true);
  });

  it("flags each character-class rule independently", () => {
    expect(ruleMap("password")).toMatchObject({
      length: true,
      lowercase: true,
      uppercase: false,
      number: false,
      symbol: false,
    });
    expect(ruleMap("Aa1!")).toMatchObject({
      length: false,
      lowercase: true,
      uppercase: true,
      number: true,
      symbol: true,
    });
  });

  it("requires at least the minimum length", () => {
    const short = "Aa1!".padEnd(MIN_PASSWORD_LENGTH - 1, "x");
    expect(evaluatePassword(short).rules.find((r) => r.id === "length")?.passed).toBe(false);
    const ok = "Aa1!".padEnd(MIN_PASSWORD_LENGTH, "x");
    expect(evaluatePassword(ok).rules.find((r) => r.id === "length")?.passed).toBe(true);
  });

  it("treats unicode/space-free symbols as a symbol but not whitespace", () => {
    expect(ruleMap("abc def").symbol).toBe(false);
    expect(ruleMap("abc-def").symbol).toBe(true);
  });
});

describe("evaluatePassword scoring", () => {
  it("scores an empty password as zero and weak", () => {
    const result = evaluatePassword("");
    expect(result.score).toBe(0);
    expect(result.level).toBe("weak");
    expect(result.meetsRequirements).toBe(false);
  });

  it("never rates a too-short password above fair", () => {
    const result = evaluatePassword("Aa1!");
    expect(result.score).toBeLessThanOrEqual(2);
    expect(["weak", "fair"]).toContain(result.level);
  });

  it("does not let raw length carry a low-variety password", () => {
    const result = evaluatePassword("aaaaaaaaaaaa");
    expect(result.level).not.toBe("strong");
  });

  it("rates a long, varied password as strong and meeting requirements", () => {
    const result = evaluatePassword("Str0ng!Pass99");
    expect(result.score).toBe(4);
    expect(result.level).toBe("strong");
    expect(result.meetsRequirements).toBe(true);
  });

  it("only meets requirements when every rule passes", () => {
    expect(evaluatePassword("alllowercase1!").meetsRequirements).toBe(false);
    expect(evaluatePassword("GoodPass1!").meetsRequirements).toBe(true);
  });
});
