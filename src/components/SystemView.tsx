// src/components/SystemView.tsx
import React from "react";
import type { TimeSignature, LyricAnchor } from "@/lib/types";
import type { LyricToken } from "@/lib/lyrics/tokens";
import { LYRIC_METRICS } from "@/lib/lyrics/metrics";

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

export function SystemView(props: {
  mode: "editor" | "print";

  systemIndex: number;
  systemBars: BarModel[];

  timeSignature: TimeSignature;
  subdivision: number;

  barCells: number;
  beatsPerBar: number;

  systemWidthPx: number;
  barWidthPx: number;
  gapPx: number;

  onBeatClick?: (absoluteCell: number) => void;

  lyrics: string;
  tokens: LyricToken[];
  laidOut: { token: LyricToken; x: number }[];

  anchors: LyricAnchor[];
  selectedCharIndex: number | null;
  onSelectCharIndex?: (charIndex: number) => void;
}) {
  const {
    mode,
    systemBars,
    timeSignature,
    subdivision,
    barCells,
    beatsPerBar,
    systemWidthPx,
    barWidthPx,
    gapPx,
    onBeatClick,
    lyrics,
    tokens,
    laidOut,
    anchors,
    selectedCharIndex,
    onSelectCharIndex,
    systemIndex,
  } = props;

  const isPrint = mode === "print";
  const textColor = isPrint ? "#111" : "#fff";

  // Print uses denser bars; keep x-consistency by removing internal padding offsets.
  const barPadding = isPrint ? 0 : 12;
  const lyricPadding = isPrint ? 0 : 10;

  // Print vertical tuning (prevents underlines cutting through chords)
  const barHeight = isPrint ? 56 : 90;
  const underlineTop = isPrint ? 40 : 60;

  // Print lyric typography MUST match the metrics the engine expects.
  // Editor uses monospace + 14px; print must match or tokens will collide/drift.
  const lyricFontSize = isPrint ? 14 : 14;
  const lyricLineTop = isPrint ? 6 : 4;

  return (
    <section
      style={{
        display: "grid",
        gap: isPrint ? 10 : 10,
        breakInside: "avoid",
        pageBreakInside: "avoid",
      }}
    >
      {/* Bars */}
      <div style={{ display: "flex", gap: gapPx, flexWrap: "nowrap", alignItems: "flex-start" }}>
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
            <div key={barIndex} style={{ display: "grid", gap: isPrint ? 0 : 6 }}>
              {!isPrint ? (
                <div style={{ opacity: 0.7, fontSize: 12, color: textColor }}>
                  Bar {barIndex + 1} ({beatsPerBar}/{timeSignature.beatUnit})
                </div>
              ) : null}

              <div
                style={{
                  position: "relative",
                  width: barWidthPx,
                  height: barHeight,
                  borderRadius: isPrint ? 0 : 10,
                  background: isPrint ? "transparent" : "#0f0f0f",
                  padding: barPadding,
                  overflow: "visible",
                }}
              >
                {/* EDITOR ONLY grid/labels */}
                {!isPrint ? (
                  <div style={{ position: "absolute", inset: barPadding, pointerEvents: "none", zIndex: 1 }}>
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
                            background: isBeatLine
                              ? "rgba(255,255,255,0.18)"
                              : "rgba(255,255,255,0.12)",
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
                ) : null}

                {/* EDITOR ONLY click targets (per cell) */}
                {!isPrint && onBeatClick ? (
                  <div style={{ position: "absolute", inset: barPadding, zIndex: 5 }}>
                    {Array.from({ length: barCells }).map((_, cellIdx) => {
                      const leftPct = (cellIdx / barCells) * 100;
                      const widthPct = (1 / barCells) * 100;

                      const beatNumber = Math.floor(cellIdx / subdivision) + 1;
                      const sub = cellIdx % subdivision;
                      const label =
                        subdivision === 1 ? `${beatNumber}` : sub === 0 ? `${beatNumber}` : "&";

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
                ) : null}

                {/* Underline (moved lower in print so it never cuts chords) */}
                {showUnderline ? (
                  <div
                    style={{
                      position: "absolute",
                      left: barPadding,
                      right: barPadding,
                      top: underlineTop,
                      height: 3,
                      background: isPrint ? "rgba(0,0,0,0.28)" : "#eaeaea",
                      borderRadius: 999,
                      zIndex: 2,
                    }}
                  />
                ) : null}

                {/* Chords + ticks */}
                {segments.map((seg, idx) => {
                  const leftPct = (seg.startCellInBar / barCells) * 100;
                  const tickCount = Math.max(1, Math.round(seg.beats));

                  // Print uses pure % (no padding offset). Editor keeps the padded alignment.
                  const left = isPrint ? `${leftPct}%` : `calc(${leftPct}% + ${barPadding}px)`;

                  return (
                    <div
                      key={`${seg.symbol}-${idx}-${seg.startCellInBar}`}
                      style={{
                        position: "absolute",
                        left,
                        top: 2,
                        transform: isPrint ? "none" : "translateX(-2px)",
                        color: textColor,
                        fontFamily: "system-ui",
                        zIndex: 3,
                      }}
                    >
                      {showTicks ? (
                        <div
                          style={{
                            fontFamily: "monospace",
                            fontSize: isPrint ? 12 : 18,
                            lineHeight: isPrint ? "12px" : "18px",
                            marginBottom: isPrint ? 3 : 6,
                            opacity: 0.9,
                          }}
                        >
                          {">".repeat(tickCount)}
                        </div>
                      ) : (
                        <div style={{ height: isPrint ? 12 : 24 }} />
                      )}

                      <div
                        style={{
                          fontSize: isPrint ? 18 : 26,
                          lineHeight: isPrint ? "20px" : "28px",
                          fontWeight: isPrint ? 600 : 400,
                          whiteSpace: "nowrap",
                        }}
                      >
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

      {/* Lyrics */}
      <div
        style={{
          width: systemWidthPx,
          maxWidth: "100%",
          padding: lyricPadding,
          borderRadius: isPrint ? 0 : 10,
          background: isPrint ? "transparent" : "rgba(255,255,255,0.06)",
          border: isPrint ? "none" : "1px solid rgba(255,255,255,0.10)",
        }}
      >
        {!isPrint ? (
          <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 6, color: textColor }}>
            Lyrics (continuous) — click a word then click {subdivision > 1 ? "1 & 2 & 3 & 4 &" : "a beat"}
          </div>
        ) : null}

        {!lyrics.trim() ? (
          <div style={{ opacity: 0.7, fontSize: 13, color: textColor }}>(no lyrics)</div>
        ) : tokens.length === 0 ? (
          <div style={{ opacity: 0.7, fontSize: 13, color: textColor }}>(no lyrics for this system)</div>
        ) : (
          <div
            style={{
              position: "relative",
              height: isPrint ? 32 : 44,
              // IMPORTANT: don't clip in print — clipping + overlap looks like "drift"
              overflow: isPrint ? "visible" : "hidden",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: lyricFontSize,
              lineHeight: `${lyricFontSize + 4}px`,
              color: textColor,
            }}
          >
            {laidOut.map(({ token, x }, i) => {
              if (token.kind === "hyphen") {
                return (
                  <span
                    key={`hy-${systemIndex}-${token.charIndex}-${i}`}
                    style={{
                      position: "absolute",
                      left: x,
                      top: isPrint ? lyricLineTop : 14,
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

              const isSelected = selectedCharIndex === token.charIndex;
              const isAnchored = anchors.some((a) => a.charIndex === token.charIndex);

              if (isPrint) {
                return (
                  <span
                    key={`pw-${systemIndex}-${token.charIndex}-${token.text}-${i}`}
                    style={{
                      position: "absolute",
                      left: x,
                      top: lyricLineTop,
                      whiteSpace: "nowrap",
                      fontSize: lyricFontSize,
                    }}
                  >
                    {token.text}
                  </span>
                );
              }

              return (
                <button
                  key={`w-${systemIndex}-${token.charIndex}-${token.text}-${i}`}
                  type="button"
                  onClick={() => onSelectCharIndex?.(token.charIndex)}
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
    </section>
  );
}
