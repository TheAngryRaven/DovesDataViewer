import { describe, it, expect } from "vitest";
import { resolveDownloadFlow } from "./downloadFlow";

describe("resolveDownloadFlow", () => {
  it("asks with the picker when nothing is connected", () => {
    expect(resolveDownloadFlow({ isConnected: false, loggerKind: null, native: false })).toBeNull();
    // A stale kind without a connection is still "not connected".
    expect(
      resolveDownloadFlow({ isConnected: false, loggerKind: "fledgling", native: false }),
    ).toBeNull();
  });

  it("asks with the picker when connected to something it can't name", () => {
    expect(resolveDownloadFlow({ isConnected: true, loggerKind: null, native: true })).toBeNull();
  });

  // The whole point: the picker's only question is "which logger?", and a live
  // connection has answered it.
  it("goes straight to the Fledgling flow on either transport", () => {
    expect(resolveDownloadFlow({ isConnected: true, loggerKind: "fledgling", native: false })).toBe(
      "fledgling",
    );
    expect(resolveDownloadFlow({ isConnected: true, loggerKind: "fledgling", native: true })).toBe(
      "fledgling",
    );
  });

  it("routes a connected MyChron or Alfano straight in on the native shell", () => {
    expect(resolveDownloadFlow({ isConnected: true, loggerKind: "mychron", native: true })).toBe(
      "mychron",
    );
    expect(resolveDownloadFlow({ isConnected: true, loggerKind: "alfano", native: true })).toBe(
      "alfano",
    );
  });

  // On the web those cards open an explanatory dialog rather than a download —
  // skipping the picker would skip the only answer the web has.
  it("keeps the picker for a MyChron or Alfano on the web", () => {
    expect(
      resolveDownloadFlow({ isConnected: true, loggerKind: "mychron", native: false }),
    ).toBeNull();
    expect(
      resolveDownloadFlow({ isConnected: true, loggerKind: "alfano", native: false }),
    ).toBeNull();
  });
});
