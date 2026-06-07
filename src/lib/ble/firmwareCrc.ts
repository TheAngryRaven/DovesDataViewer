/**
 * CRC-32 (IEEE 802.3 / zlib) — used by the SD-staged firmware-update handshake.
 *
 * Both the web app and the logger firmware must agree byte-for-byte on this
 * checksum, so it's a plain, table-based CRC-32 (reflected poly 0xEDB88320,
 * init/xor 0xFFFFFFFF) — the same variant `zlib`/`crc32` and most embedded
 * implementations use. Unit-tested against the canonical check vectors.
 *
 * See `docs/plans/firmware-sdcard-ota.md`.
 */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32/IEEE of the given bytes, as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** CRC-32/IEEE as a lowercase, zero-padded 8-char hex string (wire format). */
export function crc32Hex(bytes: Uint8Array): string {
  return crc32(bytes).toString(16).padStart(8, "0");
}
