import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  reminderKey,
  parseFirmwareReminders,
  isReminderActive,
  snoozeFirmwareUpdate,
  isFirmwareUpdateSnoozed,
  clearFirmwareReminders,
} from "./firmwareUpdateReminder";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("reminderKey", () => {
  // The owner runs more than one logger, and a new release must ask again
  // rather than inherit the snooze taken against the previous one.
  it("separates devices and versions", () => {
    expect(reminderKey("Logger-A", "3.1.0")).not.toBe(reminderKey("Logger-B", "3.1.0"));
    expect(reminderKey("Logger-A", "3.1.0")).not.toBe(reminderKey("Logger-A", "3.2.0"));
  });

  it("still produces a key when either half is unknown", () => {
    expect(reminderKey(null, null)).toBe("unknown@unknown");
    expect(reminderKey("", "3.1.0")).toBe("unknown@3.1.0");
  });
});

describe("parseFirmwareReminders", () => {
  it("keeps a fresh entry", () => {
    const raw = JSON.stringify([{ id: "a@1", ts: NOW - 1000 }]);
    expect(parseFirmwareReminders(raw, NOW)).toEqual([{ id: "a@1", ts: NOW - 1000 }]);
  });

  it("drops an entry past 24 hours", () => {
    const raw = JSON.stringify([{ id: "a@1", ts: NOW - DAY - 1 }]);
    expect(parseFirmwareReminders(raw, NOW)).toEqual([]);
  });

  it("keeps one exactly at the boundary", () => {
    const raw = JSON.stringify([{ id: "a@1", ts: NOW - DAY }]);
    expect(parseFirmwareReminders(raw, NOW)).toHaveLength(1);
  });

  // Moving the clock back must not silently un-snooze everything.
  it("treats a future timestamp as live", () => {
    const raw = JSON.stringify([{ id: "a@1", ts: NOW + DAY }]);
    expect(parseFirmwareReminders(raw, NOW)).toHaveLength(1);
  });

  it("survives malformed storage", () => {
    expect(parseFirmwareReminders(null, NOW)).toEqual([]);
    expect(parseFirmwareReminders("not json {", NOW)).toEqual([]);
    expect(parseFirmwareReminders('{"not":"an array"}', NOW)).toEqual([]);
    expect(parseFirmwareReminders('[{"id":5,"ts":1}]', NOW)).toEqual([]);
    expect(parseFirmwareReminders('[{"id":"a","ts":"soon"}]', NOW)).toEqual([]);
    expect(parseFirmwareReminders("[null,3,true]", NOW)).toEqual([]);
  });

  it("bounds a runaway list", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `x${i}`, ts: NOW }));
    expect(parseFirmwareReminders(JSON.stringify(many), NOW)).toHaveLength(50);
  });
});

describe("isReminderActive", () => {
  it("matches only the same id, within the window", () => {
    const list = [{ id: "a@1", ts: NOW - 1000 }];
    expect(isReminderActive(list, "a@1", NOW)).toBe(true);
    expect(isReminderActive(list, "b@1", NOW)).toBe(false);
    expect(isReminderActive(list, "a@1", NOW + DAY + 1)).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(isReminderActive([], "a@1", NOW)).toBe(false);
  });
});

describe("snooze round trip", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("suppresses the prompt for that device and version only", () => {
    snoozeFirmwareUpdate("Logger-A", "3.2.0");
    expect(isFirmwareUpdateSnoozed("Logger-A", "3.2.0")).toBe(true);
    expect(isFirmwareUpdateSnoozed("Logger-B", "3.2.0")).toBe(false);
    expect(isFirmwareUpdateSnoozed("Logger-A", "3.3.0")).toBe(false);
  });

  it("replaces an earlier snooze for the same pair rather than stacking", () => {
    snoozeFirmwareUpdate("Logger-A", "3.2.0");
    snoozeFirmwareUpdate("Logger-A", "3.2.0");
    const raw = localStorage.getItem("dove-firmware-remind")!;
    expect(JSON.parse(raw)).toHaveLength(1);
  });

  it("clears everything on request", () => {
    snoozeFirmwareUpdate("Logger-A", "3.2.0");
    clearFirmwareReminders();
    expect(isFirmwareUpdateSnoozed("Logger-A", "3.2.0")).toBe(false);
  });

  it("degrades quietly when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(() => snoozeFirmwareUpdate("A", "1")).not.toThrow();
    expect(isFirmwareUpdateSnoozed("A", "1")).toBe(false);
    expect(() => clearFirmwareReminders()).not.toThrow();
  });
});
