// src/components/SystemView.tsx
import React from "react";
import type { ChordEvent, LyricAnchor, TimeSignature } from "@/lib/types";

type Segment = {
  symbol: string;
  startCellInBar: number;
  beats: number;
};

type BarModel = {
  barIndex: number;
  segments: Segment[];
};

function nearlyEqual(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

export type Token =
  | { kind: "word"; text: string; charIndex: number; length: number }
  | { kind: "hyphen"; charIndex: number; length: number }
  | { kind: "newline"; charIndex: number; length: number };

export type LaidOutToken = {
  tokenIndex: number;
  token: Token;
  x: number;
};

const LYRIC_METRICS = {
  charPx: 7.2,
  gapPx: 12,
  hyphenPx: 8,
};

export function SystemView(props: {
  mode?: "editor" | "print";
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
  tokens: Token[];
  laidOut: LaidOutToken[];

  anchors: LyricAnchor[];
  selectedCharIndex: number | null;
  onSelectCharIndex?: (charIndex: number) => void;
}) {
  const {
    mode = "editor",
    systemIndex,
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
  } = props;

  const isPrint = mode === "print";

  const showBeatLabels = !isPrint;
  const showGrid = !isPrint;
  const showUnderline = true;
  const showTicks = true;

  const textColor = isPrint ? "#111" : "white";

  const barPadding = isPrint ? 0 : 0;

  return (
    <div style={{ width: systemWidthPx, maxWidth: "100%" }}>
      <div style={{ display: "flex", gap: gapPx, alignItems: "stretch" }}>
        {systemBars.map((bar) => {
          const { segments } = bar;

          return (
            <div
              key={bar.barIndex}
              style={{
                width: barWidthPx,
                maxWidth: "100%",
                borderRadius: isPrint ? 0 : 14,
                background: isPrint ? "transparent" : "rgba(255,255,255,0.06)",
                border: isPrint
                  ? "none"
                  : "1px solid rgba(255,255,255,0.10)",
                padding: isPrint ? 0 : 14,
                position: "relative",
              }}
            >
              {!isPrint ? (
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8, color: textColor }}>
                  Bar {bar.barIndex + 1} ({beatsPerBar}/{timeSignature.beatUnit})
                </div>
              ) : null}

              <div
                style={{
                  position: "relative",
                  height: isPrint ? 56 : 98,
                  overflow: "hidden",
                }}
              >
                {/* Beat/grid lines */}
                {showGrid ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: "none",
                    }}
                  >
                    {Array.from({ length: barCells }).map((_, cellIdx) => {
                      const leftPct = (cellIdx / barCells) * 100;
                      const isBeatLine = subdivision === 1 ? true : cellIdx % subdivision === 0;

                      return (
                        <div
                          key={cellIdx}
                          style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: `${leftPct}%`,
                            width: 1,
                            background: isBeatLine
                              ? "rgba(255,255,255,0.20)"
                              : "rgba(255,255,255,0.10)",
                          }}
                        />
                      );
                    })}
                  </div>
                ) : null}

                {/* Beat labels */}
                {showBeatLabels && onBeatClick ? (
                  <div style={{ position: "absolute", inset: 0 }}>
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
                          onClick={() => onBeatClick(bar.barIndex * barCells + cellIdx)}
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

                {/* Underline */}
                {showUnderline ? (
                  <div
                    style={{
                      position: "absolute",
                      left: barPadding,
                      right: barPadding,
                      top: isPrint ? 28 : 60,

                      /*
                        IMPORTANT (printing):
                        Many browsers will NOT print backgrounds unless "Background graphics" is enabled.
                        So in print mode we draw the underline using a border instead of background.
                      */
                      height: isPrint ? 0 : 3,
                      background: isPrint ? "transparent" : "#eaeaea",
                      borderTop: isPrint ? "2px solid rgba(0,0,0,0.28)" : "none",
                      borderRadius: isPrint ? 0 : 999,

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
                        left: isPrint ? `${leftPct}%` : `calc(${leftPct}% + 12px)`,
                        top: 2,
                        transform: isPrint ? "none" : "translateX(-2px)",
                        color: textColor,
                        fontFamily: "system-ui",
                        zIndex: 3,
                        paddingLeft: isPrint ? 0 : 0,
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
          padding: isPrint ? 0 : 10,
          borderRadius: isPrint ? 0 : 10,
          background: isPrint ? "transparent" : "rgba(255,255,255,0.06)",
          border: isPrint ? "none" : "1px solid rgba(255,255,255,0.10)",
        }}
      >
        {!isPrint ? (
          <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 6, color: textColor }}>
            Lyrics (continuous) — click a word then click{" "}
            {subdivision > 1 ? "1 & 2 & 3 & 4 &" : "a beat"}
          </div>
        ) : null}

        {!lyrics.trim() ? (
          <div style={{ opacity: 0.7, fontSize: 13, color: textColor }}>(no lyrics)</div>
        ) : tokens.length === 0 ? (
          <div style={{ opacity: 0.7, fontSize: 13, color: textColor }}>
            (no lyrics for this system)
          </div>
        ) : (
          <div
            style={{
              position: "relative",
              height: isPrint ? 22 : 44,
              overflow: "hidden",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
                      top: isPrint ? 2 : 14,
                      opacity: 0.9,
                      width: LYRIC_METRICS.hyphenPx,
                      textAlign: "center",
                      color: textColor,
                      fontSize: isPrint ? 12 : 14,
                    }}
                  >
                    -
                  </span>
                );
              }

              if (token.kind === "newline") return null;

              const isSelected = selectedCharIndex === token.charIndex;
              const isAnchored = anchors.some((a) => a.charIndex === token.charIndex);

              return (
                <button
                  key={`w-${systemIndex}-${token.charIndex}-${i}`}
                  type="button"
                  onClick={() => onSelectCharIndex?.(token.charIndex)}
                  style={{
                    position: "absolute",
                    left: x,
                    top: isPrint ? 2 : 10,
                    fontSize: isPrint ? 12 : 14,
                    padding: isPrint ? 0 : "2px 8px",
                    borderRadius: isPrint ? 0 : 999,
                    border: isPrint
                      ? "none"
                      : isSelected
                      ? "1px solid rgba(255,255,255,0.60)"
                      : isAnchored
                      ? "1px solid rgba(255,255,255,0.30)"
                      : "1px solid rgba(255,255,255,0.14)",
                    background: isPrint
                      ? "transparent"
                      : isSelected
                      ? "rgba(255,255,255,0.18)"
                      : "rgba(0,0,0,0.10)",
                    color: textColor,
                    cursor: isPrint ? "default" : "pointer",
                    pointerEvents: isPrint ? "none" : "auto",
                    whiteSpace: "nowrap",
                  }}
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
}
