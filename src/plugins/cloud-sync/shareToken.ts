// Share-link tokens (plan 0009): the token IS the secret — an unguessable id
// that doubles as the public URL path and the blob object name. 128 bits of
// crypto randomness, base64url so it's URL-safe with no encoding. Content
// hashing (fnv1a) is NOT suitable here: tokens must be unpredictable.

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Pure base64url encoder (no padding). Exported for deterministic tests. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += BASE64URL[b0 >> 2];
    out += BASE64URL[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += BASE64URL[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += BASE64URL[b2 & 0x3f];
  }
  return out;
}

/** A fresh 128-bit share token (22 base64url chars). */
export function generateShareToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}
