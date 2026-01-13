// src/components/LeadSheetGrid.tsx
import React, { useMemo } from "react";
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

type Token =
  | { kind: "word"; text: string; charIndex: number }
  | { kind: "hyphen"; text: "-"; charIndex: number };

type Range = { start: number; end: number }; // [start, end)

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < 1e-9;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * IMPORTANT: These widths must roughly match the actual rendered buttons
 * in the lyric line, otherwise chunking will think everything fits on line 1.
 */
const METRICS = {
  // Approx monospace glyph width at fontSize 14 (rough)
  charPx: 9,
  // Button horizontal padding (8+8) + border (~2) + a little fudge
  padPx: 20,
  // Space between tokens
  gapPx: 10,
  // Hyphen token width fudge
  hyphenPx: 14,
};

/**
 * Tokenize ALL lyrics as one continuous stream.
 * - Newlines become whitespace (continuous)
 * - Words split by whitespace
 * - Hyphenated words split into word/hyphen/word tokens with accurate indices
 */
function tokenizeAllLyrics(lyrics: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < lyrics.length) {
    while (i < lyrics.length && /\s/.test(lyrics[i])) i++;
    if (i >= lyrics.length) break;

    const wordStart = i;
    while (i < lyrics.length && !/\s/.test(lyrics[i])) i++;
    const word = lyrics.slice(wordStart, i);
    const absStart = wordStart;

    if (!word.includes("-")) {
      tokens.push({ kind: "word", text: word, charIndex: absStart });
      continue;
    }

    let local = 0;
    while (local < word.length) {
      const dash = word.indexOf("-", local);
      if (dash === -1) {
        const part = word.slice(local);
        if (part.length) {
          tokens.push({ kind: "word", text: part, charIndex: absStart + local });
        }
        break;
      }

      const left = word.slice(local, dash);
      if (left.length) {
        tokens.push({ kind: "word", text: left, charIndex: absStart + local });
      }

      tokens.push({ kind: "hyphen", text: "-", charIndex: absStart + dash });

      local = dash + 1;
      if (local >= word.length) break;
    }
  }

  return tokens;
}

function estWidthOfToken(t: Token) {
  if (t.kind === "hyphen") return METRICS.hyphenPx;
  return t.text.length * METRICS.charPx + METRICS.padPx;
}

/**
 * Even-spread ONLY between anchors.
 * - Outside anchor spans: normal linear flow
 */
function layoutOnlyBetweenAnchors(args: {
  tokens: Token[];
  anchors: LyricAnchor[];
  systemStartCell: number;
  systemBeats: number;
  subdivision: number;
  systemWidthPx: number;
}) {
  const { tokens, anchors, systemStartCell, systemBeats, subdivision, systemWidthPx } = args;

  function widthOf(t: Token) {
    return estWidthOfToken(t);
  }

  // Default linear positions
  const xPos: number[] = [];
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    xPos[i] = cursor;
    cursor += widthOf(tokens[i]) + METRICS.gapPx;
  }

  // Anchor points local to this system's token list
  const anchorPoints: { i: number; x: number }[] = [];
  for (const a of anchors) {
    const localIndex = tokens.findIndex((t) => t.kind === "word" && t.charIndex === a.charIndex);
    if (localIndex === -1) continue;

    const beat = (a.cell - systemStartCell) / subdivision;
    const beatClamped = clamp(beat, 0, systemBeats);
    const x = (beatClamped / systemBeats) * systemWidthPx;

    anchorPoints.push({ i: localIndex, x });
  }
  anchorPoints.sort((a, b) => (a.i - b.i) || (a.x - b.x));

  if (anchorPoints.length >= 1) {
    // Snap anchored tokens to their x
    for (const ap of anchorPoints) xPos[ap.i] = ap.x;

    // Even-spread ONLY between consecutive anchors
    for (let k = 0; k < anchorPoints.length - 1; k++) {
      const a = anchorPoints[k];
      const b = anchorPoints[k + 1];
      const count = b.i - a.i;
      if (count <= 0) continue;

      for (let i = a.i + 1; i < b.i; i++) {
        const t = (i - a.i) / count;
        xPos[i] = a.x + t * (b.x - a.x);
      }
    }

    // Minimal non-overlap forward pass
    for (let i = 1; i < tokens.length; i++) {
      const minX = xPos[i - 1] + widthOf(tokens[i - 1]) + METRICS.gapPx;
      if (xPos[i] < minX) xPos[i] = minX;
    }
  }

  if (tokens.length === 0) return [];

  // Clamp into view by shifting whole line
  const minLeft = Math.min(...xPos);
  const maxRight = Math.max(...xPos.map((x, i) => x + widthOf(tokens[i])));

  let shift = 0;
  if (minLeft < 0) shift = -minLeft;
  if (maxRight + shift > systemWidthPx) {
    const overflow = maxRight + shift - systemWidthPx;
    shift = Math.max(0, shift - overflow);
  }

  return tokens.map((t, i) => ({ token: t, x: xPos[i] + shift }));
}

/**
 * Chunk tokens into systems:
 * - BASE behavior: fill by estimated width
 * - If a system contains anchors, they can ONLY EXTEND the end (never truncate)
 * - Apply bar-start anchor rule: if anchored word is at beat1 of a bar (cell % barCells === 0),
 *   that anchored word must be first => boundary shifts
 *
 * FIX: do NOT apply the "bar-start anchor must be first" rule on system 0,
 * because there's no previous system to receive the earlier tokens (they would vanish).
 */
