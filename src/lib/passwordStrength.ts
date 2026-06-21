// Offline-first password-strength evaluation for account sign-up. Pure and
// dependency-free (no zxcvbn — it would balloon the bundle and break the
// offline-first rule), so it runs client-side for the realtime visual checker
// and doubles as the gate before we hand the password to Supabase auth.

/** Minimum length we accept for a new password. */
export const MIN_PASSWORD_LENGTH = 8;

/** A length at which we stop rewarding extra characters in the score. */
const STRONG_LENGTH = 12;

/** Identifier for each rule the UI renders as a realtime checklist item. */
export type PasswordRuleId =
  | "length"
  | "lowercase"
  | "uppercase"
  | "number"
  | "symbol";

/** Coarse strength bucket used to colour/label the meter. */
export type PasswordStrengthLevel = "weak" | "fair" | "good" | "strong";

export interface PasswordRuleResult {
  id: PasswordRuleId;
  passed: boolean;
}

export interface PasswordStrength {
  /** Per-rule pass/fail, in a stable display order. */
  rules: PasswordRuleResult[];
  /** Normalised 0–4 score for the strength meter. */
  score: number;
  /** Bucketed label derived from the score. */
  level: PasswordStrengthLevel;
  /** True only when every rule passes — the sign-up gate. */
  meetsRequirements: boolean;
}

const RULE_TESTS: { id: PasswordRuleId; test: (pw: string) => boolean }[] = [
  { id: "length", test: (pw) => pw.length >= MIN_PASSWORD_LENGTH },
  { id: "lowercase", test: (pw) => /[a-z]/.test(pw) },
  { id: "uppercase", test: (pw) => /[A-Z]/.test(pw) },
  { id: "number", test: (pw) => /[0-9]/.test(pw) },
  // Anything that isn't a letter, digit, or whitespace counts as a symbol.
  { id: "symbol", test: (pw) => /[^A-Za-z0-9\s]/.test(pw) },
];

/** The rule ids in display order — handy for rendering before any input. */
export const PASSWORD_RULE_IDS: PasswordRuleId[] = RULE_TESTS.map((r) => r.id);

function levelForScore(score: number): PasswordStrengthLevel {
  if (score <= 1) return "weak";
  if (score === 2) return "fair";
  if (score === 3) return "good";
  return "strong";
}

/**
 * Evaluate a password against the sign-up rules and produce a 0–4 strength
 * score. The score blends how many character-class rules pass with a small
 * length bonus, so "aaaaaaaa" (long but trivial) never reads as strong while a
 * varied 12+ character password tops out.
 */
export function evaluatePassword(password: string): PasswordStrength {
  const rules: PasswordRuleResult[] = RULE_TESTS.map(({ id, test }) => ({
    id,
    passed: test(password),
  }));

  const meetsRequirements = rules.every((r) => r.passed);

  if (password.length === 0) {
    return { rules, score: 0, level: "weak", meetsRequirements };
  }

  // Character-class variety (excluding the pure length rule) is the backbone of
  // the score; length only nudges it up so it can't carry a weak password.
  const classRules = rules.filter((r) => r.id !== "length");
  const classesPassed = classRules.filter((r) => r.passed).length;

  let score = classesPassed; // 0–4
  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (password.length >= STRONG_LENGTH) score += 1;
  // A password that fails the basic length rule can never read above "fair".
  if (password.length < MIN_PASSWORD_LENGTH) score = Math.min(score, 2);

  score = Math.max(0, Math.min(4, score));

  return { rules, score, level: levelForScore(score), meetsRequirements };
}
