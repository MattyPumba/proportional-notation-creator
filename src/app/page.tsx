// src/app/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LeadSheetDoc, ChordEvent, LyricAnchor } from "@/lib/types";
import { downloadJson, readJsonFile } from "@/lib/io";
import { parseChordInput } from "@/lib/chordInput";
import { semitoneDelta, transposeChordSymbol, KEY_TO_STYLE } from "@/lib/transpose";
import { LeadSheetGrid } from "@/components/LeadSheetGrid";

const KEYS = ["C","G","D","A","E","B","F#","C#","F","Bb","Eb","Ab","Db","Gb","Cb"];
const STORAGE_KEY = "pnc_doc_v1";

function newDoc(): LeadSheetDoc {
  return {
    version: 1,
    title: "Untitled",
    originalKey: "C",
    displayKey: "C",
    timeSignature: { beatsPerBar: 4, beatUnit: 4 },
    subdivision: 1,
    sections: [
      { id: "section-1", name: "Verse 1", lyrics: "", chords: [], anchors: [] },
    ],
    updatedAt: "",
  };
}

function isTypingTarget(el: EventTarget | null) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

/**
 * Convert chord events back to a compact "SYMBOL:beats ..." string.
 *
 * - Beats are derived from cell deltas / subdivision.
 * - FINAL chord extends to END OF BAR (prevents "C:4" becoming "C:1").
 * - ALSO: if the first chord starts after cell 0, prepend a leading "X:<beats>".
 *   This preserves user-entered leading rests like "X:4 C:4".
 */
function chordsToBeatString(chords: ChordEvent[], subdivision: number, beatsPerBar: number) {
  if (!chords.length) return "";

  const safeSub = Math.max(1, subdivision);
  const safeBeatsPerBar = Math.max(1, beatsPerBar);
  const barCells = safeBeatsPerBar * safeSub;

  const sorted = [...chords].sort((a, b) => a.cell - b.cell);

  // Group chords that share the same cell; keep last one
  const uniqByCell: ChordEvent[] = [];
  for (const c of sorted) {
    const prev = uniqByCell[uniqByCell.length - 1];
    if (prev && prev.cell === c.cell) {
      uniqByCell[uniqByCell.length - 1] = c;
    } else {
      uniqByCell.push(c);
    }
  }

  const parts: string[] = [];

  // ✅ NEW: leading gap before first chord becomes X:<beats>
  const firstCell = uniqByCell[0]?.cell ?? 0;
  if (firstCell > 0) {
    const leadBeats = Math.max(1, Math.round(firstCell / safeSub));
    parts.push(`X:${leadBeats}`);
  }

  for (let i = 0; i < uniqByCell.length; i++) {
    const cur = uniqByCell[i];
    const next = uniqByCell[i + 1];

    let cellDelta: number;

    if (next) {
      cellDelta = Math.max(0, next.cell - cur.cell);
    } else {
      // Final chord: extend to end of its bar
      const cellInBar = ((cur.cell % barCells) + barCells) % barCells;
      cellDelta = Math.max(0, barCells - cellInBar);
    }

    const beats = Math.max(1, Math.round(cellDelta / safeSub));
    parts.push(`${cur.symbol}:${beats}`);
  }

  return parts.join(" ");
}

