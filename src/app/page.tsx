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

export default function Home() {
  const [doc, setDoc] = useState<LeadSheetDoc>(() => newDoc());
  const [lastLoaded, setLastLoaded] = useState<string>("");
  const [chordInput, setChordInput] = useState<string>("G:2 A:1 B:1");
  const [selectedCharIndex, setSelectedCharIndex] = useState<number | null>(null);

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

  const accStyle = KEY_TO_STYLE[doc.displayKey] ?? "sharps";

  const displayChords: ChordEvent[] = useMemo(() => {
    if (delta === 0) return section.chords;
    return section.chords.map((c) => ({
      ...c,
      symbol: transposeChordSymbol(c.symbol, delta, accStyle),
    }));
  }, [section.chords, delta, accStyle]);

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

  function onBeatClick(cell: number) {
    if (selectedCharIndex === null) return;
    addAnchor(selectedCharIndex, cell);
    setSelectedCharIndex(null);
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

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Chords (beats):</label>
        <input
          style={{ width: "100%", fontFamily: "monospace" }}
          value={chordInput}
          onChange={(e) => setChordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const chords = parseChordInput(chordInput, doc.subdivision);
              setDoc({
                ...doc,
                sections: [{ ...section, chords }],
                updatedAt: new Date().toISOString(),
              });
            }
          }}
        />
        <small style={{ opacity: 0.8 }}>Press Enter to apply</small>
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
          {selectedCharIndex !== null ? (
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
