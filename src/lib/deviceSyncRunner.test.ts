import { describe, it, expect, vi } from "vitest";
import { runSyncOperations, type SyncExecutors } from "./deviceSyncRunner";
import type { SyncOperation } from "./deviceSyncOps";

function executors(overrides: Partial<SyncExecutors> = {}): SyncExecutors {
  return {
    devicePut: vi.fn(async () => {}),
    deviceDelete: vi.fn(async () => {}),
    appPut: vi.fn(async () => {}),
    appDelete: vi.fn(async () => {}),
    ...overrides,
  };
}

/** One track's worth of ops: write, delete the old file, store locally. */
function trackOps(key: string): SyncOperation[] {
  return [
    { type: "device_put", trackKey: key, folder: "circuit", fileName: "NEW.json", json: "{}" },
    { type: "device_delete", trackKey: key, folder: "circuit", fileName: "OLD.json" },
    { type: "app_put", trackKey: key, track: { name: "New", shortName: "NEW", courses: [] } },
  ];
}

describe("runSyncOperations", () => {
  it("runs every operation in the order given", async () => {
    const order: string[] = [];
    const exec = executors({
      devicePut: vi.fn(async () => void order.push("put")),
      deviceDelete: vi.fn(async () => void order.push("delete")),
      appPut: vi.fn(async () => void order.push("app")),
    });
    const result = await runSyncOperations(trackOps("t1"), exec);
    expect(order).toEqual(["put", "delete", "app"]);
    expect(result.succeeded).toEqual(["t1"]);
    expect(result.failures).toEqual([]);
  });

  it("encodes the JSON for the device write", async () => {
    const exec = executors();
    await runSyncOperations(
      [{ type: "device_put", trackKey: "t1", folder: "sprint", fileName: "A.json", json: '{"a":1}' }],
      exec,
    );
    const [folder, fileName, data] = (exec.devicePut as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(folder).toBe("sprint");
    expect(fileName).toBe("A.json");
    expect(new TextDecoder().decode(data as Uint8Array)).toBe('{"a":1}');
  });

  it("reports progress over the whole list", async () => {
    const seen: number[] = [];
    await runSyncOperations(trackOps("t1"), executors(), (p) => {
      seen.push(p.done);
      expect(p.total).toBe(3);
    });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe("runSyncOperations failure handling", () => {
  // Once the new file didn't write, deleting the old one destroys the only
  // copy — which for a course walked in the field is unrecoverable.
  it("abandons a track's remaining operations after one of its own fails", async () => {
    const exec = executors({
      devicePut: vi.fn(async () => {
        throw new Error("TERR:WRITE_FAIL");
      }),
    });
    const result = await runSyncOperations(trackOps("t1"), exec);

    expect(exec.deviceDelete).not.toHaveBeenCalled();
    expect(exec.appPut).not.toHaveBeenCalled();
    expect(result.failed).toEqual(["t1"]);
    expect(result.succeeded).toEqual([]);
    expect(result.failures[0].message).toBe("TERR:WRITE_FAIL");
  });

  // One track failing is no reason to leave the other nine untouched.
  it("keeps going with other tracks", async () => {
    let calls = 0;
    const exec = executors({
      devicePut: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
      }),
    });
    const result = await runSyncOperations([...trackOps("t1"), ...trackOps("t2")], exec);

    expect(result.failed).toEqual(["t1"]);
    expect(result.succeeded).toEqual(["t2"]);
    expect(exec.appPut).toHaveBeenCalledTimes(1);
  });

  it("still reports progress for the operations it skips", async () => {
    const exec = executors({
      devicePut: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const seen: number[] = [];
    await runSyncOperations(trackOps("t1"), exec, (p) => seen.push(p.done));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("records a non-Error throw without crashing", async () => {
    const exec = executors({
      appPut: vi.fn(async () => {
        throw "just a string";
      }),
    });
    const result = await runSyncOperations(trackOps("t1"), exec);
    expect(result.failures[0].message).toBe("just a string");
  });

  it("names the operation that failed, so the UI can say which step", async () => {
    const exec = executors({
      deviceDelete: vi.fn(async () => {
        throw new Error("TERR:NO_FILE");
      }),
    });
    const result = await runSyncOperations(trackOps("t1"), exec);
    expect(result.failures[0].operation.type).toBe("device_delete");
    // The write had already succeeded, so the track is on the card twice —
    // recoverable, and exactly why put comes before delete.
    expect(exec.devicePut).toHaveBeenCalled();
  });

  it("does nothing gracefully for an empty plan", async () => {
    const result = await runSyncOperations([], executors());
    expect(result).toEqual({ succeeded: [], failed: [], failures: [] });
  });
});
