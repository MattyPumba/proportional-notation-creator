"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChordEvent, LyricAnchor, TimeSignature } from "@/lib/types";
import { LeadSheetGrid } from "@/components/LeadSheetGrid";

export function PrintPreview(props: {
  title: string;
  originalKey: string;
  displayKey: string;
  transposeDelta: number;

  timeSignature: TimeSignature;
  subdivision: number;

  chords: ChordEvent[];
  lyrics: string;
  anchors: LyricAnchor[];

  barsPerSystem?: number;

  onClose: () => void;
}) {
  const {
    title,
    originalKey,
    displayKey,
    transposeDelta,
    timeSignature,
    subdivision,
    chords,
    lyrics,
    anchors,
    barsPerSystem = 3,
    onClose,
  } = props;

  const pageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);

  // IMPORTANT: we do NOT change layout widths for print.
  // We scale the whole content to fit the A4 inner width.
  useLayoutEffect(() => {
    function recompute() {
      const page = pageRef.current;
      const content = contentRef.current;
      if (!page || !content) return;

      const pageInner = page.clientWidth; // already excludes padding via box-sizing
      const contentW = content.scrollWidth;

      if (!contentW || !pageInner) {
        setScale(1);
        return;
      }

      const next = Math.min(1, pageInner / contentW);
      setScale(next);
    }

    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  const subtitle = useMemo(() => {
    const keyStr =
      displayKey === originalKey
        ? `${displayKey}`
        : `${displayKey} (orig ${originalKey}, +${transposeDelta})`;
    return `${keyStr}`;
  }, [displayKey, originalKey, transposeDelta]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      {/* A4-ish stage (screen preview). In actual printing, @page rules apply too. */}
      <div
        style={{
          width: "min(100%, 980px)",
          borderRadius: 12,
          background: "#fff",
          boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
          padding: 18,
        }}
      >
        {/* Toolbar (hidden in actual print) */}
        <div className="no-print" style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <button type="button" onClick={() => window.print()}>
            Print…
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Printable page */}
        <div
          style={{
            display: "grid",
            placeItems: "center",
            background: "#f4f4f4",
            padding: 18,
            borderRadius: 10,
          }}
        >
          <div
            ref={pageRef}
            style={{
              width: "210mm",
              minHeight: "297mm",
              background: "#fff",
              borderRadius: 10,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.08)",
              boxSizing: "border-box",
              padding: "12mm",
              display: "grid",
              gridTemplateRows: "auto 1fr",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, lineHeight: "26px" }}>{title}</div>
                <div style={{ fontSize: 13, opacity: 0.72 }}>{subtitle}</div>
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, textAlign: "right" }}>
                {timeSignature.beatsPerBar}/{timeSignature.beatUnit} • subdivision {subdivision}
              </div>
            </div>

            {/* Content (scaled, centered) */}
            <div
              style={{
                display: "grid",
                placeItems: "center",
                overflow: "hidden",
              }}
            >
              <div
                ref={contentRef}
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: "top center",
                }}
              >
                <LeadSheetGrid
                  chords={chords}
                  timeSignature={timeSignature}
                  subdivision={subdivision}
                  lyrics={lyrics}
                  anchors={anchors}
                  selectedCharIndex={null}
                  // print mode: no selection/clicking
                  onSelectCharIndex={() => {}}
                  onBeatClick={() => {}}
                  barsPerSystem={barsPerSystem}
                  variant="print"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Print CSS */}
        <style jsx global>{`
          @media print {
            .no-print {
              display: none !important;
            }
            body {
              background: #fff !important;
            }
            @page {
              size: A4;
              margin: 12mm;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
