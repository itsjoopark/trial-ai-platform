/* ============================================================================
   POST /api/upload-pdf  —  patient PDF → plain text for extraction

   Extracts readable text from an uploaded medical document PDF so the same
   /api/extract flow can structure it into a patient profile.
   ========================================================================== */

import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A PDF file is required." }, { status: 400 });
  }
  if (!isPdf(file)) {
    return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That PDF file is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "PDF must be under 10 MB." }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const normalized = text.replace(/\s+/g, " ").trim();

    if (!normalized) {
      return NextResponse.json(
        { error: "No readable text found in that PDF. Try a text-based export or paste the note instead." },
        { status: 422 },
      );
    }

    return NextResponse.json({ text: normalized, fileName: file.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read that PDF.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
