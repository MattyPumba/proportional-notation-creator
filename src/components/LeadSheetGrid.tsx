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

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < 1e-9;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

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

/**
 * Even-spread within a system between anchors (same as before)
 */
function layoutEvenSpreadBetweenAnchors(args: {
  tokens: Token[];
  anchors: LyricAnchor[];
  tokenIndexByCharIndex: Map<number, number>;
  systemStartCell: number;
  systemBeats: number;
  subdivision: number;
  systemWidthPx: number;
}) {
  const {
    tokens,
    anchors,
    tokenIndexByCharIndex,
    systemStartCell,
    systemBeats,
    subdivision,
    systemWidthPx,
  } = args;

  const charPx = 9;
  const padPx = 10;
  const gapPx = 8;

  function widthOf(t: Token) {
    if (t.kind === "hyphen") return charPx * 1 + 4;
    return t.text.length * charPx + padPx;
  }

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

  const xPos: number[] = [];
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    xPos[i] = cursor;
    cursor += widthOf(tokens[i]) + gapPx;
  }

  if (anchorPoints.length === 0) {
    return tokens.map((t, i) => ({ token: t, x: xPos[i] }));
  }

  const first = anchorPoints[0];
  const last = anchorPoints[anchorPoints.length - 1];

  xPos[first.i] = first.x;
  for (let i = first.i - 1; i >= 0; i--) {
    xPos[i] = xPos[i + 1] - (widthOf(tokens[i]) + gapPx);
  }

  for (let k = 0; k < anchorPoints.length - 1; k++) {
    const a = anchorPoints[k];
    const b = anchorPoints[k + 1];

    xPos[a.i] = a.x;
    xPos[b.i] = b.x;

    const count = b.i - a.i;
    if (count <= 0) continue;

    for (let i = a.i + 1; i < b.i; i++) {
      const t = (i - a.i) / count;
      xPos[i] = a.x + t * (b.x - a.x);
    }
  }

  xPos[last.i] = last.x;
  for (let i = last.i + 1; i < tokens.length; i++) {
    xPos[i] = xPos[i - 1] + widthOf(tokens[i - 1]) + gapPx;
  }

  for (let i = 1; i < tokens.length; i++) {
    const minX = xPos[i - 1] + widthOf(tokens[i - 1]) + gapPx;
    if (xPos[i] < minX) xPos[i] = minX;
  }

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
 * Chunk tokens into systems, then APPLY CARRY-BACK:
 * If a system contains an anchored word, ensure at least `carryBackWords`
 * preceding word-tokens are included in the same system (pulled from previous).
 */
