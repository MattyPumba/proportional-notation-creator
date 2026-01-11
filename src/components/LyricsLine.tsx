import React, { useMemo } from "react";
import type { LyricAnchor } from "@/lib/types";

type WordToken = {
  text: string;
  start: number; // char index in original lyrics
};

function lineRanges(lyrics: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i <= lyrics.length; i++) {
    const ch = lyrics[i];
    if (ch === "\n" || i === lyrics.length) {
      ranges.push({ start, end: i });
      start = i + 1;
    }
  }
  return ranges;
}

function findLineForCaret(lyrics: string, caretIndex: number | null) {
  const ranges = lineRanges(lyrics);
  const ci = caretIndex ?? 0;

  // find containing range
  for (const r of ranges) {
    if (ci >= r.start && ci <= r.end) return r;
  }

  // fallback to first non-empty line
  for (const r of ranges) {
    const line = lyrics.slice(r.start, r.end);
    if (line.trim().length > 0) return r;
  }

  // fallback to first
  return ranges[0] ?? { start: 0, end: 0 };
}

function tokenizeLine(line: string, lineStartOffset: number): WordToken[] {
  const tokens: WordToken[] = [];
  let i = 0;

  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;

    const start = i;
    while (i < line.length && !/\s/.test(line[i])) i++;

    tokens.push({
      text: line.slice(start, i),
      start: lineStartOffset + start,
    });
  }

  return tokens;
}

export function LyricsLine(props: {
  lyrics: string;
  anchors: LyricAnchor[];
  selectedCharIndex: number | null;
  onSelectCharIndex: (charIndex: number) => void;
  caretIndex: number | null; // NEW: choose active line by caret
}) {
  const { lyrics, anchors, selectedCharIndex, onSelectCharIndex, caretIndex } = props;

  const { line, offset, words } = useMemo(() => {
    if (!lyrics) return { line: "", offset: 0, words: [] as WordToken[] };

    const r = findLineForCaret(lyrics, caretIndex);
    const line = lyrics.slice(r.start, r.end);
    const words = tokenizeLine(line, r.start);

    return { line, offset: r.start, words };
  }, [lyrics, caretIndex]);

  if (!lyrics.trim()) {
    return (
      <div style={{ opacity: 0.7, fontSize: 13 }}>
        Paste lyrics above — click into a line in the textarea, then anchor words here.
      </div>
    );
  }

  if (!line.trim()) {
    return (
      <div style={{ opacity: 0.7, fontSize: 13 }}>
        Current line is empty. Click into a non-empty line in the lyrics box.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
      {words.map((w) => {
        const isSelected = selectedCharIndex === w.start;
        const isAnchored = anchors.some((a) => a.charIndex === w.start);

        return (
          <button
            key={`${w.start}-${w.text}`}
            type="button"
            onClick={() => onSelectCharIndex(w.start)}
            style={{
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: 999,
              padding: "4px 10px",
              cursor: "pointer",
              background: isSelected
                ? "#ffffff"
                : isAnchored
                ? "rgba(255,255,255,0.12)"
                : "transparent",
              color: isSelected ? "#111" : "#fff",
              fontFamily: "system-ui",
              fontSize: 14,
              lineHeight: "18px",
              whiteSpace: "nowrap",
            }}
            title={isAnchored ? "Anchored (click to select again)" : "Click then click a beat"}
          >
            {w.text}
          </button>
        );
      })}
    </div>
  );
}
