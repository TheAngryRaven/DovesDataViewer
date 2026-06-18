/**
 * The setup-status nag shown in the main tab bar when the loaded session has no
 * setup assigned. Pure so it can be unit-tested independently of the view.
 *
 * - `red` (urgent): no setup exists to even assign yet. Point the driver at the
 *   missing foundational piece — vehicles first, then setups (garage tabs).
 * - `orange` (reminder): setups exist but this session isn't linked to one.
 *   Send them to the Notes view, where the session-setup selector lives.
 */
export interface SetupIndicator {
  tone: "red" | "orange";
  /** "vehicles"/"setups" open the garage drawer; "notes" switches to the Notes view. */
  target: "vehicles" | "setups" | "notes";
}

export function getSetupIndicator(args: {
  sessionSetupId: string | null;
  setupCount: number;
  vehicleCount: number;
}): SetupIndicator | null {
  if (args.sessionSetupId) return null;
  if (args.setupCount === 0) {
    return { tone: "red", target: args.vehicleCount === 0 ? "vehicles" : "setups" };
  }
  return { tone: "orange", target: "notes" };
}
