// src/lib/geometry/cellToX.ts

export function cellToX(args: {
  absoluteCell: number;
  systemStartCell: number;
  barCells: number;
  barWidthPx: number;
  gapPx: number;
}) {
  const { absoluteCell, systemStartCell, barCells, barWidthPx, gapPx } = args;

  if (barCells <= 0) return 0;

  const local = absoluteCell - systemStartCell;
  const clampedLocal = Math.max(0, local);

  const barIndex = Math.floor(clampedLocal / barCells);
  const withinBar = clampedLocal - barIndex * barCells; // 0..barCells

  const withinPct = withinBar / barCells; // 0..1
  return barIndex * (barWidthPx + gapPx) + withinPct * barWidthPx;
}
