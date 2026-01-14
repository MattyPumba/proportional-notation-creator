// src/components/PrintSystemView.tsx
import React from "react";
import type { TimeSignature, LyricAnchor } from "@/lib/types";
import type { LyricToken } from "@/lib/lyrics/tokens";
import { LYRIC_METRICS } from "@/lib/lyrics/metrics";
import { cellToX } from "@/lib/geometry/cellToX";

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

export function PrintSystemView(props: {
  systemIndex: number;
  systemBars: BarModel[];

  timeSignature: TimeSignature;
  subdivision: number;

  barCells: number;
  beatsPerBar: number;

  systemStartCell: number;

  barWidthPx: number;
  gapPx: number;

  // Lyric render inputs
  lyrics: string;
  tokens: LyricToken[];
  laidOutCells: { token: LyricToken; cell: number }[];

  anchors: LyricAnchor[];
}) {
  const {
    systemBars,
    timeSignature,
    subdivision,
    barCells,
    beatsPerBar,
    systemStartCell,
    barWidthPx,
    gapPx,
    lyrics,
    tokens,
    laidOutCells,
    anchors,
  } = props;

  const barsInSystem = systemBars.length;
  const systemWidthPx = barsInSystem * barWidthPx + (barsInSystem - 1) * gapPx;

  const textColor = "#111";

  // Vertical tuning for print
  const barAreaHeight = 58;
  const underlineTop = 40;

  const lyricHeight = 34;
  const lyricTop = 6;
  const lyricFontSize = 14;

  return (
    <section
      style={{
        display: "grid",
        gap: 10,
        breakInside: "avoid",
        pageBreakInside: "avoid",
      }}
    >
      {/* Chords area (single continuous timeline) */}
      <div
        style={{
          position: "relative",
          width: systemWidthPx,
          height: barAreaHeight,
          overflow: "visible",
        }}
      >
        {systemBars.map((bar) => {
          const hasAnyChords = bar.segments.length > 0;

          const singleFullBar =
            hasAnyChords &&
            bar.segments.length === 1 &&
            nearlyEqual(bar.segments[0].beats, beatsPerBar);

          const beatsList = bar.segments.map((s) => s.beats);
          const evenlyDivided =
            hasAnyChords &&
            beatsList.length > 1 &&
            beatsList.every((b) => nearlyEqual(b, beatsList[0]));

          const showTicks = hasAnyChords && !singleFullBar && !evenlyDivided;
          const showUnderline = hasAnyChords && bar.segments.length > 1;

          const barStartAbsCell = bar.barIndex * barCells;
          const barStartX = cellToX({
            absoluteCell: barStartAbsCell,
            systemStartCell,
            barCells,
            barWidthPx,
            gapPx,
          });

          // Underline for multi-chord bars
          if (showUnderline) {
            // Draw full-bar underline
            // (matches classic chart feel; can refine later to segment underline spans)
            // eslint-disable-next-line no-lone-blocks
            {
              /* render underline */
            }
          }

          return (
            <React.Fragment key={bar.barIndex}>
              {showUnderline ? (
                <div
                  style={{
                    position: "absolute",
                    left: barStartX,
                    top: underlineTop,
                    width: barWidthPx,
                    height: 3,
                    background: "rgba(0,0,0,0.28)",
                    borderRadius: 999,
                  }}
                />
              ) : null}

              {bar.segments.map((seg, idx) => {
                const absCell = barStartAbsCell + seg.startCellInBar;
                const x = cellToX({
                  absoluteCell: absCell,
                  systemStartCell,
                  barCells,
                  barWidthPx,
                  gapPx,
                });

                const tickCount = Math.max(1, Math.round(seg.beats));

                return (
                  <div
                    key={`${bar.barIndex}-${seg.symbol}-${idx}-${seg.startCellInBar}`}
                    style={{
                      position: "absolute",
                      left: x,
                      top: 2,
                      color: textColor,
                      fontFamily: "system-ui",
                      zIndex: 3,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {showTicks ? (
                      <div
                        style={{
                          fontFamily: "monospace",
                          fontSize: 12,
                          lineHeight: "12px",
                          marginBottom: 3,
                          opacity: 0.9,
                        }}
                      >
                        {">".repeat(tickCount)}
                      </div>
                    ) : (
                      <div style={{ height: 12 }} />
                    )}

                    <div
                      style={{
                        fontSize: 18,
                        lineHeight: "20px",
                        fontWeight: 600,
                      }}
                    >
                      {seg.symbol}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>

      {/* Lyrics (single continuous timeline, positioned by cellToX) */}
      <div
        style={{
          width: systemWidthPx,
          maxWidth: "100%",
        }}
      >
        {!lyrics.trim() ? (
          <div style={{ opacity: 0.7, fontSize: 13, color: textColor }}>(no lyrics)</div>
        ) : tokens.length === 0 ? (
          <div style={{ opacity: 0.7, fontSize: 13, color: textColor }}>(no lyrics for this system)</div>
        ) : (
          <div
            style={{
              position: "relative",
              height: lyricHeight,
              overflow: "visible",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: lyricFontSize,
              lineHeight: `${lyricFontSize + 4}px`,
              color: textColor,
            }}
          >
            {laidOutCells.map(({ token, cell }, i) => {
              const x = cellToX({
                absoluteCell: cell,
                systemStartCell,
                barCells,
                barWidthPx,
                gapPx,
              });

              if (token.kind === "hyphen") {
                return (
                  <span
                    key={`hy-${token.charIndex}-${i}`}
                    style={{
                      position: "absolute",
                      left: x,
                      top: lyricTop,
                      opacity: 0.9,
                      width: LYRIC_METRICS.hyphenPx,
                      textAlign: "center",
                      color: textColor,
                      fontSize: lyricFontSize,
                    }}
                  >
                    -
                  </span>
                );
              }

              // Word token
              return (
                <span
                  key={`w-${token.charIndex}-${token.text}-${i}`}
                  style={{
                    position: "absolute",
                    left: x,
                    top: lyricTop,
                    whiteSpace: "nowrap",
                    fontSize: lyricFontSize,
                  }}
                >
                  {token.text}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
