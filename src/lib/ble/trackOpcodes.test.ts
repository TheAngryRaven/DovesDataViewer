import { describe, it, expect } from 'vitest';
import { trackOpcodes } from './trackOpcodes';

describe('trackOpcodes', () => {
  it('defaults to circuit — the pre-sprint wire behaviour', () => {
    expect(trackOpcodes()).toEqual(trackOpcodes('circuit'));
  });

  it('emits the circuit verbs unchanged', () => {
    // Pinned: these are the bytes older firmware has always answered to.
    expect(trackOpcodes('circuit')).toEqual({
      list: 'TLIST',
      get: 'TGET:',
      put: 'TPUT:',
      del: 'TDEL:',
      filePrefix: 'TFILE:',
      endToken: 'TEND',
    });
  });

  it('emits the sprint verbs the firmware dispatches on', () => {
    // Verified against BirdsEye/bluetooth.ino:557-604 (dispatch) and :325-326
    // (listing tokens), not just the protocol doc.
    expect(trackOpcodes('sprint')).toEqual({
      list: 'TSLIST',
      get: 'TSGET:',
      put: 'TSPUT:',
      del: 'TSDEL:',
      filePrefix: 'TSFILE:',
      endToken: 'TSEND',
    });
  });

  it('gives sprint listings distinct tokens from circuit', () => {
    // The whole point of TSFILE:/TSEND: a sprint enumeration must never be
    // mistaken for a circuit one if replies ever interleave.
    const c = trackOpcodes('circuit');
    const s = trackOpcodes('sprint');
    expect(s.filePrefix).not.toBe(c.filePrefix);
    expect(s.endToken).not.toBe(c.endToken);
  });

  it('never lets a circuit token prefix-match a sprint listing line', () => {
    // "TSFILE:OKC.json".startsWith("TFILE:") must be false, or a client
    // parsing both streams would silently mis-bucket sprint files.
    const c = trackOpcodes('circuit');
    expect(`${trackOpcodes('sprint').filePrefix}OKC.json`.startsWith(c.filePrefix)).toBe(false);
    expect(trackOpcodes('sprint').endToken.startsWith(c.endToken)).toBe(false);
  });

  it('strips its own prefix cleanly', () => {
    const s = trackOpcodes('sprint');
    const line = `${s.filePrefix}Autocross.json`;
    expect(line.substring(s.filePrefix.length)).toBe('Autocross.json');
  });
});
