"use client";

import { useEffect, useRef, useState } from "react";
import type { LeadSheetDoc } from "@/lib/types";
import { downloadJson, readJsonFile } from "@/lib/io";

function newDoc(): LeadSheetDoc {
  return {
    version: 1,
    title: "Untitled",
    timeSignature: { beatsPerBar: 4, beatUnit: 4 },
    subdivision: 1,
    sections: [
      {
        id: "section-1",
        name: "Verse 1",
        lyrics: "",
        chords: [],
        anchors: [],
      },
    ],
    // IMPORTANT: keep deterministic to avoid SSR/client hydration mismatch
    updatedAt: "",
  };
}

export default function Home() {
  const [doc, setDoc] = useState<LeadSheetDoc>(() => newDoc());
  const [lastLoaded, setLastLoaded] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Set updatedAt on client after mount to avoid hydration mismatch
  useEffect(() => {
    setDoc((d) => ({ ...d, updatedAt: new Date().toISOString() }));
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>
        Proportional Notation Creator
      </h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
        <button onClick={() => downloadJson(doc, doc.title)}>Export .json</button>

        <button onClick={() => fileRef.current?.click()}>Import .json</button>

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
        <p style={{ margin: "0 0 16px", opacity: 0.7 }}>
          Loaded: <strong>{lastLoaded}</strong>
        </p>
      ) : (
        <div style={{ marginBottom: 16 }} />
      )}

      <label style={{ display: "block", marginBottom: 10 }}>
        Title:{" "}
        <input
          value={doc.title}
          onChange={(e) =>
            setDoc({
              ...doc,
              title: e.target.value,
              updatedAt: new Date().toISOString(),
            })
          }
        />
      </label>

      <pre
        style={{
          background: "#f6f6f6",
          padding: 12,
          borderRadius: 8,
          overflowX: "auto",
        }}
      >
        {JSON.stringify(doc, null, 2)}
      </pre>
    </main>
  );
}
