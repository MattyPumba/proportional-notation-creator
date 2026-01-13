import type { ChordEvent } from "./types";

/**
 * Parses input like:
 *   G:2 A:1 B:1
 * into chord events on a cell timeline.
 *
 * subdivision = cells per beat
 *
 * Special:
 *   X:n (or x:n) = rest for n beats (advances timeline, no chord event)
 */
export function parseChordInput(input: string, subdivision: number): ChordEvent[] {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let cellCursor = 0;
  const events: ChordEvent[] = [];

  for (const token of tokens) {
    const [rawSymbol, beatsStr] = token.split(":");
    if (!rawSymbol || !beatsStr) continue;

    const symbol = rawSymbol.trim();
    const beats = Number(beatsStr);

    if (!Number.isFinite(beats) || beats <= 0) continue;

    const isRest = symbol.toLowerCase() === "x";

    if (!isRest) {
      events.push({
        id: crypto.randomUUID(),
        symbol,
        cell: cellCursor,
      });
    }

    cellCursor += beats * subdivision;
  }

  return events;
}
