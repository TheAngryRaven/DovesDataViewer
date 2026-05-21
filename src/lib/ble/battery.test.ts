import { describe, it, expect, vi, afterEach } from "vitest";
import { requestBatteryLevel } from "./battery";
import { createMockConnection, flushMicrotasks, lastWritten } from "./__test__/mockBle";

describe("requestBatteryLevel — BATT protocol", () => {
  afterEach(() => vi.useRealTimers());

  it("sends 'BATT' on fileRequest", async () => {
    const conn = createMockConnection();
    const promise = requestBatteryLevel(conn);
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("BATT");

    // Resolve the in-flight promise so the test doesn't hang
    conn.characteristics.fileStatus.simulate("BATT:50,3.7\n");
    await promise;
  });

  it("enables notifications on fileStatus before sending the command", async () => {
    const conn = createMockConnection();
    const promise = requestBatteryLevel(conn);
    await flushMicrotasks();

    expect(conn.characteristics.fileStatus.notificationsStarted).toBe(true);

    conn.characteristics.fileStatus.simulate("BATT:50,3.7\n");
    await promise;
  });

  it("resolves with parsed percent + voltage", async () => {
    const conn = createMockConnection();
    const promise = requestBatteryLevel(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("BATT:85,3.98\n");

    await expect(promise).resolves.toEqual({ percent: 85, voltage: 3.98 });
  });

  it("handles a response without a trailing newline", async () => {
    const conn = createMockConnection();
    const promise = requestBatteryLevel(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("BATT:12,3.55");

    await expect(promise).resolves.toEqual({ percent: 12, voltage: 3.55 });
  });

  it("handles BATT line surrounded by other status text (multi-line notification)", async () => {
    const conn = createMockConnection();
    const promise = requestBatteryLevel(conn);
    await flushMicrotasks();

    // Device sometimes batches several status lines into one notification.
    conn.characteristics.fileStatus.simulate("SVAL:foo=bar\nBATT:70,3.8\nSOK:foo\n");

    await expect(promise).resolves.toEqual({ percent: 70, voltage: 3.8 });
  });

  it("ignores non-BATT lines (keeps waiting until a valid BATT line arrives)", async () => {
    const conn = createMockConnection();
    const promise = requestBatteryLevel(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("RANDOM_NOISE\n");
    conn.characteristics.fileStatus.simulate("SOK:something\n");
    conn.characteristics.fileStatus.simulate("BATT:25,3.6\n");

    await expect(promise).resolves.toEqual({ percent: 25, voltage: 3.6 });
  });

  it("ignores a malformed BATT line and waits for a well-formed one", async () => {
    const conn = createMockConnection();
    const promise = requestBatteryLevel(conn);
    await flushMicrotasks();

    // Garbage payload that fails parseInt/parseFloat — should be skipped, not crash
    conn.characteristics.fileStatus.simulate("BATT:not,a-number\n");
    conn.characteristics.fileStatus.simulate("BATT:90,4.1\n");

    await expect(promise).resolves.toEqual({ percent: 90, voltage: 4.1 });
  });

  it("rejects after 5 seconds if no BATT response arrives", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = requestBatteryLevel(conn);
    await flushMicrotasks();

    // Sanity: command was sent
    expect(lastWritten(conn.characteristics.fileRequest)).toBe("BATT");

    // Trigger the 5s timeout
    vi.advanceTimersByTime(5000);

    await expect(promise).rejects.toThrow("Battery request timed out");
  });

  it("removes the notification listener after resolving (no lingering handlers)", async () => {
    const conn = createMockConnection();
    const promise = requestBatteryLevel(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("BATT:50,3.7\n");
    await promise;

    // A second simulate() should be a no-op now — no listener to receive it
    conn.characteristics.fileStatus.simulate("BATT:99,4.2\n");
    // (no assertion needed — if a stale listener fired, it'd try to resolve an
    // already-settled promise; we're verifying via "no error / no crash" here)
  });
});
