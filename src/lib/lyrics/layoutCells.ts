// src/lib/lyrics/layoutCells.ts
import type { LyricAnchor } from "@/lib/types";
import type { LyricToken } from "@/lib/lyrics/tokens";
import { LYRIC_METRICS } from "@/lib/lyrics/metrics";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Best-practice print layout (CELL SPACE):
 * - Anchors are hard constraints (token start cell locked).
 * - Unanchored tokens are packed naturally between anchors.
 * - If a run doesn't fit, spacing is compressed just enough to fit (no spreading).
 * - No pixel-based assumptions; renderer maps cell->x.
 *
 * Returns: [{ token, cell }] where cell is an ABSOLUTE CELL index.
 */
export function layoutOnlyBetweenAnchorsInCells(args: {
  tokens: LyricToken[];
  anchors: LyricAnchor[];
  systemStartCell: number;
  systemCells: number; // total cells in this system window (barsInSystem * barCells)
  pxPerCell: number; // barWidthPx / barCells
}) {
  const { tokens, anchors, systemStartCell, systemCells, pxPerCell } = args;

  function widthPx(t: LyricToken) {
    if (t.kind === "hyphen") return LYRIC_METRICS.hyphenPx;
    return t.text.length * LYRIC_METRICS.charPx + LYRIC_METRICS.padPx;
  }

  // Add a small safety factor so we err on the side of "wider" (prevents merges like cursetree)
  const SAFETY = 1.12;

  function widthCells(t: LyricToken) {
    if (pxPerCell <= 0) return 0;
    return (widthPx(t) * SAFETY) / pxPerCell;
  }

  const baseGapCells = pxPerCell > 0 ? (LYRIC_METRICS.gapPx * SAFETY) / pxPerCell : 0;

  // Map charIndex -> token index (word tokens only)
  const tokenIndexByCharIndex = new Map<number, number>();
  tokens.forEach((t, idx) => {
    if (t.kind === "word") tokenIndexByCharIndex.set(t.charIndex, idx);
  });

  // Anchors that match tokens in this chunk, in LOCAL cell coords
  const anchorPoints: { i: number; c: number }[] = [];
  for (const a of anchors) {
    const i = tokenIndexByCharIndex.get(a.charIndex);
    if (i === undefined) continue;
    const local = a.cell - systemStartCell;
    anchorPoints.push({ i, c: clamp(local, 0, systemCells) });
  }
  anchorPoints.sort((a, b) => (a.i - b.i) || (a.c - b.c));

  const posLocal: number[] = new Array(tokens.length).fill(0);
  const anchored = new Set<number>(anchorPoints.map((p) => p.i));

  // Place anchors
  for (const ap of anchorPoints) posLocal[ap.i] = ap.c;

  // Helper: pack a run into [leftBound, rightBound] (rightBound is token-start fence for next anchor)
  function packRun(startIdx: number, endIdx: number, leftBound: number, rightBound: number) {
    if (startIdx > endIdx) return;

    // total token widths
    let sumW = 0;
    for (let i = startIdx; i <= endIdx; i++) sumW += widthCells(tokens[i]);

    const count = endIdx - startIdx + 1;
    const gaps = Math.max(0, count - 1);
    const available = rightBound - leftBound;

    // If no room at all, just stack at leftBound (wrap feature handles this later)
    if (available <= 0) {
      for (let i = startIdx; i <= endIdx; i++) posLocal[i] = leftBound;
      return;
    }

    // Choose a gap that fits (never larger than baseGapCells; can compress down to 0)
    let gap = baseGapCells;
    if (gaps > 0) {
      const maxGapThatFits = (available - sumW) / gaps;
      gap = clamp(gap, 0, maxGapThatFits);
    }

    // Pack left with computed gap
    let cursor = leftBound;
    for (let i = startIdx; i <= endIdx; i++) {
      posLocal[i] = cursor;
      cursor += widthCells(tokens[i]) + gap;
    }

    // If it still overruns due to rounding, shift the run left (but not past leftBound)
    const rightMost = posLocal[endIdx] + widthCells(tokens[endIdx]);
    if (rightMost > rightBound) {
      const shift = rightMost - rightBound;
      for (let i = startIdx; i <= endIdx; i++) posLocal[i] = Math.max(leftBound, posLocal[i] - shift);
    }

    // Final non-overlap enforcement (forward)
    for (let i = startIdx + 1; i <= endIdx; i++) {
      const minC = posLocal[i - 1] + widthCells(tokens[i - 1]) + 0; // already included gap above
      if (posLocal[i] < minC) posLocal[i] = minC;
    }
  }

  // If no anchors, just pack from 0 to end within system
  if (anchorPoints.length === 0) {
    packRun(0, tokens.length - 1, 0, systemCells);
    return tokens.map((t, i) => ({ token: t, cell: systemStartCell + posLocal[i] }));
  }

  // Segment A: before first anchor (pack ending at first anchor fence)
  const first = anchorPoints[0];
  if (first.i > 0) {
    // rightBound is the anchored token start cell
    packRun(0, first.i - 1, 0, first.c);
  }

  // Segments between anchors
  for (let k = 0; k < anchorPoints.length - 1; k++) {
    const a = anchorPoints[k];
    const b = anchorPoints[k + 1];

    const startIdx = a.i + 1;
    const endIdx = b.i - 1;
    if (startIdx > endIdx) continue;

    // leftBound is after the anchored token a
    const leftBound = a.c + widthCells(tokens[a.i]) + baseGapCells;
    // rightBound is the start cell of anchored token b
    const rightBound = b.c;

    packRun(startIdx, endIdx, leftBound, rightBound);
  }

  // Segment Z: after last anchor
  const last = anchorPoints[anchorPoints.length - 1];
  if (last.i < tokens.length - 1) {
    const startIdx = last.i + 1;
    const endIdx = tokens.length - 1;
    const leftBound = last.c + widthCells(tokens[last.i]) + baseGapCells;
    packRun(startIdx, endIdx, leftBound, systemCells);
  }

  // Soft clamp for unanchored tokens into [0..systemCells]
  for (let i = 0; i < tokens.length; i++) {
    if (anchored.has(i)) continue;
    posLocal[i] = clamp(posLocal[i], 0, systemCells);
  }

  return tokens.map((t, i) => ({
    token: t,
    cell: systemStartCell + posLocal[i],
  }));
}
