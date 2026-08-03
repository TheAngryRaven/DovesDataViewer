/**
 * Track-file BLE opcodes, by track kind.
 *
 * The logger keeps circuit tracks in `/TRACKS` and sprint tracks in
 * `/TRACKS/SPRINT`, and the folder is chosen by the **opcode** — never parsed
 * from the filename. That is deliberate on the firmware side: its filename
 * validator rejects `/` and `..` so a BLE client stays jailed to the tracks
 * folders, and adding a path-carrying filename would have punched a hole in
 * that. The cost is a parallel set of verbs, which this table owns so no call
 * site hand-builds an opcode string.
 *
 * Only the LIST reply tokens differ between the two. Sprint listings answer
 * `TSFILE:` / `TSEND` so a sprint enumeration can never be mistaken for a
 * circuit one if the two ever interleave; `TSGET:` / `TSPUT:` / `TSDEL:` reuse
 * the circuit replies (`SIZE:`/`DONE`, `TREADY`/`TOK`, `TERR:`) verbatim.
 *
 * Verified against `BirdsEye/bluetooth.ino` (the dispatch at :557-604 and the
 * listing tokens at :325-326), not just the protocol doc.
 */

export type TrackKind = 'circuit' | 'sprint';

export interface TrackOpcodes {
  /** Enumerate the folder. */
  list: string;
  /** Download prefix — a filename is appended. */
  get: string;
  /** Upload prefix — a filename is appended. */
  put: string;
  /** Delete prefix — a filename is appended. */
  del: string;
  /** Prefix of each filename line in a listing reply. */
  filePrefix: string;
  /** Terminator line of a listing reply. */
  endToken: string;
}

const CIRCUIT: TrackOpcodes = {
  list: 'TLIST',
  get: 'TGET:',
  put: 'TPUT:',
  del: 'TDEL:',
  filePrefix: 'TFILE:',
  endToken: 'TEND',
};

const SPRINT: TrackOpcodes = {
  list: 'TSLIST',
  get: 'TSGET:',
  put: 'TSPUT:',
  del: 'TSDEL:',
  filePrefix: 'TSFILE:',
  endToken: 'TSEND',
};

/** The opcode set for a track kind. Defaults to circuit, the pre-sprint behaviour. */
export function trackOpcodes(kind: TrackKind = 'circuit'): TrackOpcodes {
  return kind === 'sprint' ? SPRINT : CIRCUIT;
}
