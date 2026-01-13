// src/components/LeadSheetGrid.tsx

import React, { useMemo } from "react";
import type { ChordEvent, LyricAnchor, TimeSignature } from "@/lib/types";

import { LYRIC_METRICS } from "@/lib/lyrics/metrics";
import { tokenizeAllLyrics, estWidthOfToken, type LyricToken } from "@/lib/lyrics/tokens";
import { layoutOnlyBetweenAnchors } from "@/lib/lyrics/layout";
import {
  buildAnchorsBySystem,
  chunkTokensForwardOnly,
  reflowOverflowAcrossSystems,
} from "@/lib/lyrics/chunking";

type Segment = {
  symbol: string;
  startCellInBar: number;
  beats: number;
};

type BarModel = {
  barIndex: number;
  segments: Segment[];
};

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < 1e-9;
}

export function LeadSheetGrid(props: {
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

  const beatsPerBar = timeSignature.beatsPerBar;
  const barCells = beatsPerBar * subdivision;

  // INCLUDE EMPTY BARS (so X:4 shows blank bars)
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
    const barWidth = 520;
    const gap = 16;
    return barsPerSystem * barWidth + (barsPerSystem - 1) * gap;
  }, [barsPerSystem]);

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
    <div style={{ display: "grid", gap: 18 }}>
      {systems.map((systemBars, sysIdx) => {
        const tokens = systemLayouts[sysIdx]?.tokens ?? [];
        const laidOut = systemLayouts[sysIdx]?.laidOut ?? [];

        return (
          <div key={sysIdx} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "nowrap", alignItems: "flex-start" }}>
              {systemBars.map(({ barIndex, segments }) => {
                const hasAnyChords = segments.length > 0;

                const singleFullBar =
                  hasAnyChords && segments.length === 1 && nearlyEqual(segments[0].beats, beatsPerBar);

                const beatsList = segments.map((s) => s.beats);
                const evenlyDivided =
                  hasAnyChords &&
                  beatsList.length > 1 &&
                  beatsList.every((b) => nearlyEqual(b, beatsList[0]));

                const showTicks = hasAnyChords && !singleFullBar && !evenlyDivided;
                const showUnderline = hasAnyChords && segments.length > 1;

                const barStartAbs = barIndex * barCells;

                return (
                  <div key={barIndex} style={{ display: "grid", gap: 6 }}>
                    <div style={{ opacity: 0.7, fontSize: 12 }}>
                      Bar {barIndex + 1} ({beatsPerBar}/{timeSignature.beatUnit})
                    </div>

                    <div
                      style={{
                        position: "relative",
                        width: 520,
                        height: 90,
                        borderRadius: 10,
                        background: "#0f0f0f",
                        padding: 12,
                        overflow: "hidden",
                      }}
                    >
                      <div style={{ position: "absolute", inset: 12, pointerEvents: "none", zIndex: 1 }}>
                        {Array.from({ length: barCells }).map((_, cellIdx) => {
                          if (cellIdx === 0) return null;
                          const isBeatLine = cellIdx % subdivision === 0;
                          return (
                            <div
                              key={cellIdx}
                              style={{
                                position: "absolute",
                                top: 0,
                                bottom: 0,
                                left: `${(cellIdx / barCells) * 100}%`,
                                width: 1,
                                background: isBeatLine ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.12)",
                              }}
                            />
                          );
                        })}

                        {subdivision > 1 ? (
                          <div
                            style={{
                              position: "absolute",
                              left: 0,
                              right: 0,
                              top: -10,
                              display: "grid",
                              gridTemplateColumns: `repeat(${barCells}, 1fr)`,
                              fontSize: 11,
                              opacity: 0.55,
                              color: "rgba(255,255,255,0.9)",
                            }}
                          >
                            {Array.from({ length: barCells }).map((_, cellIdx) => {
                              const beatNumber = Math.floor(cellIdx / subdivision) + 1;
                              const sub = cellIdx % subdivision;
                              const text = sub === 0 ? String(beatNumber) : "&";
                              return (
                                <div key={cellIdx} style={{ textAlign: "center", transform: "translateY(-2px)" }}>
                                  {text}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>

                      {/* Click targets */}
                      <div style={{ position: "absolute", inset: 12, zIndex: 5 }}>
                        {Array.from({ length: barCells }).map((_, cellIdx) => {
                          const leftPct = (cellIdx / barCells) * 100;
                          const widthPct = (1 / barCells) * 100;

                          const beatNumber = Math.floor(cellIdx / subdivision) + 1;
                          const sub = cellIdx % subdivision;
                          const label = subdivision === 1 ? `${beatNumber}` : sub === 0 ? `${beatNumber}` : "&";

                          return (
                            <button
                              key={cellIdx}
                              type="button"
                              title={`Beat ${label}`}
                              onClick={() => onBeatClick(barStartAbs + cellIdx)}
                              style={{
                                position: "absolute",
                                top: 0,
                                bottom: 0,
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                              }}
                            />
                          );
                        })}
                      </div>

                      {showUnderline ? (
                        <div
                          style={{
                            position: "absolute",
                            left: 12,
                            right: 12,
                            top: 60,
                            height: 6,
                            background: "#eaeaea",
                            borderRadius: 999,
                            zIndex: 2,
                          }}
                        />
                      ) : null}

                      {segments.map((seg, idx) => {
                        const leftPct = (seg.startCellInBar / barCells) * 100;
                        const tickCount = Math.max(1, Math.round(seg.beats));

                        return (
                          <div
                            key={`${seg.symbol}-${idx}-${seg.startCellInBar}`}
                            style={{
                              position: "absolute",
                              left: `calc(${leftPct}% + 12px)`,
                              top: 10,
                              transform: "translateX(-2px)",
                              color: "#ffffff",
                              fontFamily: "system-ui",
                              zIndex: 3,
                            }}
                          >
                            {showTicks ? (
                              <div
                                style={{
                                  fontFamily: "monospace",
                                  fontSize: 18,
                                  lineHeight: "18px",
                                  marginBottom: 6,
                                  opacity: 0.95,
                                }}
                              >
                                {">".repeat(tickCount)}
                              </div>
                            ) : (
                              <div style={{ height: 24 }} />
                            )}

                            <div style={{ fontSize: 26, lineHeight: "28px" }}>{seg.symbol}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Lyrics */}
            <div
              style={{
                width: systemWidthPx,
                maxWidth: "100%",
                padding: 10,
                borderRadius: 10,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 6 }}>
                Lyrics (continuous) — click a word then click {subdivision > 1 ? "1 & 2 & 3 & 4 &" : "a beat"}
              </div>

              {!lyrics.trim() ? (
                <div style={{ opacity: 0.75, fontSize: 13 }}>(no lyrics)</div>
              ) : tokens.length === 0 ? (
                <div style={{ opacity: 0.75, fontSize: 13 }}>(no lyrics for this system)</div>
              ) : (
                <div
                  style={{
                    position: "relative",
                    height: 44,
                    overflow: "hidden",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  }}
                >
                  {laidOut.map(({ token, x }, i) => {
                    if (token.kind === "hyphen") {
                      return (
                        <span
                          key={`hy-${sysIdx}-${token.charIndex}-${i}`}
                          style={{
                            position: "absolute",
                            left: x,
                            top: 14,
                            opacity: 0.9,
                            width: LYRIC_METRICS.hyphenPx,
                            textAlign: "center",
                          }}
                        >
                          -
                        </span>
                      );
                    }

                    const isSelected = selectedCharIndex === token.charIndex;
                    const isAnchored = anchors.some((a) => a.charIndex === token.charIndex);

                    return (
                      <button
                        key={`w-${sysIdx}-${token.charIndex}-${token.text}-${i}`}
                        type="button"
                        onClick={() => onSelectCharIndex(token.charIndex)}
                        style={{
                          position: "absolute",
                          left: x,
                          top: 4,
                          border: "1px solid rgba(255,255,255,0.25)",
                          borderRadius: 8,
                          padding: "4px 8px",
                          cursor: "pointer",
                          background: isSelected
                            ? "#ffffff"
                            : isAnchored
                            ? "rgba(255,255,255,0.12)"
                            : "transparent",
                          color: isSelected ? "#111" : "#fff",
                          fontSize: 14,
                          lineHeight: "18px",
                          whiteSpace: "nowrap",
                        }}
                        title="Click word/syllable, then click a beat above"
                      >
                        {token.text}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
