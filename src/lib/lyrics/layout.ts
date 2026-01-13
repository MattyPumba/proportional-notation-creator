// src/lib/lyrics/layout.ts

import type { LyricAnchor } from "@/lib/types";
import { LYRIC_METRICS } from "./metrics";
import type { LyricToken } from "./tokens";
import { estWidthOfToken } from "./tokens";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Even-spread ONLY between anchors.
 * - Outside anchor spans: normal linear flow
 *
 * RULE:
 * If there are anchors in this system, DO NOT apply a global shift that would move anchored tokens.
 * We allow overflow to be handled by pushing tokens to next system.
 *
 * Hyphen centering: hyphen token is centered between adjacent word tokens.
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

  // default linear
  const xPos: number[] = [];
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    xPos[i] = cursor;
    cursor += estWidthOfToken(tokens[i]) + LYRIC_METRICS.gapPx;
  }

  // anchor points
  const anchorPoints: { i: number; x: number }[] = [];
  for (const a of anchors) {
    const localIndex = tokens.findIndex((t) => t.kind === "word" && t.charIndex === a.charIndex);
    if (localIndex === -1) continue;

    const beat = (a.cell - systemStartCell) / subdivision;
    const beatClamped = clamp(beat, 0, systemBeats);
    const x = (beatClamped / systemBeats) * systemWidthPx;

    anchorPoints.push({ i: localIndex, x });
  }
  anchorPoints.sort((a, b) => (a.i - b.i) || (a.x - b.x));

  if (anchorPoints.length >= 1) {
    // snap anchored
    for (const ap of anchorPoints) xPos[ap.i] = ap.x;

    // even-spread between anchors
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

    // non-overlap forward pass
    for (let i = 1; i < tokens.length; i++) {
      const minX = xPos[i - 1] + estWidthOfToken(tokens[i - 1]) + LYRIC_METRICS.gapPx;
      if (xPos[i] < minX) xPos[i] = minX;
    }

    // hyphen centering pass
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].kind !== "hyphen") continue;
      const prev = i - 1;
      const next = i + 1;
      if (prev < 0 || next >= tokens.length) continue;
      if (tokens[prev].kind !== "word" || tokens[next].kind !== "word") continue;

      const prevRight = xPos[prev] + estWidthOfToken(tokens[prev]);
      const nextLeft = xPos[next];
      const mid = (prevRight + nextLeft) / 2;
      xPos[i] = mid - estWidthOfToken(tokens[i]) / 2;
    }

    // DO NOT shift when anchored
    return tokens.map((t, i) => ({ token: t, x: xPos[i] }));
  }

  // unanchored: shift to fit if possible
  if (!tokens.length) return [];

  const minLeft = Math.min(...xPos);
  const maxRight = Math.max(...xPos.map((x, i) => x + estWidthOfToken(tokens[i])));
  const contentWidth = maxRight - minLeft;

  let shift = -minLeft;
  if (contentWidth > systemWidthPx) {
    // can't fit; just normalize left
    shift = -minLeft;
  } else {
    // fits: ensure right edge also fits
    const maxShift = systemWidthPx - maxRight;
    if (shift > maxShift) shift = maxShift;
  }

  const shifted = xPos.map((x) => x + shift);

  // hyphen centering in unanchored mode
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== "hyphen") continue;
    const prev = i - 1;
    const next = i + 1;
    if (prev < 0 || next >= tokens.length) continue;
    if (tokens[prev].kind !== "word" || tokens[next].kind !== "word") continue;

    const prevRight = shifted[prev] + estWidthOfToken(tokens[prev]);
    const nextLeft = shifted[next];
    const mid = (prevRight + nextLeft) / 2;
    shifted[i] = mid - estWidthOfToken(tokens[i]) / 2;
  }

  return tokens.map((t, i) => ({ token: t, x: shifted[i] }));
}
