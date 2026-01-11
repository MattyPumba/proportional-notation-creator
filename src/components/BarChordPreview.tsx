import React from "react";
import type { ChordEvent, TimeSignature } from "@/lib/types";

type Props = {
  chords: ChordEvent[];
  timeSignature: TimeSignature;
  subdivision: number;

  // NEW: make beats clickable (optional)
  onBeatClick?: (absoluteCell: number) => void;
};

type Segment = {
  symbol: string;
  startCellInBar: number;
  beats: number;
};

export function BarChordPreview({
  chords,
  timeSignature,
  subdivision,
  onBeatClick,
}: Props) {
  const beatsPerBar = timeSignature.beatsPerBar;
  const barCells = beatsPerBar * subdivision;

  if (!chords.length || barCells <= 0) return null;

  const sorted = [...chords]
    .filter((c) => Number.isFinite(c.cell) && c.cell >= 0)
    .sort((a, b) => a.cell - b.cell);

  const lastCell = sorted[sorted.length - 1].cell;
  const totalBars = Math.max(1, Math.floor(lastCell / barCells) + 1);

  const bars: { barIndex: number; segments: Segment[] }[] = [];

  for (let barIndex = 0; barIndex < totalBars; barIndex++) {
    const barStart = barIndex * barCells;
    const barEnd = barStart + barCells;

    const inBar = sorted.filter((c) => c.cell >= barStart && c.cell < barEnd);
    if (inBar.length === 0) continue;

    const segments: Segment[] = inBar.map((c, i) => {
      const start = c.cell;
      const nextStart = i + 1 < inBar.length ? inBar[i + 1].cell : barEnd;
      const durCells = Math.max(0, Math.min(nextStart, barEnd) - start);
      const beats = durCells / subdivision;

      return {
        symbol: c.symbol,
        startCellInBar: start - barStart,
        beats,
      };
    });

    bars.push({ barIndex, segments });
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        {bars.map(({ barIndex, segments }) => {
          const singleFullBar =
            segments.length === 1 && nearlyEqual(segments[0].beats, beatsPerBar);

          const beatsList = segments.map((s) => s.beats);
          const evenlyDivided =
            beatsList.length > 1 &&
            beatsList.every((b) => nearlyEqual(b, beatsList[0]));

          const showTicks = !singleFullBar && !evenlyDivided;
          const showUnderline = segments.length > 1;

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
                {/* Clickable beat overlay */}
                {onBeatClick ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 12,
                      display: "grid",
                      gridTemplateColumns: `repeat(${beatsPerBar}, 1fr)`,
                      zIndex: 5,
                    }}
                  >
                    {Array.from({ length: beatsPerBar }).map((_, beatIdx) => (
                      <button
                        key={beatIdx}
                        type="button"
                        title={`Beat ${beatIdx + 1}`}
                        onClick={() => onBeatClick(barStartAbs + beatIdx * subdivision)}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                        }}
                      />
                    ))}
                  </div>
                ) : null}

                {/* Beat grid lines */}
                <div
                  style={{
                    position: "absolute",
                    inset: 12,
                    display: "grid",
                    gridTemplateColumns: `repeat(${beatsPerBar}, 1fr)`,
                    pointerEvents: "none",
                    zIndex: 1,
                  }}
                >
                  {Array.from({ length: beatsPerBar }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        borderLeft:
                          i === 0 ? "none" : "1px solid rgba(255,255,255,0.12)",
                      }}
                    />
                  ))}
                </div>

                {/* Underline */}
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

                {/* Chords + ticks */}
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

                      <div style={{ fontSize: 26, lineHeight: "28px" }}>
                        {seg.symbol}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < 1e-9;
}
