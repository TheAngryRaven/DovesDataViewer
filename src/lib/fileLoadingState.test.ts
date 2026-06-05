import { describe, it, expect, afterEach } from "vitest";
import {
  beginFileLoading,
  updateFileLoading,
  endFileLoading,
  getFileLoading,
  subscribeFileLoading,
} from "./fileLoadingState";

afterEach(() => endFileLoading());

describe("fileLoadingState", () => {
  it("begin/end toggles the current state", () => {
    expect(getFileLoading()).toBeNull();
    beginFileLoading("Loading telemetry…");
    expect(getFileLoading()).toEqual({ message: "Loading telemetry…" });
    endFileLoading();
    expect(getFileLoading()).toBeNull();
  });

  it("update changes the message only while active", () => {
    updateFileLoading("ignored while idle");
    expect(getFileLoading()).toBeNull();

    beginFileLoading("Loading Python runtime…");
    updateFileLoading("Parsing telemetry…");
    expect(getFileLoading()).toEqual({ message: "Parsing telemetry…" });
  });

  it("notifies subscribers and unsubscribes cleanly", () => {
    const seen: (string | null)[] = [];
    const unsub = subscribeFileLoading((s) => seen.push(s ? s.message : null));

    beginFileLoading("a");
    updateFileLoading("b");
    endFileLoading();
    unsub();
    beginFileLoading("c"); // should not be recorded

    expect(seen).toEqual(["a", "b", null]);
  });
});
