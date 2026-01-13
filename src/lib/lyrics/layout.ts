// src/lib/lyrics/layout.ts
import type { LyricAnchor } from "@/lib/types";
import type { LyricToken } from "@/lib/lyrics/tokens";
import { LYRIC_METRICS } from "@/lib/lyrics/metrics";

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < 1e-9;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function layoutOnlyBetweenAnchors(args: {
  tokens: LyricToken[];
  anchors: LyricAnchor[];
  systemStartCell: number;
  systemBeats: number;
  subdivision: number;
  systemWidthPx: number;
}) {
  const { tokens, anchors, systemStartCell, systemBeats, subdivision, systemWidthPx } = args;

  function widthOf(t: LyricToken) {
    if (t.kind === "hyphen") return LYRIC_METRICS.hyphenPx;
    return t.text.length * LYRIC_METRICS.charPx + LYRIC_METRICS.padPx;
  }

  // Default linear positions
  const xPos: number[] = [];
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    xPos[i] = cursor;
    cursor += widthOf(tokens[i]) + LYRIC_METRICS.gapPx;
  }

  // Map charIndex -> token index (WORD tokens only)
  const tokenIndexByCharIndex = new Map<number, number>();
  tokens.forEach((t, idx) => {
    if (t.kind === "word") tokenIndexByCharIndex.set(t.charIndex, idx);
  });

  // Anchor points local to this system
  const anchorPoints: { i: number; x: number }[] = [];
  for (const a of anchors) {
    const localIndex = tokenIndexByCharIndex.get(a.charIndex);
    if (localIndex === undefined) continue;

    const beat = (a.cell - systemStartCell) / subdivision;
    const beatClamped = clamp(beat, 0, systemBeats);
    const x = (beatClamped / systemBeats) * systemWidthPx;

    anchorPoints.push({ i: localIndex, x });
  }

  anchorPoints.sort((a, b) => (a.i - b.i) || (a.x - b.x));

  const anchoredIndex = new Set<number>(anchorPoints.map((p) => p.i));

  if (anchorPoints.length >= 1) {
    // Snap anchored tokens to their x (hard constraint)
    for (const ap of anchorPoints) xPos[ap.i] = ap.x;

    // Even-spread ONLY between consecutive anchors
    for (let k = 0; k < anchorPoints.length - 1; k++) {
      const a = anchorPoints[k];
      const b = anchorPoints[k + 1];
      const count = b.i - a.i;
      if (count <= 0) continue;

      for (let i = a.i + 1; i < b.i; i++) {
        const t = (i - a.i) / count;
        xPos[i] = a.x + t * (b.x - a.x);
      }
    }

    // HARD-CONSTRAINT collision handling:
    // - Never move anchored tokens
    // - If a non-anchored token would overlap an anchored token, push the non-anchored token left (backward)
    // - Otherwise do a forward non-overlap pass that skips anchored positions
    for (let i = 1; i < tokens.length; i++) {
      const minX = xPos[i - 1] + widthOf(tokens[i - 1]) + LYRIC_METRICS.gapPx;

      if (anchoredIndex.has(i)) {
        // anchored token: keep it fixed; if previous overlaps, pull previous left (backward ripple)
        if (minX > xPos[i]) {
          let j = i - 1;
          while (j >= 0) {
            const maxRight = xPos[j] + widthOf(tokens[j]);
            const allowedRight = xPos[j + 1] - LYRIC_METRICS.gapPx;
            const newX = allowedRight - widthOf(tokens[j]);

            if (maxRight + LYRIC_METRICS.gapPx <= xPos[j + 1] || nearlyEqual(xPos[j], newX)) {
              break;
            }

            xPos[j] = Math.min(xPos[j], newX);
            j--;
            if (j >= 0 && anchoredIndex.has(j)) break; // never move anchors
          }
        }
        continue;
      }

      // non-anchored token: regular forward non-overlap
      if (xPos[i] < minX) xPos[i] = minX;
    }
  }

  // Clamp into view by shifting whole line (does NOT alter relative anchor positions)
  const minLeft = Math.min(...xPos);
  const maxRight = Math.max(...xPos.map((x, i) => x + widthOf(tokens[i])));

  let shift = 0;
  if (minLeft < 0) shift = -minLeft;
  if (maxRight + shift > systemWidthPx) {
    const overflow = maxRight + shift - systemWidthPx;
    shift = Math.max(0, shift - overflow);
  }

  return tokens.map((t, i) => ({ token: t, x: xPos[i] + shift }));
}
