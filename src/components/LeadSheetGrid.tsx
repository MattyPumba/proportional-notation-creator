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
import { PrintSystemView } from "@/components/PrintSystemView";

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

  // Editor geometry (source-of-truth for deriving implicit token positions)
  const editorBarWidthPx = 520;
  const editorGapPx = 16;

  // Print geometry (render-only)
  const printBarWidthPx = 250;
  const printGapPx = 10;

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

  // NOTE: chunking is based on a system width.
  // For print, we want the SAME chunking decisions as editor so we don't move tokens to different systems.
  const editorSystemWidthPx = useMemo(() => {
    return barsPerSystem * editorBarWidthPx + (barsPerSystem - 1) * editorGapPx;
  }, [barsPerSystem]);

  const initialTokenChunks = useMemo(() => {
    return chunkTokensForwardOnly({
      tokens: lyricTokens,
      anchors,
      systems: systemsTiming,
      systemWidthPx: editorSystemWidthPx,
      subdivision,
    });
  }, [lyricTokens, anchors, systemsTiming, editorSystemWidthPx, subdivision]);

  const tokenChunks = useMemo(() => {
    return reflowOverflowAcrossSystems({
      initialChunks: initialTokenChunks,
      anchorsBySystem,
      systemsTiming,
      subdivision,
      systemWidthPx: editorSystemWidthPx,
    });
  }, [initialTokenChunks, anchorsBySystem, systemsTiming, subdivision, editorSystemWidthPx]);

  // Compute editor laidOutPx ALWAYS (even for print) so print can inherit it.
  const editorLayouts = useMemo(() => {
    return systems.map((systemBars, sysIdx) => {
      const tokens = tokenChunks[sysIdx] ?? [];
      const systemStartCell = systemsTiming[sysIdx]?.startCell ?? 0;

      const systemBeats = (systemBars.length * barCells) / subdivision;

      const laidOutPx = layoutOnlyBetweenAnchors({
        tokens,
        anchors: anchorsBySystem[sysIdx] ?? [],
        systemStartCell,
        systemBeats,
        subdivision,
        systemWidthPx: editorSystemWidthPx,
      });

      return { tokens, laidOutPx, systemStartCell, systemBars };
    });
  }, [systems, tokenChunks, systemsTiming, anchorsBySystem, subdivision, editorSystemWidthPx, barCells]);

  // Convert editor px positions -> implicit cell positions for print
  const printLayouts = useMemo(() => {
    const pxPerCell = barCells > 0 ? editorBarWidthPx / barCells : 1;

    return editorLayouts.map((l) => {
      const laidOutCells = l.laidOutPx.map(({ token, x }: any) => ({
        token,
        cell: l.systemStartCell + x / pxPerCell,
      }));
      return { ...l, laidOutCells };
    });
  }, [editorLayouts, barCells]);

  return (
    <div style={{ display: "grid", gap: isPrint ? 18 : 18 }}>
      {systems.map((systemBars, sysIdx) => {
        const lEdit = editorLayouts[sysIdx];
        const lPrint = printLayouts[sysIdx];

        if (isPrint) {
          return (
            <PrintSystemView
              key={sysIdx}
              systemIndex={sysIdx}
              systemBars={systemBars}
              timeSignature={timeSignature}
              subdivision={subdivision}
              barCells={barCells}
              beatsPerBar={beatsPerBar}
              systemStartCell={lPrint.systemStartCell}
              barWidthPx={printBarWidthPx}
              gapPx={printGapPx}
              lyrics={lyrics}
              tokens={lPrint.tokens}
              laidOutCells={lPrint.laidOutCells}
              anchors={anchors}
            />
          );
        }

        // editor mode: keep existing SystemView path
        const systemWidthPx =
          barsPerSystem * editorBarWidthPx + (barsPerSystem - 1) * editorGapPx;

        return (
          <SystemView
            key={sysIdx}
            mode="editor"
            systemIndex={sysIdx}
            systemBars={systemBars}
            timeSignature={timeSignature}
            subdivision={subdivision}
            barCells={barCells}
            beatsPerBar={beatsPerBar}
            systemWidthPx={systemWidthPx}
            barWidthPx={editorBarWidthPx}
            gapPx={editorGapPx}
            onBeatClick={onBeatClick}
            lyrics={lyrics}
            tokens={lEdit.tokens}
            laidOut={lEdit.laidOutPx}
            anchors={anchors}
            selectedCharIndex={selectedCharIndex}
            onSelectCharIndex={onSelectCharIndex}
          />
        );
      })}
    </div>
  );
}
