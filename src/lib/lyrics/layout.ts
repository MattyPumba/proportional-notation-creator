// src/lib/lyrics/layout.ts
import type { LyricAnchor } from "@/lib/types";
import type { LyricToken } from "@/lib/lyrics/tokens";

/**
 * Editor layout: returns pixel x positions for tokens in a system.
 *
 * RULE:
 * - Anchored tokens: x determined ONLY by their anchor cell.
 * - Unanchored tokens: evenly spaced BETWEEN the surrounding anchored tokens,
 *   including the span from system start -> first anchor, and last anchor -> system end.
 *
 * This is intentionally "musical" spacing (even in time), not "text packing".
 * Print mode can inherit this as implicit anchors.
 */
export function layoutOnlyBetweenAnchors(args: {
  tokens: LyricToken[];
  anchors: LyricAnchor[];
  systemStartCell: number;
  systemBeats: number;
  subdivision: number;
  systemWidthPx: number;
}) {
  const { tokens, anchors, systemStartCell, systemBeats, subdivision, systemWidthPx } = args;

  if (!tokens.length) return [];

  // Map charIndex -> anchor cell (ABS)
  const anchorCellByChar = new Map<number, number>();
  for (const a of anchors) anchorCellByChar.set(a.charIndex, a.cell);

  // Helper: anchor cell -> x in px
  function cellToX(cellAbs: number) {
    const beatsFromStart = (cellAbs - systemStartCell) / subdivision;
    const t = systemBeats <= 0 ? 0 : beatsFromStart / systemBeats;
    return t * systemWidthPx;
  }

  // Identify which token indices are anchored (word tokens only)
  const anchoredIdx: number[] = [];
  const tokenAnchorX = new Map<number, number>();

  tokens.forEach((t, idx) => {
    if (t.kind !== "word") return;
    const cell = anchorCellByChar.get(t.charIndex);
    if (cell === undefined) return;
    const x = cellToX(cell);
    anchoredIdx.push(idx);
    tokenAnchorX.set(idx, x);
  });

  anchoredIdx.sort((a, b) => a - b);

  // Output x positions (px)
  const xs = new Array(tokens.length).fill(0);

  // Place anchored tokens
  for (const i of anchoredIdx) xs[i] = tokenAnchorX.get(i)!;

  // Helper: evenly distribute indices (exclusive ends) across an x-span
  function distributeEvenly(startX: number, endX: number, indices: number[]) {
    const n = indices.length;
    if (n === 0) return;
    if (n === 1) {
      xs[indices[0]] = (startX + endX) / 2;
      return;
    }
    for (let k = 0; k < n; k++) {
      const t = (k + 1) / (n + 1); // exclude endpoints
      xs[indices[k]] = startX + t * (endX - startX);
    }
  }

  // Span 1: start -> first anchor
  if (anchoredIdx.length > 0) {
    const firstA = anchoredIdx[0];
    const before = [];
    for (let i = 0; i < firstA; i++) before.push(i);
    distributeEvenly(0, xs[firstA], before);
  } else {
    // No anchors at all: evenly spread all tokens across system
    const all = tokens.map((_, i) => i);
    // place first at 0, last at systemWidth; internal evenly spaced
    if (all.length === 1) {
      xs[0] = systemWidthPx * 0.2;
    } else {
      for (let i = 0; i < all.length; i++) {
        xs[i] = (i / (all.length - 1)) * systemWidthPx;
      }
    }
    return tokens.map((token, i) => ({ token, x: xs[i] }));
  }

  // Spans between anchors
  for (let a = 0; a < anchoredIdx.length - 1; a++) {
    const leftA = anchoredIdx[a];
    const rightA = anchoredIdx[a + 1];

    const indices: number[] = [];
    for (let i = leftA + 1; i < rightA; i++) indices.push(i);

    distributeEvenly(xs[leftA], xs[rightA], indices);
  }

  // Span last: last anchor -> end
  if (anchoredIdx.length > 0) {
    const lastA = anchoredIdx[anchoredIdx.length - 1];
    const after: number[] = [];
    for (let i = lastA + 1; i < tokens.length; i++) after.push(i);
    distributeEvenly(xs[lastA], systemWidthPx, after);
  }

  return tokens.map((token, i) => ({ token, x: xs[i] }));
}