export default function Home() {
  const [doc, setDoc] = useState<LeadSheetDoc>(() => newDoc());
  const [lastLoaded, setLastLoaded] = useState<string>("");
  const [selectedCharIndex, setSelectedCharIndex] = useState<number | null>(null);

  // Chord hotbar state
  const [armedChord, setArmedChord] = useState<string | null>(null); // DISPLAY symbol
  const [recentChords, setRecentChords] = useState<string[]>([]); // DISPLAY symbols, max 9
  const [chordQuickInput, setChordQuickInput] = useState<string>("");

  // Draft string for the chord input; source of truth is still section.chords
  const [chordDraft, setChordDraft] = useState<string>("");

  const fileRef = useRef<HTMLInputElement>(null);

  // Restore doc from localStorage (if present)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as LeadSheetDoc;
      if (parsed?.version === 1) setDoc({ ...parsed, updatedAt: new Date().toISOString() });
    } catch {
      // ignore
    }
  }, []);

  // Stamp updatedAt on initial mount
  useEffect(() => {
    setDoc((d) => ({ ...d, updatedAt: new Date().toISOString() }));
  }, []);

  // Persist doc for print preview
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch {
      // ignore
    }
  }, [doc]);

  const section = doc.sections[0];

  const delta = useMemo(
    () => semitoneDelta(doc.originalKey, doc.displayKey),
    [doc.originalKey, doc.displayKey]
  );

  const displayAccStyle = KEY_TO_STYLE[doc.displayKey] ?? "sharps";
  const originalAccStyle = KEY_TO_STYLE[doc.originalKey] ?? "sharps";

  const displayChords: ChordEvent[] = useMemo(() => {
    if (delta === 0) return section.chords;
    return section.chords.map((c) => ({
      ...c,
      symbol: transposeChordSymbol(c.symbol, delta, displayAccStyle),
    }));
  }, [section.chords, delta, displayAccStyle]);

  // Keep the chord input field in sync with the doc chords (unless user is actively editing)
  const chordStringFromDoc = useMemo(() => {
    return chordsToBeatString(section.chords, doc.subdivision, doc.timeSignature.beatsPerBar);
  }, [section.chords, doc.subdivision, doc.timeSignature.beatsPerBar]);

  useEffect(() => {
    setChordDraft((prev) => {
      if (!prev) return chordStringFromDoc;
      if (prev === chordStringFromDoc) return prev;
      return prev; // user is editing; don't overwrite
    });
  }, [chordStringFromDoc]);

  // Seed recents from currently displayed chords (once)
  useEffect(() => {
    setRecentChords((prev) => {
      if (prev.length) return prev;

      const uniq: string[] = [];
      for (const c of displayChords) {
        const s = (c.symbol || "").trim();
        if (!s) continue;
        if (!uniq.includes(s)) uniq.push(s);
        if (uniq.length >= 9) break;
      }
      return uniq;
    });
  }, [displayChords]);

  function bumpRecent(displaySymbol: string) {
    const sym = displaySymbol.trim();
    if (!sym) return;
    setRecentChords((prev) => {
      const next = [sym, ...prev.filter((x) => x !== sym)];
      return next.slice(0, 9);
    });
  }

  // Keyboard: 1-9 selects chord; Esc clears chord mode
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      if (e.key === "Escape") {
        setArmedChord(null);
        return;
      }

      const n = Number(e.key);
      if (Number.isFinite(n) && n >= 1 && n <= 9) {
        const sym = recentChords[n - 1];
        if (sym) setArmedChord(sym);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [recentChords]);

  function setLyrics(next: string) {
    const nextAnchors = section.anchors
      .map((a) => ({ ...a, charIndex: Math.min(a.charIndex, next.length) }))
      .filter((a) => a.charIndex >= 0);

    setDoc({
      ...doc,
      sections: [{ ...section, lyrics: next, anchors: nextAnchors }],
      updatedAt: new Date().toISOString(),
    });

    if (selectedCharIndex !== null && selectedCharIndex > next.length) {
      setSelectedCharIndex(null);
    }
  }

  function addAnchor(charIndex: number, cell: number) {
    const clamped = Math.max(0, Math.min(charIndex, section.lyrics.length));

    const filtered = section.anchors.filter((a) => a.charIndex !== clamped);

    const nextAnchor: LyricAnchor = {
      id: crypto.randomUUID(),
      charIndex: clamped,
      cell,
    };

    const nextAnchors = [...filtered, nextAnchor].sort((a, b) => a.cell - b.cell);

    setDoc({
      ...doc,
      sections: [{ ...section, anchors: nextAnchors }],
      updatedAt: new Date().toISOString(),
    });
  }

  function undoLastAnchor() {
    if (!section.anchors.length) return;
    const nextAnchors = section.anchors.slice(0, -1);
    setDoc({
      ...doc,
      sections: [{ ...section, anchors: nextAnchors }],
      updatedAt: new Date().toISOString(),
    });
  }

  function placeChordAtCell(displaySymbol: string, cell: number) {
    // Store chords in ORIGINAL key space
    const storageSymbol =
      delta === 0
        ? displaySymbol
        : transposeChordSymbol(displaySymbol, -delta, originalAccStyle);

    const filtered = section.chords.filter((c) => c.cell !== cell);

    const next: ChordEvent = {
      id: crypto.randomUUID(),
      cell,
      symbol: storageSymbol,
    };

    const nextChords = [...filtered, next].sort((a, b) => a.cell - b.cell);

    setDoc({
      ...doc,
      sections: [{ ...section, chords: nextChords }],
      updatedAt: new Date().toISOString(),
    });

    bumpRecent(displaySymbol);
  }

  function onBeatClick(cell: number) {
    if (armedChord) {
      placeChordAtCell(armedChord, cell);
      return;
    }
    if (selectedCharIndex === null) return;
    addAnchor(selectedCharIndex, cell);
    setSelectedCharIndex(null);
  }

  function armChordFromInput() {
    const sym = chordQuickInput.trim();
    if (!sym) return;
    setArmedChord(sym);
    bumpRecent(sym);
    setChordQuickInput("");
  }

  function applyChordDraft() {
    const chords = parseChordInput(chordDraft, doc.subdivision);

    setDoc({
      ...doc,
      sections: [{ ...section, chords }],
      updatedAt: new Date().toISOString(),
    });

    // Re-sync draft immediately
    setChordDraft(chordsToBeatString(chords, doc.subdivision, doc.timeSignature.beatsPerBar));
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        fontFamily: "system-ui",
        background: "#000",
        color: "#fff",
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>
        Proportional Notation Creator
      </h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <button onClick={() => downloadJson(doc, doc.title)}>Export .json</button>
        <button onClick={() => fileRef.current?.click()}>Import .json</button>
        <button
          type="button"
          onClick={() => window.open("/print", "_blank", "noopener,noreferrer")}
        >
          Print Preview
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={async (e) => {
            const input = e.currentTarget;
            const f = input.files?.[0];
            if (!f) return;
            const imported = await readJsonFile(f);
            setDoc({ ...imported, updatedAt: new Date().toISOString() });
            setLastLoaded(f.name);
            input.value = "";
          }}
        />
      </div>

      {lastLoaded ? (
        <p style={{ margin: "0 0 16px", opacity: 0.8 }}>
          Loaded: <strong>{lastLoaded}</strong>
        </p>
      ) : (
        <div style={{ marginBottom: 16 }} />
      )}

      <label style={{ display: "block", marginBottom: 12 }}>
        Title:{" "}
        <input
          value={doc.title}
          onChange={(e) =>
            setDoc({ ...doc, title: e.target.value, updatedAt: new Date().toISOString() })
          }
        />
      </label>

      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label>
          Original key:{" "}
          <select
            value={doc.originalKey}
            onChange={(e) =>
              setDoc({ ...doc, originalKey: e.target.value, updatedAt: new Date().toISOString() })
            }
          >
            {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>

        <label>
          Display key:{" "}
          <select
            value={doc.displayKey}
            onChange={(e) =>
              setDoc({ ...doc, displayKey: e.target.value, updatedAt: new Date().toISOString() })
            }
          >
            {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>

        <span style={{ opacity: 0.75 }}>(transpose: +{delta} semitones)</span>
      </div>

      <label style={{ display: "block", marginBottom: 12 }}>
        Beats per bar:{" "}
        <input
          type="number"
          min={1}
          value={doc.timeSignature.beatsPerBar}
          onChange={(e) =>
            setDoc({
              ...doc,
              timeSignature: {
                ...doc.timeSignature,
                beatsPerBar: Math.max(1, Number(e.target.value || 4)),
              },
              updatedAt: new Date().toISOString(),
            })
          }
          style={{ width: 80 }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 12 }}>
        Subdivision (cells per beat):{" "}
        <input
          type="number"
          min={1}
          value={doc.subdivision}
          onChange={(e) =>
            setDoc({
              ...doc,
              subdivision: Math.max(1, Number(e.target.value || 1)),
              updatedAt: new Date().toISOString(),
            })
          }
          style={{ width: 80 }}
        />{" "}
        <span style={{ opacity: 0.75 }}>(1 = beats, 2 = eighths, 4 = sixteenths...)</span>
      </label>

      {/* Chord hotbar */}
      <div
        style={{
          marginBottom: 14,
          padding: 12,
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700 }}>Chord hotbar</div>
          {armedChord ? (
            <div style={{ opacity: 0.9 }}>
              Armed: <strong>{armedChord}</strong>{" "}
              <span style={{ opacity: 0.75 }}>(click grid to place • Esc to clear)</span>
            </div>
          ) : (
            <div style={{ opacity: 0.75 }}>
              Click a chord below (or press 1–9) then click the grid to place.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {recentChords.length ? (
              recentChords.map((sym, i) => {
                const active = sym === armedChord;
                return (
                  <button
                    key={`${sym}-${i}`}
                    type="button"
                    onClick={() => setArmedChord(sym)}
                    title={`Press ${i + 1} to select`}
                    style={{
                      fontFamily: "system-ui",
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: active
                        ? "1px solid rgba(255,255,255,0.70)"
                        : "1px solid rgba(255,255,255,0.22)",
                      background: active ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.25)",
                      color: "#fff",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ opacity: 0.75, marginRight: 6 }}>{i + 1}</span>
                    {sym}
                  </button>
                );
              })
            ) : (
              <span style={{ opacity: 0.7 }}>No recent chords yet — place one to start.</span>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={chordQuickInput}
              onChange={(e) => setChordQuickInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") armChordFromInput();
                if (e.key === "Escape") {
                  setChordQuickInput("");
                  setArmedChord(null);
                }
              }}
              placeholder="Type chord (e.g., F2, Gadd4)…"
              style={{ width: 220, fontFamily: "monospace" }}
            />
            <button type="button" onClick={armChordFromInput}>Arm</button>
            <button type="button" onClick={() => setArmedChord(null)} disabled={!armedChord}>
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Chords input (synced to doc chords) */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Chords (beats):</label>
        <input
          style={{ width: "100%", fontFamily: "monospace" }}
          value={chordDraft}
          onChange={(e) => setChordDraft(e.target.value)}
          onFocus={() => {
            setChordDraft((prev) => (prev ? prev : chordStringFromDoc));
          }}
          onBlur={() => {
            setChordDraft((prev) => (prev === chordStringFromDoc ? chordStringFromDoc : prev));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyChordDraft();
            if (e.key === "Escape") setChordDraft(chordStringFromDoc);
          }}
        />
        <small style={{ opacity: 0.8 }}>Press Enter to apply • Esc to revert</small>
      </div>

      <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        <div style={{ fontWeight: 700 }}>Lyrics (paste here)</div>
        <textarea
          value={section.lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder="Each lyric line will render under each system of bars."
          style={{
            width: "100%",
            minHeight: 120,
            padding: 10,
            borderRadius: 8,
            fontFamily: "system-ui",
          }}
        />
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={undoLastAnchor} disabled={!section.anchors.length}>
            Undo last anchor
          </button>
          <span style={{ opacity: 0.8 }}>
            Anchors: <strong>{section.anchors.length}</strong>
          </span>
          <span style={{ opacity: 0.8 }}>
            Workflow: <strong>Click word under bars → click beat above</strong>
          </span>

          {armedChord ? (
            <span style={{ opacity: 0.9 }}>
              Chord mode: <strong>{armedChord}</strong> armed — click the grid to place (Esc to clear).
            </span>
          ) : selectedCharIndex !== null ? (
            <span style={{ opacity: 0.9 }}>Word selected — now click a beat.</span>
          ) : (
            <span style={{ opacity: 0.75 }}>Select a word under a system, then click a beat.</span>
          )}
        </div>
      </div>

      <LeadSheetGrid
        mode="editor"
        chords={displayChords}
        timeSignature={doc.timeSignature}
        subdivision={doc.subdivision}
        lyrics={section.lyrics}
        anchors={section.anchors}
        selectedCharIndex={selectedCharIndex}
        onSelectCharIndex={setSelectedCharIndex}
        onBeatClick={onBeatClick}
        barsPerSystem={3}
      />
    </main>
  );
}
