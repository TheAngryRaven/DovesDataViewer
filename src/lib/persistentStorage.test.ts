import { describe, it, expect, vi } from "vitest";
import { requestPersistentStorage } from "./persistentStorage";

describe("requestPersistentStorage", () => {
  it("reports unsupported when the Storage API is missing", async () => {
    await expect(requestPersistentStorage(undefined)).resolves.toBe(
      "unsupported",
    );
    await expect(requestPersistentStorage({})).resolves.toBe("unsupported");
  });

  it("skips the request when storage is already persistent", async () => {
    const persist = vi.fn();
    const result = await requestPersistentStorage({
      persisted: () => Promise.resolve(true),
      persist,
    });
    expect(result).toBe("already-persisted");
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports a grant", async () => {
    await expect(
      requestPersistentStorage({
        persisted: () => Promise.resolve(false),
        persist: () => Promise.resolve(true),
      }),
    ).resolves.toBe("granted");
  });

  it("reports a denial", async () => {
    await expect(
      requestPersistentStorage({
        persisted: () => Promise.resolve(false),
        persist: () => Promise.resolve(false),
      }),
    ).resolves.toBe("denied");
  });

  it("swallows a throwing implementation", async () => {
    await expect(
      requestPersistentStorage({
        persisted: () => Promise.reject(new Error("nope")),
        persist: () => Promise.resolve(true),
      }),
    ).resolves.toBe("unsupported");
  });
});
