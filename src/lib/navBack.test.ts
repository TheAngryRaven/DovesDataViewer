import { describe, it, expect, vi } from "vitest";
import { goBackOrHome } from "./navBack";

describe("goBackOrHome", () => {
  it("steps back one entry when there is in-app history (idx > 0)", () => {
    const navigate = vi.fn();
    goBackOrHome(navigate, { state: { idx: 3 } });
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it("falls back to home when the page was opened directly (idx === 0)", () => {
    const navigate = vi.fn();
    goBackOrHome(navigate, { state: { idx: 0 } });
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("falls back to home when there is no history state at all", () => {
    const navigate = vi.fn();
    goBackOrHome(navigate, {});
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("falls back to home when history state lacks an idx", () => {
    const navigate = vi.fn();
    goBackOrHome(navigate, { state: { foo: "bar" } });
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
