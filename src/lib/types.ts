export type TimeSignature = {
  beatsPerBar: number; // e.g. 4
  beatUnit: number; // e.g. 4 (quarter note)
};

export type ChordEvent = {
  id: string;
  cell: number; // absolute cell index from start of section (0-based)
  symbol: string; // e.g. "G", "A", "Bm7/F#"
};

// NEW: anchors are by character index in lyrics (caret-based)
export type LyricAnchor = {
  id: string;
  charIndex: number; // 0..lyrics.length
  cell: number; // absolute cell index (same timeline as chords)
};

export type Section = {
  id: string;
  name: string; // "Verse 1", "Chorus", etc.
  lyrics: string; // raw text
  chords: ChordEvent[];
  anchors: LyricAnchor[];
};

export type LeadSheetDoc = {
  version: 1;
  title: string;
  artist?: string;

  originalKey: string; // the real key of the song
  displayKey: string; // the key you want to print/play in

  timeSignature: TimeSignature;
  subdivision: number; // cells per beat (1=beats, 2=8ths in 4/4, etc.)
  sections: Section[];
  updatedAt: string; // ISO timestamp
};