function chunkTokensIntoSystemsWithCarryBack(args: {
  tokens: Token[];
  anchors: LyricAnchor[];
  systems: { startCell: number; endCell: number }[];
  systemWidthPx: number;
  carryBackWords: number;
}) {
  const { tokens, anchors, systems, systemWidthPx, carryBackWords } = args;

  // Build tokenIndexByCharIndex for word tokens
  const tokenIndexByCharIndex = new Map<number, number>();
  tokens.forEach((t, idx) => {
    if (t.kind === "word") tokenIndexByCharIndex.set(t.charIndex, idx);
  });

  // Determine required max token index per system from anchors
  const requiredMaxTokenIndexBySystem = systems.map(() => -1);
  const requiredMinTokenIndexBySystem = systems.map(() => -1);

  for (let s = 0; s < systems.length; s++) {
    const { startCell, endCell } = systems[s];
    let maxTok = -1;
    let minTok = Number.POSITIVE_INFINITY;

    for (const a of anchors) {
      if (a.cell >= startCell && a.cell < endCell) {
        const tokIdx = tokenIndexByCharIndex.get(a.charIndex);
        if (tokIdx !== undefined) {
          maxTok = Math.max(maxTok, tokIdx);
          minTok = Math.min(minTok, tokIdx);
        }
      }
    }

    requiredMaxTokenIndexBySystem[s] = maxTok;
    requiredMinTokenIndexBySystem[s] = minTok === Number.POSITIVE_INFINITY ? -1 : minTok;
  }

  // width estimation for non-anchored fill
  const charPx = 9;
  const padPx = 10;
  const gapPx = 8;
  function tokenWidth(t: Token) {
    if (t.kind === "hyphen") return charPx * 1 + 4;
    return t.text.length * charPx + padPx;
  }

  // Initial chunking forward
  const chunks: { start: number; end: number }[] = [];
  let ptr = 0;

  for (let s = 0; s < systems.length; s++) {
    if (ptr >= tokens.length) {
      chunks.push({ start: ptr, end: ptr });
      continue;
    }

    const requiredMax = requiredMaxTokenIndexBySystem[s];

    if (requiredMax >= ptr) {
      const end = Math.min(requiredMax + 1, tokens.length);
      chunks.push({ start: ptr, end });
      ptr = end;
      continue;
    }

    let used = 0;
    let end = ptr;
    while (end < tokens.length) {
      const w = tokenWidth(tokens[end]);
      const nextUsed = used + w + (end === ptr ? 0 : gapPx);
      if (nextUsed > systemWidthPx && end > ptr) break;
      used = nextUsed;
      end++;
      if (end - ptr >= 60) break;
    }

    chunks.push({ start: ptr, end });
    ptr = end;
  }

  // CARRY-BACK PASS:
  // If system s has an anchor (minTok != -1), ensure it includes N preceding WORD tokens.
  // We pull from the previous system by shifting the boundary.
  for (let s = 0; s < chunks.length; s++) {
    const minTok = requiredMinTokenIndexBySystem[s];
    if (minTok === -1) continue;

    // Find the token index we *want* as the start boundary for context
    let needStart = minTok;
    let wordsToPull = carryBackWords;

    // Walk backwards from minTok to find N previous "word" tokens within global tokens.
    for (let i = minTok - 1; i >= 0 && wordsToPull > 0; i--) {
      if (tokens[i].kind === "word") {
        needStart = i;
        wordsToPull--;
      } else {
        // allow hyphens to come along naturally
        needStart = i;
      }
    }

    // Clamp: cannot pull before 0
    needStart = Math.max(0, needStart);

    // If this chunk already starts early enough, nothing to do
    if (chunks[s].start <= needStart) continue;

    // Pull boundary back
    const oldStart = chunks[s].start;
    chunks[s].start = needStart;

    // Give the stolen tokens back by shrinking previous chunk end
    if (s > 0) {
      chunks[s - 1].end = Math.min(chunks[s - 1].end, needStart);
    }

    // Ensure ordering (no inverted ranges)
    if (chunks[s].end < chunks[s].start) chunks[s].end = chunks[s].start;
    if (s > 0 && chunks[s - 1].end < chunks[s - 1].start) {
      chunks[s - 1].end = chunks[s - 1].start;
    }

    // If we pulled a lot, we might leave a visual gap in previous system — OK for now.
    // The important behavior is: anchored word isn't isolated.
    void oldStart;
  }

  return {
    chunks: chunks.map((r) => tokens.slice(r.start, r.end)),
    tokenIndexByCharIndex,
  };
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
    barsPerSystem = 3, // default to 3 now
  } = props;

  const beatsPerBar = timeSignature.beatsPerBar;
  const barCells = beatsPerBar * subdivision;

  const bars: BarModel[] = useMemo(() => {
    if (!chords.length || barCells <= 0) return [];

    const sorted = [...chords]
      .filter((c) => Number.isFinite(c.cell) && c.cell >= 0)
      .sort((a, b) => a.cell - b.cell);

    const lastCell = sorted[sorted.length - 1].cell;
    const totalBars = Math.max(1, Math.floor(lastCell / barCells) + 1);

    const out: BarModel[] = [];

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

  const { chunks: tokenChunks, tokenIndexByCharIndex } = useMemo(() => {
    return chunkTokensIntoSystemsWithCarryBack({
      tokens: lyricTokens,
      anchors,
      systems: systemsTiming,
      systemWidthPx,
      carryBackWords: 2, // <-- this is your "that cursed tree" behavior
    });
  }, [lyricTokens, anchors, systemsTiming, systemWidthPx]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {systems.map((systemBars, sysIdx) => {
        const tokens = tokenChunks[sysIdx] ?? [];

        const systemStartCell = systemsTiming[sysIdx]?.startCell ?? 0;
        const systemBeats = beatsPerBar * systemBars.length;

        const laidOut = layoutEvenSpreadBetweenAnchors({
          tokens,
          anchors,
          tokenIndexByCharIndex,
          systemStartCell,
          systemBeats,
          subdivision,
          systemWidthPx,
        });

        return (
          <div key={sysIdx} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "nowrap", alignItems: "flex-start" }}>
              {systemBars.map(({ barIndex, segments }) => {
                const singleFullBar =
                  segments.length === 1 && nearlyEqual(segments[0].beats, beatsPerBar);

                const beatsList = segments.map((s) => s.beats);
                const evenlyDivided =
                  beatsList.length > 1 && beatsList.every((b) => nearlyEqual(b, beatsList[0]));

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
                            style={{ background: "transparent", border: "none", cursor: "pointer" }}
                          />
                        ))}
                      </div>

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
                              borderLeft: i === 0 ? "none" : "1px solid rgba(255,255,255,0.12)",
                            }}
                          />
                        ))}
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
                Lyrics (continuous) — even-spread + carry-back context
              </div>

              {tokens.length === 0 ? (
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
                  {laidOut.map(({ token, x }) => {
                    if (token.kind === "hyphen") {
                      return (
                        <span key={`hy-${token.charIndex}`} style={{ position: "absolute", left: x, top: 10, opacity: 0.9 }}>
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
                          background: isSelected ? "#ffffff" : isAnchored ? "rgba(255,255,255,0.12)" : "transparent",
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
