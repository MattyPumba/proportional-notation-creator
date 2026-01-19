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

const DELETE_TOOL = "__DELETE__";

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
 * - FINAL chord extends to END OF BAR.
 * - If the first chord starts after cell 0, prepend X:<beats>.
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
  const [armedChord, setArmedChord] = useState<string | null>(null); // DISPLAY symbol OR DELETE_TOOL
  const [recentChords, setRecentChords] = useState<string[]>([]); // DISPLAY symbols, max 9
  const [chordQuickInput, setChordQuickInput] = useState<string>("");

  // Draft string for the chord input; source of truth is still section.chords
  const [chordDraft, setChordDraft] = useState<string>("");

  // Lyrics collapse
  const [lyricsOpen, setLyricsOpen] = useState<boolean>(true);

  const fileRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    setDoc((d) => ({ ...d, updatedAt: new Date().toISOString() }));
  }, []);

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

  const chordStringFromDoc = useMemo(() => {
    return chordsToBeatString(section.chords, doc.subdivision, doc.timeSignature.beatsPerBar);
  }, [section.chords, doc.subdivision, doc.timeSignature.beatsPerBar]);

  useEffect(() => {
    setChordDraft((prev) => {
      if (!prev) return chordStringFromDoc;
      if (prev === chordStringFromDoc) return prev;
      return prev;
    });
  }, [chordStringFromDoc]);

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

  function removeChordAtCell(cell: number) {
    const before = section.chords.length;
    const nextChords = section.chords.filter((c) => c.cell !== cell);
    if (nextChords.length === before) return;

    setDoc({
      ...doc,
      sections: [{ ...section, chords: nextChords }],
      updatedAt: new Date().toISOString(),
    });
  }

  function onBeatClick(cell: number) {
    // Delete tool mode
    if (armedChord === DELETE_TOOL) {
      removeChordAtCell(cell);
      return;
    }

    // Place chord mode
    if (armedChord) {
      placeChordAtCell(armedChord, cell);
      return;
    }

    // Anchor mode
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

    setChordDraft(chordsToBeatString(chords, doc.subdivision, doc.timeSignature.beatsPerBar));
  }

  const armedLabel =
    armedChord === DELETE_TOOL ? "Delete chord" : armedChord ? `Chord: ${armedChord}` : null;

  return (
    <div className="appShell">
      {/* Sticky top settings bar */}
      <header className="topBar">
        <div className="topBarInner">
          <div className="topRow">
            <div className="brand">
              <h1>Proportional Notation Creator</h1>
              <span className="sub">Editor</span>
            </div>

            <div className="actions">
              <button onClick={() => downloadJson(doc, doc.title)}>Export</button>
              <button onClick={() => fileRef.current?.click()}>Import</button>
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
          </div>

          <div className="settingsRow">
            <div className="field" style={{ minWidth: 220 }}>
              <div className="fieldLabel">Title</div>
              <input
                value={doc.title}
                onChange={(e) =>
                  setDoc({ ...doc, title: e.target.value, updatedAt: new Date().toISOString() })
                }
              />
            </div>

            <div className="field">
              <div className="fieldLabel">Original key</div>
              <select
                value={doc.originalKey}
                onChange={(e) =>
                  setDoc({ ...doc, originalKey: e.target.value, updatedAt: new Date().toISOString() })
                }
              >
                {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>

            <div className="field">
              <div className="fieldLabel">Display key</div>
              <select
                value={doc.displayKey}
                onChange={(e) =>
                  setDoc({ ...doc, displayKey: e.target.value, updatedAt: new Date().toISOString() })
                }
              >
                {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>

            <div className="field">
              <div className="fieldLabel">Beats / bar</div>
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
                style={{ width: 110 }}
              />
            </div>

            <div className="field">
              <div className="fieldLabel">Subdivision</div>
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
                style={{ width: 110 }}
              />
            </div>

            <div className="spacer" />

            <div className="muted">
              transpose: {delta >= 0 ? `+${delta}` : delta} semitones
              {lastLoaded ? <> • loaded: <strong>{lastLoaded}</strong></> : null}
            </div>
          </div>
        </div>
      </header>

      {/* Scrollable editor pane */}
      <div className="content">
        {/* Chord hotbar */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="cardHeader">
            <div>
              <div className="cardTitle">Chord tools</div>
              <div className="kbdHint">
                Press <strong>1–9</strong> to arm a recent chord • Press <strong>Esc</strong> to clear
              </div>
            </div>

            <div className="row">
              {armedLabel ? (
                <span className="chip chipActive">Armed: <strong>{armedLabel}</strong></span>
              ) : (
                <span className="chip">Armed: <span style={{ opacity: 0.7 }}>none</span></span>
              )}

              <button
                type="button"
                onClick={() => setArmedChord(DELETE_TOOL)}
                className={armedChord === DELETE_TOOL ? "chip chipActive" : "chip"}
                style={{ cursor: "pointer" }}
                title="Click a beat to remove a chord"
              >
                ⌫ Delete chord
              </button>

              <button type="button" onClick={() => setArmedChord(null)} disabled={!armedChord}>
                Clear
              </button>
            </div>
          </div>

          <div className="row" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              {recentChords.length ? (
                recentChords.map((sym, i) => {
                  const active = sym === armedChord;
                  return (
                    <button
                      key={`${sym}-${i}`}
                      type="button"
                      onClick={() => setArmedChord(sym)}
                      title={`Press ${i + 1} to select`}
                      className={active ? "chip chipActive" : "chip"}
                    >
                      <span style={{ opacity: 0.7, marginRight: 6 }}>{i + 1}</span>
                      {sym}
                    </button>
                  );
                })
              ) : (
                <span className="muted">No recent chords yet — place one to start.</span>
              )}
            </div>

            <div className="spacer" />

            <div className="row" style={{ gap: 8 }}>
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
                style={{ width: 260, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
              />
              <button type="button" onClick={armChordFromInput}>Arm</button>
            </div>
          </div>

          <div className="field">
            <div className="fieldLabel">Chords (beats) — press Enter to apply • Esc to revert</div>
            <input
              value={chordDraft}
              onChange={(e) => setChordDraft(e.target.value)}
              onFocus={() => setChordDraft((prev) => (prev ? prev : chordStringFromDoc))}
              onBlur={() => {
                setChordDraft((prev) => (prev === chordStringFromDoc ? chordStringFromDoc : prev));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyChordDraft();
                if (e.key === "Escape") setChordDraft(chordStringFromDoc);
              }}
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                width: "100%",
              }}
            />
          </div>
        </div>

        {/* Lyrics */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="cardHeader">
            <div className="cardTitle">Lyrics</div>
            <div className="row">
              <button type="button" onClick={() => setLyricsOpen((v) => !v)}>
                {lyricsOpen ? "Collapse" : "Expand"}
              </button>

              <button type="button" onClick={undoLastAnchor} disabled={!section.anchors.length}>
                Undo last anchor
              </button>

              <span className="chip">
                Anchors: <strong>{section.anchors.length}</strong>
              </span>
            </div>
          </div>

          {lyricsOpen ? (
            <textarea
              value={section.lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder="Paste lyrics here…"
              style={{ width: "100%", minHeight: 140 }}
            />
          ) : (
            <div className="muted">
              Lyrics hidden • {section.lyrics ? `${section.lyrics.split("\n").length} line(s)` : "empty"}
            </div>
          )}

          <div className="muted" style={{ marginTop: 10 }}>
            Workflow: <strong>Click word under bars → click beat above</strong>
            {armedChord === DELETE_TOOL ? (
              <> • Delete mode: <strong>click a beat to remove the chord</strong></>
            ) : armedChord ? (
              <> • Chord mode: <strong>{armedChord}</strong> armed</>
            ) : selectedCharIndex !== null ? (
              <> • Word selected — now click a beat</>
            ) : (
              <> • Select a word under a system, then click a beat</>
            )}
          </div>
        </div>

        {/* Main editor grid (this is now the "main" scroll content) */}
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
      </div>
    </div>
  );
}
