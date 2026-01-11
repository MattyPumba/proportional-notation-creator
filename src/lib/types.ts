export type TimeSignature = {
  beatsPerBar: number; // e.g. 4
  beatUnit: number; // e.g. 4 (quarter note)
};

export type ChordEvent = {
  id: string;
  cell: number; // absolute cell index from start of section (0-based)
  symbol: string; // e.g. "G", "A", "Bm7/F#"
};

export type LyricAnchor = {
  id: string;
  tokenIndex: number; // which word/token in the lyric block
  cell: number; // absolute cell index (same timeline as chords)
};

export type Section = {
  id: string;
  name: string; // "Verse 1", "Chorus", etc.
  lyrics: string; // raw text (free-flow unless anchored)
  chords: ChordEvent[];
  anchors: LyricAnchor[];
};

export type LeadSheetDoc = {
  version: 1;
  title: string;
  artist?: string;
  timeSignature: TimeSignature;
  subdivision: number; // cells per beat (1=beats, 2=8ths in 4/4, etc.)
  sections: Section[];
  updatedAt: string; // ISO timestamp
};