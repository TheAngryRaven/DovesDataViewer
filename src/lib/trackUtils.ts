/**
 * Abbreviate a track name for display.
 * 
 * Rules:
 * - If track name contains multiple words (split on whitespace), take the 
 *   FIRST LETTER of each word and uppercase.
 *   "Orlando Kart Center" -> "OKC"
 * - If track name is a single word, take the first 4 characters and uppercase.
 *   "Bushnell" -> "BUSH"
 *   If word length < 4, use the entire word uppercased.
 */
export function abbreviateTrackName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  
  const words = trimmed.split(/\s+/);
  
  if (words.length > 1) {
    // Multiple words: take first letter of each
    return words.map(w => w.charAt(0).toUpperCase()).join('');
  } else {
    // Single word: take first 4 chars (or less if shorter)
    const word = words[0];
    return word.slice(0, 4).toUpperCase();
  }
}
