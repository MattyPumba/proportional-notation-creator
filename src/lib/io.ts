import type { LeadSheetDoc } from "./types";

export function downloadJson(doc: LeadSheetDoc, filenameBase: string) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(filenameBase || "leadsheet")}.leadsheet.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<LeadSheetDoc> {
  const text = await file.text();
  return JSON.parse(text) as LeadSheetDoc;
}

function slugify(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
