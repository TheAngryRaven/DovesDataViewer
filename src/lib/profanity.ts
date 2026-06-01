// A deliberately BASIC client-side profanity filter for user-chosen display
// names. It's a courtesy gate, not a security boundary — names are public, so we
// keep the obvious stuff out without pretending to catch every creative spelling.
// Pure + dependency-free so it's unit-testable and safe to call anywhere.

// Common slurs / vulgarities, lowercased roots. Substring-matched after leet
// normalization, so "a55hole" / "f_u_c_k" still trip. Kept short on purpose.
const BANNED_ROOTS = [
  "anal", "anus", "arse", "ass", "asshole", "bastard", "bitch", "blowjob",
  "boner", "boob", "bollock", "bukkake", "cock", "coon", "cum", "cunt", "dick",
  "dildo", "dyke", "fag", "faggot", "fuck", "goatse", "handjob", "jizz", "kike",
  "nigger", "nigga", "nazi", "paki", "penis", "piss", "porn", "prick", "pussy",
  "rape", "rapist", "retard", "semen", "shit", "slut", "spic", "tits", "twat",
  "vagina", "wank", "whore",
];

// Map common leet substitutions back to letters so "sh1t" reads as "shit".
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s", "!": "i", "|": "i",
};

/**
 * Collapse a name to a comparable form: lowercase, leet→letters, and strip every
 * non-letter so spaces/underscores/punctuation can't be used to smuggle a word in.
 */
export function normalizeForProfanity(input: string): string {
  return input
    .toLowerCase()
    .replace(/[0134578@$!|]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, "");
}

/** Whether a display name contains an obviously profane word. */
export function containsProfanity(name: string): boolean {
  const normalized = normalizeForProfanity(name);
  if (!normalized) return false;
  return BANNED_ROOTS.some((word) => normalized.includes(word));
}
