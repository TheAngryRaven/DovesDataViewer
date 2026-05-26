import { describe, it, expect, vi, afterEach } from "vitest";
import {
  onGarageChange,
  emitGarageChange,
  type GarageChange,
} from "./garageEvents";

// The module holds a single process-wide listener Set. Each test subscribes and
// unsubscribes its own listeners so state can't leak between cases.

const change = (over: Partial<GarageChange> = {}): GarageChange => ({
  store: "karts",
  key: "kart-1",
  type: "put",
  ...over,
});

describe("onGarageChange / emitGarageChange", () => {
  afterEach(() => vi.restoreAllMocks());

  it("delivers an emitted change to a subscribed listener", () => {
    const seen: GarageChange[] = [];
    const off = onGarageChange((c) => seen.push(c));
    const c = change();
    emitGarageChange(c);
    off();
    expect(seen).toEqual([c]);
  });

  it("passes the exact change object through unmodified", () => {
    let received: GarageChange | undefined;
    const off = onGarageChange((c) => (received = c));
    const c = change({ store: "setups", key: "s-9", type: "delete" });
    emitGarageChange(c);
    off();
    expect(received).toBe(c); // same reference, not a copy
  });

  it("fans out to every subscribed listener", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onGarageChange(a);
    const offB = onGarageChange(b);
    emitGarageChange(change());
    offA();
    offB();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("returns an unsubscribe function that stops further delivery", () => {
    const listener = vi.fn();
    const off = onGarageChange(listener);
    emitGarageChange(change());
    off();
    emitGarageChange(change());
    expect(listener).toHaveBeenCalledOnce();
  });

  it("unsubscribing one listener leaves the others subscribed", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onGarageChange(a);
    const offB = onGarageChange(b);
    offA();
    emitGarageChange(change());
    offB();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it("calling unsubscribe twice is a no-op (Set.delete tolerates it)", () => {
    const listener = vi.fn();
    const off = onGarageChange(listener);
    off();
    expect(() => off()).not.toThrow();
    emitGarageChange(change());
    expect(listener).not.toHaveBeenCalled();
  });

  it("emitting with no subscribers does nothing and does not throw", () => {
    expect(() => emitGarageChange(change())).not.toThrow();
  });

  it("isolates a throwing listener so siblings still receive the change", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = vi.fn(() => {
      throw new Error("listener boom");
    });
    const ok = vi.fn();
    const offBoom = onGarageChange(boom);
    const offOk = onGarageChange(ok);
    expect(() => emitGarageChange(change())).not.toThrow();
    offBoom();
    offOk();
    expect(ok).toHaveBeenCalledOnce();
    expect(errSpy).toHaveBeenCalledOnce();
  });

  it("registering the same listener reference twice only fires it once (Set dedupe)", () => {
    const listener = vi.fn();
    const off1 = onGarageChange(listener);
    const off2 = onGarageChange(listener);
    emitGarageChange(change());
    off1();
    off2();
    expect(listener).toHaveBeenCalledOnce();
  });
});
