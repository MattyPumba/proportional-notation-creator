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
    sections: [{ id: "section-1", name: "Verse 1", lyrics: "", chords: [], anchors: [] }],
    updatedAt: "",
  };
}

function isTypingTarget(el: EventTarget | null) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

function chordsToBeatString(chords: ChordEvent[], subdivision: number, beatsPerBar: number) {
  if (!chords.length) return "";

  const safeSub = Math.max(1, subdivision);
  const safeBeatsPerBar = Math.max(1, beatsPerBar);
  const barCells = safeBeatsPerBar * safeSub;

  const sorted = [...chords].sort((a, b) => a.cell - b.cell);

  const uniqByCell: ChordEvent[] = [];
  for (const c of sorted) {
    const prev = uniqByCell[uniqByCell.length - 1];
    if (prev && prev.cell === c.cell) uniqByCell[uniqByCell.length - 1] = c;
    else uniqByCell.push(c);
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

    if (next) cellDelta = Math.max(0, next.cell - cur.cell);
    else {
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

  // Chord tools state
  const [armedChord, setArmedChord] = useState<string | null>(null);
  const [recentChords, setRecentChords] = useState<string[]>([]);
  const [chordQuickInput, setChordQuickInput] = useState<string>("");
  const [chordDraft, setChordDraft] = useState<string>("");

  // Dock collapse state
  const [chordToolsOpen, setChordToolsOpen] = useState(true);
  const [lyricsOpen, setLyricsOpen] = useState(true);

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
    setChordDraft((prev) => (prev ? prev : chordStringFromDoc));
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
    setRecentChords((prev) => [sym, ...prev.filter((x) => x !== sym)].slice(0, 9));
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

    const nextAnchor: LyricAnchor = { id: crypto.randomUUID(), charIndex: clamped, cell };
    const nextAnchors = [...filtered, nextAnchor].sort((a, b) => a.cell - b.cell);

    setDoc({
      ...doc,
      sections: [{ ...section, anchors: nextAnchors }],
      updatedAt: new Date().toISOString(),
    });
  }

  function undoLastAnchor() {
    if (!section.anchors.length) return;
    setDoc({
      ...doc,
      sections: [{ ...section, anchors: section.anchors.slice(0, -1) }],
      updatedAt: new Date().toISOString(),
    });
  }

  function placeChordAtCell(displaySymbol: string, cell: number) {
    const storageSymbol =
      delta === 0 ? displaySymbol : transposeChordSymbol(displaySymbol, -delta, originalAccStyle);

    const filtered = section.chords.filter((c) => c.cell !== cell);

    const next: ChordEvent = { id: crypto.randomUUID(), cell, symbol: storageSymbol };
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
    if (armedChord === DELETE_TOOL) {
      removeChordAtCell(cell);
      return;
    }

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
    setChordDraft(chordsToBeatString(chords, doc.subdivision, doc.timeSignature.beatsPerBar));
  }

  const armedLabel =
    armedChord === DELETE_TOOL ? "Delete chord" : armedChord ? `Chord: ${armedChord}` : "none";

  const lyricsSummary = section.lyrics
    ? `${section.lyrics.split("\n").length} line(s)`
    : "empty";

  return (
    <div className="appShell">
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
                {KEYS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
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
                {KEYS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
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

          {/* Dock (pinned under settings) */}
          <div className="dockRow">
            {/* Chord tools */}
            <div className="dockPanel">
              <div className="dockHeader">
                <div className="dockHeaderLeft">
                  <div className="dockTitle">Chord tools</div>
                  <div className="dockMeta">
                    Armed: <strong>{armedLabel}</strong> • {recentChords.length ? "1–9 to arm" : "place a chord to start"}
                  </div>
                </div>

                <div className="dockHeaderRight">
                  <button
                    type="button"
                    onClick={() => setArmedChord(DELETE_TOOL)}
                    className={armedChord === DELETE_TOOL ? "chip chipActive" : "chip"}
                    style={{ cursor: "pointer" }}
                    title="Click a beat to remove a chord"
                  >
                    ⌫ Delete
                  </button>

                  <button type="button" onClick={() => setArmedChord(null)} disabled={!armedChord}>
                    Clear
                  </button>

                  <button type="button" onClick={() => setChordToolsOpen((v) => !v)}>
                    {chordToolsOpen ? "Collapse" : "Expand"}
                  </button>
                </div>
              </div>

              {chordToolsOpen ? (
                <div className="dockBody dockBodyTight">
                  <div className="row" style={{ gap: 8, marginBottom: 8 }}>
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
                            style={{ padding: "6px 10px" }}
                          >
                            <span style={{ opacity: 0.7, marginRight: 6 }}>{i + 1}</span>
                            {sym}
                          </button>
                        );
                      })
                    ) : (
                      <span className="muted">No recent chords yet.</span>
                    )}

                    <div className="spacer" />

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
                      placeholder="Type chord…"
                      className="monoInput"
                      style={{ width: 220 }}
                    />
                    <button type="button" onClick={armChordFromInput}>
                      Arm
                    </button>
                  </div>

                  <div className="field">
                    <div className="fieldLabel">
                      Chords (beats) — Enter apply • Esc revert
                    </div>
                    <input
                      value={chordDraft}
                      onChange={(e) => setChordDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyChordDraft();
                        if (e.key === "Escape") setChordDraft(chordStringFromDoc);
                      }}
                      className="monoInput"
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {/* Lyrics */}
            <div className="dockPanel">
              <div className="dockHeader">
                <div className="dockHeaderLeft">
                  <div className="dockTitle">Lyrics</div>
                  <div className="dockMeta">
                    {lyricsSummary} • Anchors: <strong>{section.anchors.length}</strong>
                  </div>
                </div>

                <div className="dockHeaderRight">
                  <button type="button" onClick={undoLastAnchor} disabled={!section.anchors.length}>
                    Undo anchor
                  </button>

                  <button type="button" onClick={() => setLyricsOpen((v) => !v)}>
                    {lyricsOpen ? "Collapse" : "Expand"}
                  </button>
                </div>
              </div>

              {lyricsOpen ? (
                <div className="dockBody dockBodyTight">
                  <textarea
                    value={section.lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    placeholder="Paste lyrics here…"
                    style={{ width: "100%", minHeight: 90, maxHeight: 140 }}
                  />

                  <div className="muted" style={{ marginTop: 8 }}>
                    Workflow: <strong>Click word under bars → click beat above</strong>
                    {armedChord === DELETE_TOOL ? (
                      <> • Delete: <strong>click beat to remove chord</strong></>
                    ) : armedChord ? (
                      <> • Chord: <strong>{armedChord}</strong> armed</>
                    ) : selectedCharIndex !== null ? (
                      <> • Word selected — now click a beat</>
                    ) : (
                      <> • Select a word, then click a beat</>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {/* ONLY the grid scrolls now */}
      <div className="content">
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
