// src/lib/lyrics/chunking.ts

import type { LyricAnchor } from "@/lib/types";
import type { LyricToken } from "./tokens";
import { estWidthOfToken } from "./tokens";
import { LYRIC_METRICS } from "./metrics";
import { layoutOnlyBetweenAnchors } from "./layout";

type Range = { start: number; end: number }; // [start, end)

export function buildAnchorsBySystem(args: {
  anchors: LyricAnchor[];
  systemsTiming: { startCell: number; endCell: number }[];
}) {
  const { anchors, systemsTiming } = args;
  return systemsTiming.map(({ startCell, endCell }) =>
    anchors.filter((a) => a.cell >= startCell && a.cell < endCell)
  );
}

/**
 * CHUNKING:
 * - STRICTLY forward-only (monotonic ranges)
 * - Fill by width
 * - If this system contains anchored tokens (by timing), it may EXTEND the end to include them
 * - NEVER pulls start backward (prevents token “duplication / reordering” across systems)
 */
export function chunkTokensForwardOnly(args: {
  tokens: LyricToken[];
  anchors: LyricAnchor[];
  systems: { startCell: number; endCell: number }[];
  systemWidthPx: number;
  subdivision: number;
}) {
  const { tokens, anchors, systems, systemWidthPx } = args;

  // charIndex -> token index (word only)
  const tokenIndexByCharIndex = new Map<number, number>();
  tokens.forEach((t, idx) => {
    if (t.kind === "word") tokenIndexByCharIndex.set(t.charIndex, idx);
  });

  // For each system, find max anchored token index that falls in that system's timing
  const requiredMaxBySystem = systems.map(() => -1);
  for (let s = 0; s < systems.length; s++) {
    const { startCell, endCell } = systems[s];
    let maxTok = -1;
    for (const a of anchors) {
      if (a.cell >= startCell && a.cell < endCell) {
        const tokIdx = tokenIndexByCharIndex.get(a.charIndex);
        if (tokIdx !== undefined) maxTok = Math.max(maxTok, tokIdx);
      }
    }
    requiredMaxBySystem[s] = maxTok;
  }

  const ranges: Range[] = [];
  let ptr = 0;

  for (let s = 0; s < systems.length; s++) {
    if (ptr >= tokens.length) {
      ranges.push({ start: ptr, end: ptr });
      continue;
    }

    // width fill
    let used = 0;
    let end = ptr;
    while (end < tokens.length) {
      const w = estWidthOfToken(tokens[end]);
      const nextUsed = used + w + (end === ptr ? 0 : LYRIC_METRICS.gapPx);
      if (nextUsed > systemWidthPx && end > ptr) break;
      used = nextUsed;
      end++;
      if (end - ptr >= 260) break;
    }

    // anchors can extend end
    const reqMax = requiredMaxBySystem[s];
    if (reqMax >= ptr) {
      const neededEnd = Math.min(reqMax + 1, tokens.length);
      if (neededEnd > end) end = neededEnd;
    }

    if (end < ptr) end = ptr;

    ranges.push({ start: ptr, end });
    ptr = end;
  }

  return ranges.map((r) => tokens.slice(r.start, r.end));
}

/**
 * Ensure that ANY anchored word token renders in the system that contains its anchor cell.
 *
 * This fixes the "I anchored bled to bar 4 but bled is still on system 1 so it doesn't snap"
 * problem. We move the anchored token (and the tail after it) forward into the owning system.
 *
 * Assumption (reasonable for this editor):
 * anchors tend to be monotonic in lyric order. If you anchor later words to earlier systems
 * (non-monotonic), moving tails could conflict with earlier anchors. We can harden later if needed.
 */
function enforceAnchoredTokenOwnership(args: {
  chunks: LyricToken[][];
  anchorsBySystem: LyricAnchor[][];
}) {
  const { chunks, anchorsBySystem } = args;

  // desired owner: charIndex -> systemIdx
  const desiredOwner = new Map<number, number>();
  for (let s = 0; s < anchorsBySystem.length; s++) {
    for (const a of anchorsBySystem[s]) desiredOwner.set(a.charIndex, s);
  }

  // Find current location of a token by charIndex (word only)
  function findToken(charIndex: number) {
    for (let s = 0; s < chunks.length; s++) {
      const idx = chunks[s].findIndex((t) => t.kind === "word" && t.charIndex === charIndex);
      if (idx !== -1) return { sys: s, idx };
    }
    return null;
  }

  // For each system in order, pull anchored tokens forward into this system if needed
  for (let s = 0; s < chunks.length; s++) {
    const anchorsHere = anchorsBySystem[s] ?? [];
    for (const a of anchorsHere) {
      const loc = findToken(a.charIndex);
      if (!loc) continue;

      const curSys = loc.sys;
      const curIdx = loc.idx;

      if (curSys === s) continue;
      if (curSys > s) continue; // token is already later; leave it

      // move tail from curSys into target system s
      const moved = chunks[curSys].splice(curIdx);
      if (!moved.length) continue;

      chunks[s] = [...moved, ...chunks[s]];
    }
  }

  return chunks;
}

/**
 * Push trailing overflow into next system, but never eject anchored tokens.
 * ALSO: enforce anchored token ownership first, so anchors always affect the visible token.
 */
export function reflowOverflowAcrossSystems(args: {
  initialChunks: LyricToken[][];
  anchorsBySystem: LyricAnchor[][];
  systemsTiming: { startCell: number; endCell: number }[];
  subdivision: number;
  systemWidthPx: number;
}) {
  const { initialChunks, anchorsBySystem, systemsTiming, subdivision, systemWidthPx } = args;

  // Start with editable copies
  let chunks: LyricToken[][] = initialChunks.map((c) => [...c]);

  // 1) Make sure anchored words live in the system their anchor-cell belongs to
  chunks = enforceAnchoredTokenOwnership({ chunks, anchorsBySystem });

  // 2) Now do overflow pushing (visual overflow => push into next system)
  for (let s = 0; s < chunks.length - 1; s++) {
    if (!chunks[s].length) continue;

    const systemBeats = (systemsTiming[s].endCell - systemsTiming[s].startCell) / subdivision;

    const anchoredCharSet = new Set((anchorsBySystem[s] ?? []).map((a) => a.charIndex));
    let requiredMaxLocal = -1;
    for (let i = 0; i < chunks[s].length; i++) {
      const t = chunks[s][i];
      if (t.kind === "word" && anchoredCharSet.has(t.charIndex)) {
        requiredMaxLocal = Math.max(requiredMaxLocal, i);
      }
    }

    for (let guard = 0; guard < 10; guard++) {
      const laidOut = layoutOnlyBetweenAnchors({
        tokens: chunks[s],
        anchors: anchorsBySystem[s] ?? [],
        systemStartCell: systemsTiming[s].startCell,
        systemBeats,
        subdivision,
        systemWidthPx,
      });

      let overflowIdx = -1;
      for (let i = 0; i < laidOut.length; i++) {
        const { token, x } = laidOut[i];
        const right = x + estWidthOfToken(token);
        if (right > systemWidthPx) {
          overflowIdx = i;
          break;
        }
      }

      if (overflowIdx === -1) break;
      if (overflowIdx <= requiredMaxLocal) break;

      const moving = chunks[s].splice(overflowIdx);
      if (!moving.length) break;

      chunks[s + 1] = [...moving, ...chunks[s + 1]];
    }
  }

  return chunks;
}
