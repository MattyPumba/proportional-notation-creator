// src/components/LeadSheetGrid.tsx
import React, { useMemo } from "react";
import type { ChordEvent, LyricAnchor, TimeSignature } from "@/lib/types";

import { tokenizeAllLyrics } from "@/lib/lyrics/tokens";
import { layoutOnlyBetweenAnchors } from "@/lib/lyrics/layout";
import {
  buildAnchorsBySystem,
  chunkTokensForwardOnly,
  reflowOverflowAcrossSystems,
} from "@/lib/lyrics/chunking";

import { SystemView } from "@/components/SystemView";

type Segment = {
  symbol: string;
  startCellInBar: number;
  beats: number;
};

type BarModel = {
  barIndex: number;
  segments: Segment[];
};

export function LeadSheetGrid(props: {
  mode?: "editor" | "print";

  chords: ChordEvent[];
  timeSignature: TimeSignature;
  subdivision: number;

  lyrics: string;
  anchors: LyricAnchor[];

  selectedCharIndex: number | null;
  onSelectCharIndex: (charIndex: number) => void;
  onBeatClick: (absoluteCell: number) => void;

  barsPerSystem?: number;
}) {
  const {
    mode = "editor",
    chords,
    timeSignature,
    subdivision,
    lyrics,
    anchors,
    selectedCharIndex,
    onSelectCharIndex,
    onBeatClick,
    barsPerSystem = 3,
  } = props;

  const isPrint = mode === "print";

  const beatsPerBar = timeSignature.beatsPerBar;
  const barCells = beatsPerBar * subdivision;

  // Print: make timing track continuous (NO gaps)
  const barWidthPx = isPrint ? 250 : 520;
  const gapPx = isPrint ? 0 : 16;

  const bars: BarModel[] = useMemo(() => {
    if (barCells <= 0) return [];

    const sorted = [...chords]
      .filter((c) => Number.isFinite(c.cell) && c.cell >= 0)
      .sort((a, b) => a.cell - b.cell);

    const lastCell = sorted.length ? sorted[sorted.length - 1].cell : 0;
    const totalBars = Math.max(1, Math.floor(lastCell / barCells) + 1);

    const out: BarModel[] = [];

    for (let barIndex = 0; barIndex < totalBars; barIndex++) {
      const barStart = barIndex * barCells;
      const barEnd = barStart + barCells;

      const inBar = sorted.filter((c) => c.cell >= barStart && c.cell < barEnd);

      const segments: Segment[] = inBar.map((c, i) => {
        const start = c.cell;
        const nextStart = i + 1 < inBar.length ? inBar[i + 1].cell : barEnd;
        const durCells = Math.max(0, Math.min(nextStart, barEnd) - start);
        const beats = durCells / subdivision;
        return { symbol: c.symbol, startCellInBar: start - barStart, beats };
      });

      out.push({ barIndex, segments });
    }

    return out;
  }, [chords, barCells, subdivision]);

  const systems = useMemo(() => {
    const out: BarModel[][] = [];
    for (let i = 0; i < bars.length; i += barsPerSystem) {
      out.push(bars.slice(i, i + barsPerSystem));
    }
    return out;
  }, [bars, barsPerSystem]);

  const systemWidthPx = useMemo(() => {
    return barsPerSystem * barWidthPx + (barsPerSystem - 1) * gapPx;
  }, [barsPerSystem, barWidthPx, gapPx]);

  const systemsTiming = useMemo(() => {
    return systems.map((systemBars) => {
      const firstBarIndex = systemBars[0]?.barIndex ?? 0;
      const startCell = firstBarIndex * barCells;
      const endCell = startCell + systemBars.length * barCells;
      return { startCell, endCell };
    });
  }, [systems, barCells]);

  const lyricTokens = useMemo(() => tokenizeAllLyrics(lyrics), [lyrics]);

  const anchorsBySystem = useMemo(() => {
    return buildAnchorsBySystem({ anchors, systemsTiming });
  }, [anchors, systemsTiming]);

  const initialTokenChunks = useMemo(() => {
    return chunkTokensForwardOnly({
      tokens: lyricTokens,
      anchors,
      systems: systemsTiming,
      systemWidthPx,
      subdivision,
    });
  }, [lyricTokens, anchors, systemsTiming, systemWidthPx, subdivision]);

  const tokenChunks = useMemo(() => {
    return reflowOverflowAcrossSystems({
      initialChunks: initialTokenChunks,
      anchorsBySystem,
      systemsTiming,
      subdivision,
      systemWidthPx,
    });
  }, [initialTokenChunks, anchorsBySystem, systemsTiming, subdivision, systemWidthPx]);

  const systemLayouts = useMemo(() => {
    return systems.map((_, sysIdx) => {
      const tokens = tokenChunks[sysIdx] ?? [];
      const systemStartCell = systemsTiming[sysIdx]?.startCell ?? 0;
      const systemBeats =
        (systemsTiming[sysIdx].endCell - systemsTiming[sysIdx].startCell) / subdivision;

      const laidOut = layoutOnlyBetweenAnchors({
        tokens,
        anchors: anchorsBySystem[sysIdx] ?? [],
        systemStartCell,
        systemBeats,
        subdivision,
        systemWidthPx,
      });

      return { tokens, laidOut };
    });
  }, [systems, tokenChunks, systemsTiming, anchorsBySystem, subdivision, systemWidthPx]);

  return (
    <div style={{ display: "grid", gap: isPrint ? 16 : 18 }}>
      {systems.map((systemBars, sysIdx) => {
        const tokens = systemLayouts[sysIdx]?.tokens ?? [];
        const laidOut = systemLayouts[sysIdx]?.laidOut ?? [];

        return (
          <SystemView
            key={sysIdx}
            mode={mode}
            systemIndex={sysIdx}
            systemBars={systemBars}
            timeSignature={timeSignature}
            subdivision={subdivision}
            barCells={barCells}
            beatsPerBar={beatsPerBar}
            systemWidthPx={systemWidthPx}
            barWidthPx={barWidthPx}
            gapPx={gapPx}
            onBeatClick={mode === "editor" ? onBeatClick : undefined}
            lyrics={lyrics}
            tokens={tokens}
            laidOut={laidOut}
            anchors={anchors}
            selectedCharIndex={mode === "editor" ? selectedCharIndex : null}
            onSelectCharIndex={mode === "editor" ? onSelectCharIndex : undefined}
          />
        );
      })}
    </div>
  );
}
