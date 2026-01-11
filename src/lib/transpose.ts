const SHARPS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const;
const FLATS  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"] as const;

export type AccidentalStyle = "sharps" | "flats";

export const NOTE_TO_PC: Record<string, number> = {
  C: 0, "B#": 0,
  "C#": 1, Db: 1,
  D: 2,
  "D#": 3, Eb: 3,
  E: 4, Fb: 4,
  F: 5, "E#": 5,
  "F#": 6, Gb: 6,
  G: 7,
  "G#": 8, Ab: 8,
  A: 9,
  "A#": 10, Bb: 10,
  B: 11, Cb: 11,
};

// Common major keys → preferred accidental style
export const KEY_TO_STYLE: Record<string, AccidentalStyle> = {
  C: "sharps",
  G: "sharps",
  D: "sharps",
  A: "sharps",
  E: "sharps",
  B: "sharps",
  "F#": "sharps",
  "C#": "sharps",

  F: "flats",
  Bb: "flats",
  Eb: "flats",
  Ab: "flats",
  Db: "flats",
  Gb: "flats",
  Cb: "flats",
};

export function semitoneDelta(fromKey: string, toKey: string): number {
  const fromPc = NOTE_TO_PC[fromKey];
  const toPc = NOTE_TO_PC[toKey];
  if (fromPc === undefined || toPc === undefined) return 0;
  return mod(toPc - fromPc, 12);
}

export function transposeChordSymbol(
  symbol: string,
  semitones: number,
  style: AccidentalStyle
): string {
  const trimmed = symbol.trim();
  if (!trimmed) return symbol;

  const [main, bass] = trimmed.split("/");

  const transMain = transposeRootInChord(main, semitones, style);
  const transBass = bass ? transposeNoteToken(bass, semitones, style) : "";

  return bass ? `${transMain}/${transBass}` : transMain;
}

function transposeRootInChord(
  chord: string,
  semitones: number,
  style: AccidentalStyle
): string {
  const m = chord.match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return chord;

  const rootToken = `${m[1]}${m[2] || ""}`;
  const rest = m[3] || "";

  const newRoot = transposeNoteToken(rootToken, semitones, style);
  return `${newRoot}${rest}`;
}

function transposeNoteToken(
  note: string,
  semitones: number,
  style: AccidentalStyle
): string {
  const pc = NOTE_TO_PC[note.trim()];
  if (pc === undefined) return note;

  const next = mod(pc + semitones, 12);
  return style === "flats" ? FLATS[next] : SHARPS[next];
}

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}
