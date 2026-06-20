import { describe, it, expect } from "vitest";
import { classifyEntry } from "./accountImport";

describe("classifyEntry", () => {
  it("maps a document-store JSON path to its store", () => {
    expect(classifyEntry("local/stores/karts.json")).toEqual({ kind: "store", store: "karts" });
    // Store names can contain hyphens (e.g. graph-prefs, setup-revisions).
    expect(classifyEntry("local/stores/setup-revisions.json")).toEqual({
      kind: "store",
      store: "setup-revisions",
    });
  });

  it("maps local and cloud file blobs to a file name", () => {
    expect(classifyEntry("local/files/session.dovex")).toEqual({ kind: "file", name: "session.dovex" });
    expect(classifyEntry("cloud/files/2026-01-01 lap.dove")).toEqual({
      kind: "file",
      name: "2026-01-01 lap.dove",
    });
  });

  it("ignores account JSON, the README, and directory entries", () => {
    expect(classifyEntry("cloud/account.json")).toBeNull();
    expect(classifyEntry("local/settings.json")).toBeNull();
    expect(classifyEntry("README.txt")).toBeNull();
    expect(classifyEntry("local/files/")).toBeNull();
  });
});
