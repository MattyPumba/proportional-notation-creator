// src/app/print/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeadSheetDoc, ChordEvent } from "@/lib/types";
import { LeadSheetGrid } from "@/components/LeadSheetGrid";
import { semitoneDelta, transposeChordSymbol, KEY_TO_STYLE } from "@/lib/transpose";

import styles from "./print.module.css";

const STORAGE_KEY = "pnc_doc_v1";

export default function PrintPage() {
  const [doc, setDoc] = useState<LeadSheetDoc | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as LeadSheetDoc;
      setDoc(parsed);
    } catch {
      // ignore
    }
  }, []);

  const section = doc?.sections?.[0];

  const delta = useMemo(() => {
    if (!doc) return 0;
    return semitoneDelta(doc.originalKey, doc.displayKey);
  }, [doc]);

  const accStyle = doc ? KEY_TO_STYLE[doc.displayKey] ?? "sharps" : "sharps";

  const displayChords: ChordEvent[] = useMemo(() => {
    if (!doc || !section) return [];
    if (delta === 0) return section.chords;
    return section.chords.map((c) => ({
      ...c,
      symbol: transposeChordSymbol(c.symbol, delta, accStyle),
    }));
  }, [doc, section, delta, accStyle]);

  if (!doc || !section) {
    return (
      <main className={styles.page}>
        <div className={styles.sheet}>
          <div className={styles.header}>
            <div className={styles.title}>Print Preview</div>
            <div className={styles.meta}>No doc found in localStorage.</div>
          </div>

          <div>
            Open the editor page first, then click “Print Preview”. (The editor saves the current doc
            to localStorage automatically.)
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <div className={styles.header}>
          <div className={styles.title}>
            {doc.title || "Untitled"}{" "}
            <span className={styles.meta}>
              — {doc.displayKey} (orig {doc.originalKey}, +{delta})
            </span>
          </div>
          <div className={styles.meta}>
            {doc.timeSignature.beatsPerBar}/{doc.timeSignature.beatUnit} • subdivision {doc.subdivision}
          </div>
        </div>

        <div className={styles.controls}>
          <button type="button" onClick={() => window.print()}>
            Print…
          </button>
          <button type="button" onClick={() => window.close()}>
            Close
          </button>
        </div>

        <LeadSheetGrid
          mode="print"
          chords={displayChords}
          timeSignature={doc.timeSignature}
          subdivision={doc.subdivision}
          lyrics={section.lyrics}
          anchors={section.anchors}
          selectedCharIndex={null}
          onSelectCharIndex={() => {}}
          onBeatClick={() => {}}
          barsPerSystem={3}
        />
      </div>
    </main>
  );
}
