// Tombstones for snapshots the user explicitly removed from the cloud.
//
// Snapshots always push on local save and a local delete never removes the cloud
// copy (see snapshotSync). The one case that needs memory: when the user deletes
// a snapshot from the *cloud* (in the profile page) but keeps it locally, the
// reconcile pass would otherwise re-push and resurrect it. A tombstone records
// "don't auto-push this id" until the user saves it again (which clears it).

import { getPluginStore } from "@/plugins/storage";

const store = getPluginStore("cloud-sync");
const KEY = "snapshot-tombstones";

async function read(): Promise<string[]> {
  return (await store.get<string[]>(KEY)) ?? [];
}

export async function addSnapshotTombstone(id: string): Promise<void> {
  const list = await read();
  if (!list.includes(id)) {
    list.push(id);
    await store.set(KEY, list);
  }
}

export async function clearSnapshotTombstone(id: string): Promise<void> {
  const list = await read();
  if (list.includes(id)) await store.set(KEY, list.filter((x) => x !== id));
}

export async function snapshotTombstoneSet(): Promise<Set<string>> {
  return new Set(await read());
}
