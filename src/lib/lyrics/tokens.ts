// src/lib/lyrics/tokens.ts

import { LYRIC_METRICS } from "./metrics";

export type LyricToken =
  | { kind: "word"; text: string; charIndex: number }
  | { kind: "hyphen"; text: "-"; charIndex: number };

export function estWidthOfToken(t: LyricToken) {
  if (t.kind === "hyphen") return LYRIC_METRICS.hyphenPx;
  return t.text.length * LYRIC_METRICS.charPx + LYRIC_METRICS.padPx;
}

/**
 * Tokenize ALL lyrics as one continuous stream.
 * - Newlines become whitespace (continuous)
 * - Words split by whitespace
 * - Hyphenated words split into word/hyphen/word tokens with accurate indices
 */
export function tokenizeAllLyrics(lyrics: string): LyricToken[] {
  const tokens: LyricToken[] = [];
  let i = 0;

  while (i < lyrics.length) {
    while (i < lyrics.length && /\s/.test(lyrics[i])) i++;
    if (i >= lyrics.length) break;

    const wordStart = i;
    while (i < lyrics.length && !/\s/.test(lyrics[i])) i++;
    const word = lyrics.slice(wordStart, i);
    const absStart = wordStart;

    if (!word.includes("-")) {
      tokens.push({ kind: "word", text: word, charIndex: absStart });
      continue;
    }

    let local = 0;
    while (local < word.length) {
      const dash = word.indexOf("-", local);
      if (dash === -1) {
        const part = word.slice(local);
        if (part.length) {
          tokens.push({ kind: "word", text: part, charIndex: absStart + local });
        }
        break;
      }

      const left = word.slice(local, dash);
      if (left.length) {
        tokens.push({ kind: "word", text: left, charIndex: absStart + local });
      }

      tokens.push({ kind: "hyphen", text: "-", charIndex: absStart + dash });

      local = dash + 1;
      if (local >= word.length) break;
    }
  }

  return tokens;
}