function chunkTokensWithBarStartRule(args: {
  tokens: Token[];
  anchors: LyricAnchor[];
  systems: { startCell: number; endCell: number }[];
  systemWidthPx: number;
  barCells: number;
}) {
  const { tokens, anchors, systems, systemWidthPx, barCells } = args;

  // Map charIndex -> global token index (word tokens only)
  const tokenIndexByCharIndex = new Map<number, number>();
  tokens.forEach((t, idx) => {
    if (t.kind === "word") tokenIndexByCharIndex.set(t.charIndex, idx);
  });

  // For each system, find max anchored token index that falls in that system
  const requiredMaxBySystem = systems.map(() => -1);
  for (let s = 0; s < systems.length; s++) {
    const { startCell, endCell } = systems[s];
    let maxTok = -1;
    for (const a of anchors) {
      if (a.cell >= startCell && a.cell < endCell) {
        const tokIdx = tokenIndexByCharIndex.get(a.charIndex);
        if (tokIdx !== undefined) maxTok = Math.max(maxTok, tokIdx);
      }
    }
    requiredMaxBySystem[s] = maxTok;
  }

  // 1) initial chunking forward: fill by width FIRST
  const ranges: Range[] = [];
  let ptr = 0;

  for (let s = 0; s < systems.length; s++) {
    if (ptr >= tokens.length) {
      ranges.push({ start: ptr, end: ptr });
      continue;
    }

    let used = 0;
    let end = ptr;

    while (end < tokens.length) {
      const w = estWidthOfToken(tokens[end]);
      const nextUsed = used + w + (end === ptr ? 0 : METRICS.gapPx);
      if (nextUsed > systemWidthPx && end > ptr) break;
      used = nextUsed;
      end++;
      if (end - ptr >= 160) break;
    }

    // anchors can EXTEND only
    const reqMax = requiredMaxBySystem[s];
    if (reqMax >= ptr) {
      const neededEnd = Math.min(reqMax + 1, tokens.length);
      if (neededEnd > end) end = neededEnd;
    }

    ranges.push({ start: ptr, end });
    ptr = end;
  }

  // 2) BAR-START ANCHOR RULE adjustment (but NOT on system 0)
  for (let s = 0; s < systems.length; s++) {
    if (s === 0) continue; // <-- FIX: never discard leading tokens in first system

    const { startCell, endCell } = systems[s];

    let boundaryTok = Number.POSITIVE_INFINITY;

    for (const a of anchors) {
      if (a.cell < startCell || a.cell >= endCell) continue;
      if (a.cell % barCells !== 0) continue; // beat 1 of a bar
      const tokIdx = tokenIndexByCharIndex.get(a.charIndex);
      if (tokIdx === undefined) continue;
      boundaryTok = Math.min(boundaryTok, tokIdx);
    }

    if (boundaryTok === Number.POSITIVE_INFINITY) continue;

    if (ranges[s].start < boundaryTok && boundaryTok < ranges[s].end) {
      ranges[s].start = boundaryTok;
      ranges[s - 1].end = Math.max(ranges[s - 1].end, boundaryTok);
    }

    if (ranges[s].end < ranges[s].start) ranges[s].end = ranges[s].start;
    if (ranges[s - 1].end < ranges[s - 1].start) ranges[s - 1].end = ranges[s - 1].start;
  }

  return ranges.map((r) => tokens.slice(r.start, r.end));
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

  const tokenChunks = useMemo(() => {
    return chunkTokensWithBarStartRule({
      tokens: lyricTokens,
      anchors,
      systems: systemsTiming,
      systemWidthPx,
      barCells,
    });
  }, [lyricTokens, anchors, systemsTiming, systemWidthPx, barCells]);

  const systemLayouts = useMemo(() => {
    return systems.map((systemBars, sysIdx) => {
      const tokens = tokenChunks[sysIdx] ?? [];
      const systemStartCell = systemsTiming[sysIdx]?.startCell ?? 0;
      const systemBeats = beatsPerBar * systemBars.length;

      const laidOut = layoutOnlyBetweenAnchors({
        tokens,
        anchors,
        systemStartCell,
        systemBeats,
        subdivision,
        systemWidthPx,
      });

      return { tokens, laidOut };
    });
  }, [systems, tokenChunks, systemsTiming, beatsPerBar, anchors, subdivision, systemWidthPx]);

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
                  hasAnyChords &&
                  segments.length === 1 &&
                  nearlyEqual(segments[0].beats, beatsPerBar);

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
                                <div
                                  key={cellIdx}
                                  style={{ textAlign: "center", transform: "translateY(-2px)" }}
                                >
                                  {text}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>

                      <div style={{ position: "absolute", inset: 12, zIndex: 5 }}>
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
                Lyrics (continuous) — click a word then click{" "}
                {subdivision > 1 ? "1 & 2 & 3 & 4 &" : "a beat"}
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
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  }}
                >
                  {laidOut.map(({ token, x }) => {
                    if (token.kind === "hyphen") {
                      return (
                        <span
                          key={`hy-${token.charIndex}`}
                          style={{ position: "absolute", left: x, top: 10, opacity: 0.9 }}
                        >
                          -
                        </span>
                      );
                    }

                    const isSelected = selectedCharIndex === token.charIndex;
                    const isAnchored = anchors.some((a) => a.charIndex === token.charIndex);

                    return (
                      <button
                        key={`w-${token.charIndex}-${token.text}`}
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
