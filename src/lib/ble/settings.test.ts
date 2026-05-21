import { describe, it, expect, vi, afterEach } from "vitest";
import {
  requestSettingsList,
  getDeviceSetting,
  setDeviceSetting,
  resetDeviceSettings,
} from "./settings";
import { createMockConnection, flushMicrotasks, lastWritten } from "./__test__/mockBle";

afterEach(() => vi.useRealTimers());

// ─── SLIST ───────────────────────────────────────────────────────────────────

describe("requestSettingsList — SLIST protocol", () => {
  it("sends 'SLIST' and resolves with parsed settings on SEND", async () => {
    const conn = createMockConnection();
    const promise = requestSettingsList(conn);
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("SLIST");

    conn.characteristics.fileStatus.simulate("SVAL:wifi_ssid=Home\nSVAL:wifi_pass=secret\nSEND\n");

    await expect(promise).resolves.toEqual({
      wifi_ssid: "Home",
      wifi_pass: "secret",
    });
  });

  it("accumulates SVAL values across multiple notifications, finalizes on SEND", async () => {
    const conn = createMockConnection();
    const promise = requestSettingsList(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SVAL:a=1\n");
    conn.characteristics.fileStatus.simulate("SVAL:b=2\nSVAL:c=3\n");
    conn.characteristics.fileStatus.simulate("SEND\n");

    await expect(promise).resolves.toEqual({ a: "1", b: "2", c: "3" });
  });

  it("handles values containing '=' correctly (only splits on the first one)", async () => {
    const conn = createMockConnection();
    const promise = requestSettingsList(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SVAL:formula=x=y+z\nSEND\n");

    await expect(promise).resolves.toEqual({ formula: "x=y+z" });
  });

  it("ignores SVAL lines without an '=' (malformed)", async () => {
    const conn = createMockConnection();
    const promise = requestSettingsList(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SVAL:bogus\nSVAL:good=ok\nSEND\n");

    await expect(promise).resolves.toEqual({ good: "ok" });
  });

  it("resolves with collected settings if device goes silent for >3s (safety timeout)", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = requestSettingsList(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SVAL:a=1\n");
    conn.characteristics.fileStatus.simulate("SVAL:b=2\n");

    // No SEND ever arrives — safety timeout (3s after last message) resolves
    vi.advanceTimersByTime(3000);

    await expect(promise).resolves.toEqual({ a: "1", b: "2" });
  });

  it("rejects with timeout if no response in 10s", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = requestSettingsList(conn);
    await flushMicrotasks();

    vi.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow(/Timeout/);
  });
});

// ─── SGET ────────────────────────────────────────────────────────────────────

describe("getDeviceSetting — SGET protocol", () => {
  it("sends 'SGET:<key>' and resolves with the value for that key", async () => {
    const conn = createMockConnection();
    const promise = getDeviceSetting(conn, "wifi_ssid");
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("SGET:wifi_ssid");

    conn.characteristics.fileStatus.simulate("SVAL:wifi_ssid=HomeNetwork\n");

    await expect(promise).resolves.toBe("HomeNetwork");
  });

  it("only resolves for the requested key (ignores other SVAL lines)", async () => {
    const conn = createMockConnection();
    const promise = getDeviceSetting(conn, "target");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SVAL:other=ignore\n");
    conn.characteristics.fileStatus.simulate("SVAL:also_ignore=junk\n");
    conn.characteristics.fileStatus.simulate("SVAL:target=found\n");

    await expect(promise).resolves.toBe("found");
  });

  it("rejects on SERR with the error message", async () => {
    const conn = createMockConnection();
    const promise = getDeviceSetting(conn, "missing_key");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SERR:NOT_FOUND\n");

    await expect(promise).rejects.toThrow("NOT_FOUND");
  });

  it("rejects with timeout after 5s of no response", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = getDeviceSetting(conn, "k");
    await flushMicrotasks();

    vi.advanceTimersByTime(5000);

    await expect(promise).rejects.toThrow(/Timeout/);
  });
});

// ─── SSET ────────────────────────────────────────────────────────────────────

describe("setDeviceSetting — SSET protocol", () => {
  it("sends 'SSET:<key>=<value>' and resolves on SOK", async () => {
    const conn = createMockConnection();
    const promise = setDeviceSetting(conn, "wifi_ssid", "HomeNetwork");
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("SSET:wifi_ssid=HomeNetwork");

    conn.characteristics.fileStatus.simulate("SOK:wifi_ssid\n");

    await expect(promise).resolves.toBeUndefined();
  });

  it("accepts 'SOK: <key>' with a space (device firmware quirk)", async () => {
    const conn = createMockConnection();
    const promise = setDeviceSetting(conn, "k", "v");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SOK: k\n");

    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects on SERR with the error message", async () => {
    const conn = createMockConnection();
    const promise = setDeviceSetting(conn, "readonly_key", "x");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SERR:WRITE_FAIL\n");

    await expect(promise).rejects.toThrow("WRITE_FAIL");
  });

  it("ignores SOK for a different key (waits for matching SOK)", async () => {
    const conn = createMockConnection();
    const promise = setDeviceSetting(conn, "target_key", "v");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SOK:wrong_key\n");
    conn.characteristics.fileStatus.simulate("SOK:target_key\n");

    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects with timeout after 5s of no response", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = setDeviceSetting(conn, "k", "v");
    await flushMicrotasks();

    vi.advanceTimersByTime(5000);

    await expect(promise).rejects.toThrow(/Timeout/);
  });
});

// ─── SRESET ──────────────────────────────────────────────────────────────────

describe("resetDeviceSettings — SRESET protocol", () => {
  it("sends 'SRESET' and resolves on SOK:RESET", async () => {
    const conn = createMockConnection();
    const promise = resetDeviceSettings(conn);
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("SRESET");

    conn.characteristics.fileStatus.simulate("SOK:RESET\n");

    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects on SERR with the error message", async () => {
    const conn = createMockConnection();
    const promise = resetDeviceSettings(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SERR:RESET_FAILED\n");

    await expect(promise).rejects.toThrow("RESET_FAILED");
  });

  it("ignores unrelated SOK lines (only SOK:RESET resolves)", async () => {
    const conn = createMockConnection();
    const promise = resetDeviceSettings(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SOK:somethingelse\n");
    conn.characteristics.fileStatus.simulate("SOK:RESET\n");

    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects with timeout after 10s of no response", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = resetDeviceSettings(conn);
    await flushMicrotasks();

    vi.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow(/Timeout/);
  });
});
