import { describe, it, expect } from "vitest";
import { cn } from "./utils";

// `cn` = clsx (conditional/variadic class joining) piped through tailwind-merge
// (last-wins conflict resolution for Tailwind utility classes).

// ─── basic joining ──────────────────────────────────────────────────────────

describe("cn — joining", () => {
  it("joins multiple string args with spaces", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("returns empty string for no args", () => {
    expect(cn()).toBe("");
  });

  it("flattens array inputs", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("merges object inputs by truthy value (clsx semantics)", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });
});

// ─── conditional / falsy values ──────────────────────────────────────────────

describe("cn — conditionals & falsy", () => {
  it("drops false, null, undefined, 0 and empty string", () => {
    expect(cn("a", false, null, undefined, 0, "", "b")).toBe("a b");
  });

  it("keeps a class chosen by a truthy ternary", () => {
    const active = true;
    expect(cn("base", active && "active")).toBe("base active");
  });

  it("omits a class behind a falsy ternary", () => {
    const active = false;
    expect(cn("base", active && "active")).toBe("base");
  });
});

// ─── tailwind-merge conflict resolution (last wins) ──────────────────────────

describe("cn — tailwind-merge dedupe", () => {
  it("keeps the last of conflicting padding utilities", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("keeps the last of conflicting text colors", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("does NOT collapse non-conflicting utilities", () => {
    // px and py are different axes — both survive
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  it("lets a later override win even through conditional inputs", () => {
    expect(cn("p-2", { "p-8": true })).toBe("p-8");
  });

  it("preserves order of unrelated classes while resolving a conflict", () => {
    expect(cn("flex", "p-2", "items-center", "p-6")).toBe("flex items-center p-6");
  });
});
