/**
 * FNV-1a 32-bit string hash → 8-char hex. Deterministic and dependency-free;
 * used for content-addressed dedupe (track submissions, leaderboard entries).
 * Not cryptographic — collision resistance is "good enough for change detection".
 */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
