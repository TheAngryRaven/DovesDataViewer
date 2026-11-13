import { describe, it, expect, vi, afterEach } from "vitest";
import { forgetLoggerPin, loadLoggerPin, saveLoggerPin } from "./pinStore";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("pinStore", () => {
  it("saves, loads and forgets a PIN per device id", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    saveLoggerPin("dev-1", "0042");
    saveLoggerPin("dev-2", "4821");
    expect(loadLoggerPin("dev-1")).toBe("0042");
    forgetLoggerPin("dev-1");
    expect(loadLoggerPin("dev-1")).toBeNull();
    expect(loadLoggerPin("dev-2")).toBe("4821");
  });

  it("never falls back to another logger's PIN", () => {
    // An entry from the first cut of the store, keyed by advertised name.
    const storage = memoryStorage({ "dove-logger-pins": JSON.stringify({ "name:BirdsEye-42": "4821" }) });
    vi.stubGlobal("localStorage", storage);
    expect(loadLoggerPin("dev-1")).toBeNull();
    saveLoggerPin("dev-1", "1234");
    // Rewriting the map drops the dead name-keyed entries.
    expect(JSON.parse(storage.data.get("dove-logger-pins")!)).toEqual({ "id:dev-1": "1234" });
  });

  it("ignores malformed storage", () => {
    vi.stubGlobal("localStorage", memoryStorage({ "dove-logger-pins": "{not json" }));
    expect(loadLoggerPin("dev-1")).toBeNull();
    vi.stubGlobal("localStorage", memoryStorage({ "dove-logger-pins": "[1,2]" }));
    expect(loadLoggerPin("dev-1")).toBeNull();
    vi.stubGlobal("localStorage", memoryStorage({ "dove-logger-pins": JSON.stringify({ "id:dev-1": "12" }) }));
    expect(loadLoggerPin("dev-1")).toBeNull();
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
    };
    vi.stubGlobal("localStorage", throwing);
    expect(() => saveLoggerPin("dev-1", "4821")).not.toThrow();
    expect(loadLoggerPin("dev-1")).toBeNull();
    expect(() => forgetLoggerPin("dev-1")).not.toThrow();
  });
});
