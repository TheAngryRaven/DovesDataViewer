// Tombstones for setup revisions this device pruned (orphan GC).
//
// Setup revisions sync as ordinary garage docs and a local delete would normally
// propagate to the cloud. The orphan prune must NOT remove the cloud copy (another
// device may still reference it via a session that hasn't synced here yet). So a
// pruned revision is tombstoned instead: autoSync skips deleting it from the cloud,
// and the doc-store accessor skips re-pulling it locally. A fresh freeze of the
// same content clears the tombstone (the revision is wanted again).

import { getPluginStore } from "@/plugins/storage";
import { userScope } from "./activeUser";

const store = getPluginStore("cloud-sync");
// Per-user so one account's prune never suppresses another's revisions.
const key = () => `setup-revision-tombstones:${userScope()}`;

async function read(): Promise<string[]> {
  return (await store.get<string[]>(key())) ?? [];
}

export async function addSetupRevisionTombstone(id: string): Promise<void> {
  const list = await read();
  if (!list.includes(id)) {
    list.push(id);
    await store.set(key(), list);
  }
}

export async function clearSetupRevisionTombstone(id: string): Promise<void> {
  const list = await read();
  if (list.includes(id)) await store.set(key(), list.filter((x) => x !== id));
}

export async function setupRevisionTombstoneSet(): Promise<Set<string>> {
  return new Set(await read());
}

export function isSetupRevisionTombstoned(id: string): Promise<boolean> {
  return read().then((list) => list.includes(id));
}
