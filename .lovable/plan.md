

## Add Filtered/Rejected Packet Diagnostics

### Problem
The Dove parser silently skips "bad" rows via `continue` statements. The user has no way to know how many rows were rejected or why. The existing dropped-packet indicator only shows timing gaps, not parser rejections.

### Approach
1. **Track rejection reasons in the parser** — Add counters for each filter category (NaN, zero-coord, out-of-range, speed-cap, teleportation, short-row). Return these counts alongside `ParsedData`.

2. **Extend `ParsedData` type** — Add an optional `parserStats` field:
   ```typescript
   parserStats?: {
     totalRows: number;
     acceptedRows: number;
     rejected: {
       nanFields: number;
       zeroCoords: number;
       outOfRange: number;
       speedCap: number;
       teleportation: number;
       incompleteRow: number;
     };
   }
   ```

3. **Update all parsers** — Start with Dove/Dovex (primary concern), add same pattern to other parsers later.

4. **Display in RaceLineView** — Extend the existing dropped-packet overlay to also show rejected packets when `parserStats` is present. Something like:
   ```
   12 pkts dropped (2.5% loss @ 25Hz)
   3 rows rejected (2 teleport, 1 NaN)
   ```

### Files to change
- `src/types/racing.ts` — Add `ParserStats` interface to `ParsedData`
- `src/lib/doveParser.ts` — Count rejections in `parseDoveFile`, attach to result
- `src/lib/dovexParser.ts` — Pass through stats from inner Dove parse
- `src/components/RaceLineView.tsx` — Display rejection stats in the diagnostic overlay
- `src/pages/Index.tsx` — Thread `parserStats` through to `RaceLineView` (likely already available via `parsedData`)

### Scope
Only Dove/Dovex parsers for now. Other parsers can be extended with the same pattern incrementally.

