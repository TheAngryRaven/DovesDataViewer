import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "@/lib/__test__/idb";
import {
  selectFile,
  unselectFile,
  markPushed,
  getFileRecord,
  fileSyncStatus,
} from "./fileSync";
import { setActiveUserId } from "./activeUser";

// The plugin-KV-backed selection state (selectFile/markPushed/unselectFile) is
// IndexedDB I/O — exercised here against the real fake-indexeddb store. The pure
// helpers (fileSyncStatus, cloudOnlyNames, orphanedObjectNames) are covered in
// fileSync.test.ts.
beforeEach(() => {
  freshIndexedDB();
  setActiveUserId(null);
});

describe("file sync selection state", () => {
  it("is 'off' with no record, 'pending' once selected, 'synced' once pushed", async () => {
    expect(fileSyncStatus(await getFileRecord("run1.dove"))).toBe("off");

    await selectFile("run1.dove");
    expect(fileSyncStatus(await getFileRecord("run1.dove"))).toBe("pending");

    await markPushed("run1.dove");
    expect(fileSyncStatus(await getFileRecord("run1.dove"))).toBe("synced");
  });

  it("unselect clears the record (back to 'off')", async () => {
    await markPushed("run1.dove");
    await unselectFile("run1.dove");
    expect(await getFileRecord("run1.dove")).toBeUndefined();
  });

  it("partitions selections per user", async () => {
    setActiveUserId("user-a");
    await selectFile("run1.dove");

    setActiveUserId("user-b");
    expect(await getFileRecord("run1.dove")).toBeUndefined();

    setActiveUserId("user-a");
    expect(fileSyncStatus(await getFileRecord("run1.dove"))).toBe("pending");
  });
});
