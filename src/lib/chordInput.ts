import type { ChordEvent } from "./types";

/**
 * Parses input like:
 *   G:2 A:1 B:1
 * into chord events on a cell timeline.
 *
 * subdivision = cells per beat
 */
export function parseChordInput(
  input: string,
  subdivision: number
): ChordEvent[] {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let cellCursor = 0;
  const events: ChordEvent[] = [];

  for (const token of tokens) {
    const [symbol, beatsStr] = token.split(":");
    if (!symbol || !beatsStr) continue;

    const beats = Number(beatsStr);
    if (!Number.isFinite(beats) || beats <= 0) continue;

    events.push({
      id: crypto.randomUUID(),
      symbol,
      cell: cellCursor,
    });

    cellCursor += beats * subdivision;
  }

  return events;
}
