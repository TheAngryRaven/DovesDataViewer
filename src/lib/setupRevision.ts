// Immutable, content-addressed setup revisions — historical setup storage.
//
// A `VehicleSetup` in the `setups` store is the *live, editable* config (the
// working copy). The moment a setup is assigned to a session we freeze its
// current state into an immutable `SetupRevision` whose id IS a hash of its
// content (git's blob model, minus the diff chains). The session then stores
// that revision hash, so editing the live setup later never rewrites history.
//
// Because the id is derived from content:
//   • two sessions on the genuinely-identical setup land on the SAME hash
//     (automatic dedup — no duplicate rows);
//   • changing one value — or the template structure (a renamed/added field) —
//     yields a DIFFERENT hash, i.e. a new revision, with no child-type bookkeeping.
//
// The revision is self-contained: it embeds a frozen copy of the template
// structure alongside the values, so an old revision always renders with the
// field labels it had that day, regardless of later template edits.
//
// This module is pure (no IndexedDB / no React) so the hashing + freeze logic
// stays unit-testable. IndexedDB I/O lives in `setupRevisionStorage.ts`.

import type { VehicleSetup } from "./setupStorage";
import type { SetupTemplate } from "./templateStorage";

/** How many leading hex chars of the content hash we surface in the UI (git-style). */
export const SHORT_HASH_LENGTH = 6;

/** How long a revision no session references is kept (3 days) — plan 0028. */
export const REVISION_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Which revisions the sweep may delete (plan 0028). A revision survives when any
 * of these hold:
 *   • a session references it (`referenced` = every `FileMetadata.sessionSetupRev`);
 *   • it was saved less than `retentionMs` ago (`updatedAt` = last save of this
 *     content) — a hectic track weekend stays scrubbable for three days even
 *     when nobody tagged the sessions;
 *   • it is the newest unreferenced revision of a setup that still exists
 *     (`liveSetupIds`), so a setup never loses its latest untagged state.
 * Everything else — including every unreferenced revision of a deleted setup
 * once it ages out — is returned for deletion.
 */
export function findPrunableRevisionIds(
  revisions: Pick<SetupRevision, "id" | "setupId" | "updatedAt">[],
  referenced: Iterable<string>,
  liveSetupIds: Iterable<string>,
  now: number,
  retentionMs: number = REVISION_RETENTION_MS,
): string[] {
  const keep = new Set(referenced);
  const live = new Set(liveSetupIds);
  const unreferenced = revisions.filter((r) => !keep.has(r.id));

  const newestUnreferenced = new Map<string, { id: string; updatedAt: number }>();
  for (const r of unreferenced) {
    if (!live.has(r.setupId)) continue;
    const current = newestUnreferenced.get(r.setupId);
    if (!current || r.updatedAt > current.updatedAt) newestUnreferenced.set(r.setupId, r);
  }

  return unreferenced
    .filter((r) => now - r.updatedAt >= retentionMs && newestUnreferenced.get(r.setupId)?.id !== r.id)
    .map((r) => r.id);
}

/** The short, human-facing id for a revision hash (first 6 hex chars). */
export function shortRevHash(hash: string): string {
  return hash.slice(0, SHORT_HASH_LENGTH);
}

/** Frozen template structure travelling with a revision so it renders standalone. */
export interface FrozenTemplateField {
  id: string;
  name: string;
  type: "number" | "string";
  unit?: string;
}
export interface FrozenTemplateSection {
  id: string;
  name: string;
  fields: FrozenTemplateField[];
}
export interface FrozenTemplate {
  id: string;
  name: string;
  wheelCount: 2 | 4;
  includeTires: boolean;
  sections: FrozenTemplateSection[];
}

export interface SetupRevision {
  /** Content hash (full SHA-256 hex) — the immutable id and cloud record key. */
  id: string;
  /** Lineage: the live setup this revision was frozen from. */
  setupId: string;
  vehicleId: string;
  /** Setup name at capture time (part of the hashed content). */
  name: string;
  /** Frozen copy of the setup's content at capture time. */
  setup: VehicleSetup;
  /** Frozen template structure, so the revision renders without external lookups. */
  template: FrozenTemplate | null;
  /** First time this exact content was seen (epoch ms); stable across re-freezes. */
  createdAt: number;
  /**
   * Last time this exact content was saved (ms) — bumped when a re-freeze dedups
   * onto it. Drives the retention sweep and the sync merge.
   */
  updatedAt: number;
}

