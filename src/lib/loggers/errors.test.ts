import { describe, expect, it } from "vitest";
import {
  classifyLoggerError,
  isMissingCommandError,
  loggerErrorKey,
  recoveryActionFor,
  type LoggerErrorCategory,
  type LoggerFlowStage,
} from "./errors";

describe("classifyLoggerError", () => {
  it("maps each backend prefix to its category", () => {
    expect(classifyLoggerError("device unreachable: not found").category).toBe("unreachable");
    expect(classifyLoggerError("device hung: timed out mid-transfer").category).toBe("hung");
    expect(classifyLoggerError("protocol error: bad frame").category).toBe("protocol");
    expect(classifyLoggerError("unsupported: alfano is android-only").category).toBe("unsupported");
    expect(classifyLoggerError("Wi-Fi join was declined").category).toBe("wifi-declined");
    expect(classifyLoggerError("no logger connected — call logger_connect first").category).toBe(
      "not-connected",
    );
  });

  it("splits permission denials out of the unreachable prefix", () => {
    expect(classifyLoggerError("device unreachable: BLUETOOTH_SCAN permission denied").category).toBe(
      "permission",
    );
    expect(classifyLoggerError("device unreachable: Nearby devices not allowed").category).toBe(
      "permission",
    );
    expect(classifyLoggerError("device unreachable: user denied the request").category).toBe(
      "permission",
    );
    // Plain unreachable stays unreachable.
    expect(classifyLoggerError("device unreachable: radio off").category).toBe("unreachable");
  });

  it("is case-insensitive on the prefix but preserves the raw detail", () => {
    const result = classifyLoggerError("Device Unreachable: Radio Off");
    expect(result.category).toBe("unreachable");
    expect(result.detail).toBe("Device Unreachable: Radio Off");
  });

  it("accepts Error instances and arbitrary values", () => {
    expect(classifyLoggerError(new Error("device hung: link dropped")).category).toBe("hung");
    expect(classifyLoggerError(new Error("something exploded")).category).toBe("unknown");
    expect(classifyLoggerError(42).detail).toBe("42");
    expect(classifyLoggerError(undefined).category).toBe("unknown");
  });

  it("classifies Web Bluetooth permission DOMExceptions", () => {
    const notAllowed = Object.assign(new Error("User cancelled the requestDevice() chooser."), {
      name: "NotAllowedError",
    });
    expect(classifyLoggerError(notAllowed).category).toBe("permission");
    const security = Object.assign(new Error("Access to the feature is disallowed."), {
      name: "SecurityError",
    });
    expect(classifyLoggerError(security).category).toBe("permission");
  });

  it("finds a Wi-Fi decline anywhere in the message", () => {
    expect(classifyLoggerError("connect failed: Wi-Fi join was declined by the user").category).toBe(
      "wifi-declined",
    );
  });

  it("falls back to unknown for unrecognized strings", () => {
    const result = classifyLoggerError("kaboom");
    expect(result).toEqual({ category: "unknown", detail: "kaboom" });
  });
});

describe("recoveryActionFor", () => {
  const stages: LoggerFlowStage[] = ["scan", "connect", "download", "firmware"];

  it("never offers an action for unsupported", () => {
    for (const stage of stages) expect(recoveryActionFor("unsupported", stage)).toBe("none");
  });

  it("re-drives the OS picker after a Wi-Fi decline", () => {
    for (const stage of stages) expect(recoveryActionFor("wifi-declined", stage)).toBe("reconnect");
  });

  it("reconnects after a hang (the link is gone)", () => {
    for (const stage of stages) expect(recoveryActionFor("hung", stage)).toBe("reconnect");
  });

  it("rescans when nothing is connected", () => {
    for (const stage of stages) expect(recoveryActionFor("not-connected", stage)).toBe("rescan");
  });

  it("rescans for reachability failures during scan/connect, retries during transfers", () => {
    for (const category of ["unreachable", "permission"] as LoggerErrorCategory[]) {
      expect(recoveryActionFor(category, "scan")).toBe("rescan");
      expect(recoveryActionFor(category, "connect")).toBe("rescan");
      expect(recoveryActionFor(category, "download")).toBe("retry");
      expect(recoveryActionFor(category, "firmware")).toBe("retry");
    }
  });

  it("retries transfer-stage protocol/unknown failures, rescans earlier ones", () => {
    for (const category of ["protocol", "unknown"] as LoggerErrorCategory[]) {
      expect(recoveryActionFor(category, "download")).toBe("retry");
      expect(recoveryActionFor(category, "firmware")).toBe("retry");
      expect(recoveryActionFor(category, "scan")).toBe("rescan");
      expect(recoveryActionFor(category, "connect")).toBe("rescan");
    }
  });
});

describe("loggerErrorKey", () => {
  it("maps every category to a key in the errors subtree", () => {
    const expected: Record<LoggerErrorCategory, string> = {
      unreachable: "errors.unreachable",
      permission: "errors.permission",
      hung: "errors.hung",
      protocol: "errors.protocol",
      unsupported: "errors.unsupported",
      "wifi-declined": "errors.wifiDeclined",
      "not-connected": "errors.notConnected",
      unknown: "errors.unknown",
    };
    for (const [category, key] of Object.entries(expected)) {
      expect(loggerErrorKey(category as LoggerErrorCategory)).toBe(key);
    }
  });
});

describe("isMissingCommandError", () => {
  it("matches Tauri unknown-command rejections in either word order", () => {
    expect(isMissingCommandError("Command logger_update_firmware not found")).toBe(true);
    expect(isMissingCommandError("unknown command: logger_update_firmware")).toBe(true);
    expect(isMissingCommandError(new Error("command logger_update_firmware is unknown"))).toBe(true);
  });

  it("never matches a rejection that carries a backend prefix", () => {
    // A prefixed rejection means the command DID run — the backend answered.
    expect(isMissingCommandError("unsupported: firmware update not available")).toBe(false);
    expect(isMissingCommandError("device unreachable: command timed out")).toBe(false);
    expect(isMissingCommandError("device hung: command aborted")).toBe(false);
  });

  it("ignores unrelated errors", () => {
    expect(isMissingCommandError("kaboom")).toBe(false);
    expect(isMissingCommandError(new Error("network down"))).toBe(false);
  });
});
