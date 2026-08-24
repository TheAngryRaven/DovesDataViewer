/**
 * The `SIZE` rejection is the one OTA failure users can't reason about on
 * their own: the cap lives in the firmware ALREADY INSTALLED on the device,
 * not in the image or in this app. These tests pin the explanation that says
 * so — and, just as importantly, pin that it stays quiet for everything else.
 */

import { describe, it, expect } from "vitest";
import { FirmwareProtocolError } from "../firmwareUpload";
import {
  OTA_LAYOUT_MIN_VERSION,
  OTA_LEGACY_MAX_BYTES,
  exceedsLegacyOtaCap,
  explainFirmwareFailure,
  needsOtaLayoutUpgrade,
} from "./firmwareUpdateError";

const sizeError = () => new FirmwareProtocolError("Firmware handshake failed", "SIZE");

describe("needsOtaLayoutUpgrade", () => {
  it.each(["3.0.0", "3.0.1", "2.2.3", "1.0.0"])(
    "is true for %s — older than the larger staging layout",
    (version) => {
      expect(needsOtaLayoutUpgrade(version)).toBe(true);
    },
  );

  it.each([OTA_LAYOUT_MIN_VERSION, "3.1.1", "3.2.0", "4.0.0"])(
    "is false for %s — already carries the layout",
    (version) => {
      expect(needsOtaLayoutUpgrade(version)).toBe(false);
    },
  );

  it("never claims an unknown version is out of date", () => {
    expect(needsOtaLayoutUpgrade(null)).toBe(false);
    expect(needsOtaLayoutUpgrade(undefined)).toBe(false);
    expect(needsOtaLayoutUpgrade("")).toBe(false);
  });

  // This is a CAPABILITY gate, so it must stay on `compareVersions` (numeric
  // core only) and never move to `compareReleases`. A beta cut from the release
  // that introduced the larger staging region already has that region — telling
  // its owner to install the release first would be a hop to nowhere.
  it("reads a beta of the capable release as already capable", () => {
    expect(needsOtaLayoutUpgrade(`${OTA_LAYOUT_MIN_VERSION}-beta.abc1234`)).toBe(false);
    expect(needsOtaLayoutUpgrade("3.2.0-beta.abc1234")).toBe(false);
  });

  it("still flags a beta of a pre-layout release", () => {
    expect(needsOtaLayoutUpgrade("3.0.0-beta.abc1234")).toBe(true);
  });
});

describe("exceedsLegacyOtaCap", () => {
  it("is true only past the legacy cap", () => {
    expect(exceedsLegacyOtaCap(OTA_LEGACY_MAX_BYTES + 1)).toBe(true);
    expect(exceedsLegacyOtaCap(340_868)).toBe(true); // the build that prompted this
    expect(exceedsLegacyOtaCap(OTA_LEGACY_MAX_BYTES)).toBe(false);
    expect(exceedsLegacyOtaCap(324_000)).toBe(false);
  });

  it("is false when the size is unknown", () => {
    expect(exceedsLegacyOtaCap(null)).toBe(false);
    expect(exceedsLegacyOtaCap(undefined)).toBe(false);
  });
});

describe("explainFirmwareFailure", () => {
  it("names the device's version and the release that unlocks it", () => {
    const explained = explainFirmwareFailure(sizeError(), {
      installedVersion: "3.0.1",
      imageBytes: 340_868,
    })!;

    expect(explained.needsLayoutUpgrade).toBe(true);
    expect(explained.message).toContain("v3.0.1");
    expect(explained.message).toContain(`v${OTA_LAYOUT_MIN_VERSION}`);
    expect(explained.message).toContain("333 KiB"); // the image, so it's comparable to the cap
  });

  it("still points at the fix when the version could not be read", () => {
    const explained = explainFirmwareFailure(sizeError(), {
      installedVersion: null,
      imageBytes: 340_868,
    })!;

    expect(explained.needsLayoutUpgrade).toBe(true);
    expect(explained.message).toContain(`v${OTA_LAYOUT_MIN_VERSION}`);
    expect(explained.message).toContain("320 KiB"); // the cap it's up against
    // Must not invent a version it never read.
    expect(explained.message).not.toContain("null");
    expect(explained.message).not.toContain("undefined");
  });

  it("does NOT send a new-enough device down the staged-upgrade path", () => {
    // Reports the layout already and still refused — telling this user to
    // install 3.1.0 would be a wild goose chase.
    const explained = explainFirmwareFailure(sizeError(), {
      installedVersion: "3.2.0",
      imageBytes: 500_000,
    })!;

    expect(explained.needsLayoutUpgrade).toBe(false);
    expect(explained.message).toContain("USB");
  });

  it("omits the size when it isn't known", () => {
    const explained = explainFirmwareFailure(sizeError(), { installedVersion: "3.0.1" })!;
    expect(explained.message).toContain("v3.0.1");
    expect(explained.message).not.toContain("NaN");
    expect(explained.message).not.toContain("KiB)");
  });

  it("stays out of the way for every other protocol token", () => {
    for (const reason of ["CRC", "WRITE", "BATTERY", "VARIANT", "STATE", "FLASH"]) {
      const err = new FirmwareProtocolError("Firmware upload failed", reason);
      expect(explainFirmwareFailure(err, { installedVersion: "3.0.1" })).toBeNull();
    }
  });

  it("stays out of the way for non-protocol errors", () => {
    expect(explainFirmwareFailure(new Error("Timed out"), { installedVersion: "3.0.1" })).toBeNull();
    expect(explainFirmwareFailure("SIZE", { installedVersion: "3.0.1" })).toBeNull();
    expect(explainFirmwareFailure(null)).toBeNull();
  });
});

describe("FirmwareProtocolError", () => {
  it("keeps the raw token alongside a readable message", () => {
    const err = new FirmwareProtocolError("Firmware handshake failed", "SIZE");
    expect(err.reason).toBe("SIZE");
    expect(err.message).toBe("Firmware handshake failed: SIZE");
    expect(err).toBeInstanceOf(Error);
  });
});
