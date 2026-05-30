import { describe, it, expect } from "vitest";
import { containsProfanity, normalizeForProfanity } from "./profanity";

describe("normalizeForProfanity", () => {
  it("lowercases, maps leet, and strips non-letters", () => {
    expect(normalizeForProfanity("Sh1t_Head")).toBe("shithead");
    expect(normalizeForProfanity("f.u.c.k")).toBe("fuck");
    expect(normalizeForProfanity("@$$")).toBe("ass");
  });
  it("is empty for names with no letters", () => {
    expect(normalizeForProfanity("__- -__")).toBe("");
  });
});

describe("containsProfanity", () => {
  it("flags obvious profanity, including leet / spaced variants", () => {
    expect(containsProfanity("fuckface")).toBe(true);
    expect(containsProfanity("sh1t")).toBe(true);
    expect(containsProfanity("a_s_s_h_o_l_e")).toBe(true);
    expect(containsProfanity("F U C K")).toBe(true);
  });
  it("allows clean names", () => {
    expect(containsProfanity("SpeedRacer")).toBe(false);
    expect(containsProfanity("Mike Champagne")).toBe(false);
    expect(containsProfanity("")).toBe(false);
    expect(containsProfanity("Lap_Wizard_42")).toBe(false);
  });
});