/** Strip a template down to just the structure that defines the setup's shape. */
export function freezeTemplate(template: SetupTemplate | null | undefined): FrozenTemplate | null {
  if (!template) return null;
  return {
    id: template.id,
    name: template.name,
    wheelCount: template.wheelCount,
    includeTires: template.includeTires,
    sections: template.sections.map((s) => ({
      id: s.id,
      name: s.name,
      fields: s.fields.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        // Only the unit affects rendering identity; min/max/step are input hints.
        ...(f.unit !== undefined ? { unit: f.unit } : {}),
      })),
    })),
  };
}

/**
 * The meaningful content of a setup for hashing — its values plus the frozen
 * template shape. Deliberately excludes volatile bookkeeping (id, createdAt,
 * updatedAt) so re-freezing an unchanged setup is a no-op (same hash).
 */
function canonicalContent(setup: VehicleSetup, template: SetupTemplate | null | undefined) {
  return {
    vehicleId: setup.vehicleId,
    templateId: setup.templateId,
    name: setup.name,
    unitSystem: setup.unitSystem,
    tireBrand: setup.tireBrand,
    psiMode: setup.psiMode,
    psiFrontLeft: setup.psiFrontLeft,
    psiFrontRight: setup.psiFrontRight,
    psiRearLeft: setup.psiRearLeft,
    psiRearRight: setup.psiRearRight,
    tireWidthMode: setup.tireWidthMode,
    tireWidthFrontLeft: setup.tireWidthFrontLeft,
    tireWidthFrontRight: setup.tireWidthFrontRight,
    tireWidthRearLeft: setup.tireWidthRearLeft,
    tireWidthRearRight: setup.tireWidthRearRight,
    tireDiameterMode: setup.tireDiameterMode,
    tireDiameterFrontLeft: setup.tireDiameterFrontLeft,
    tireDiameterFrontRight: setup.tireDiameterFrontRight,
    tireDiameterRearLeft: setup.tireDiameterRearLeft,
    tireDiameterRearRight: setup.tireDiameterRearRight,
    customFields: setup.customFields,
    template: freezeTemplate(template),
  };
}

/** Deterministic JSON: object keys sorted recursively so order can't change the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** SHA-256 of a string as lowercase hex, via the Web Crypto API (browser + Node 20+). */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The content hash a setup would freeze to right now (full SHA-256 hex). */
export function computeSetupHash(
  setup: VehicleSetup,
  template: SetupTemplate | null | undefined,
): Promise<string> {
  return sha256Hex(stableStringify(canonicalContent(setup, template)));
}

export interface BuildSetupRevisionInput {
  setup: VehicleSetup;
  template: SetupTemplate | null | undefined;
  /** Capture time; defaults to now. Pass an existing revision's createdAt to preserve it. */
  now?: number;
}

/** Freeze a live setup into an immutable, content-addressed revision. */
export async function buildSetupRevision(input: BuildSetupRevisionInput): Promise<SetupRevision> {
  const { setup, template } = input;
  const now = input.now ?? Date.now();
  const id = await computeSetupHash(setup, template);
  return {
    id,
    setupId: setup.id,
    vehicleId: setup.vehicleId,
    name: setup.name,
    setup: { ...setup },
    template: freezeTemplate(template),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Roll a live setup back to a frozen revision (plan 0028). Restores every
 * captured value — template, units, tires, custom fields — onto the live
 * record while keeping its identity (id, vehicle, name, createdAt). The name
 * stays because a later rename is not a setup change; if it differs from the
 * revision's, the next freeze lands on a new hash rather than the old one.
 */
export function restoreSetupFromRevision(live: VehicleSetup, revision: SetupRevision): VehicleSetup {
  return {
    ...revision.setup,
    id: live.id,
    vehicleId: live.vehicleId,
    name: live.name,
    createdAt: live.createdAt,
    updatedAt: live.updatedAt,
  };
}

/**
 * A brand-new setup carrying a copy of a frozen revision's values (plan 0028):
 * the caller assigns the id/timestamps via the ordinary add path, so the copy
 * starts its own history with this content as its original.
 */
export function duplicateSetupFromRevision(
  revision: SetupRevision,
  name: string,
): Omit<VehicleSetup, "id" | "createdAt" | "updatedAt"> {
  const { id: _id, createdAt: _c, updatedAt: _u, ...values } = revision.setup;
  return { ...values, vehicleId: revision.vehicleId, name };
}
