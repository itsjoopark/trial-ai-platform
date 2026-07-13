/* ============================================================================
   /api/connect-records  —  patient-mediated SMART on FHIR record import

   The record-import moat (record-import-prd.md §7): the patient authorizes a
   pull of their own chart, we retrieve the resources we match on, flatten them
   into a provenance-delimited document, and hand it to /api/extract — same
   downstream pipeline, richer input.

     GET   → the connect picker: live sandbox patients + bundled mCODE patients
     POST  → pull one patient → { document, meta } (document feeds /api/extract)

   Demo-mode guardrail (PRD §8): live pulls hit the public SMART Health IT open
   sandbox only (synthetic patients, zero real PHI) — never a production EHR.
   ========================================================================== */

import { NextResponse } from "next/server";
import { FHIR_BASE, listPatients, pullLivePatient } from "@/lib/fhir/client";
import { bundledDocument, listBundled } from "@/lib/fhir/testPatients";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  // Bundled patients always available; live list is best-effort (sandbox may be down).
  const bundled = listBundled();
  let live: Awaited<ReturnType<typeof listPatients>> = [];
  let liveError: string | null = null;
  try {
    live = await listPatients();
  } catch (err) {
    liveError = err instanceof Error ? err.message : "Could not reach the sandbox.";
  }
  return NextResponse.json({ base: FHIR_BASE, live, liveError, bundled });
}

export async function POST(req: Request) {
  let source: "live" | "bundled";
  let id: string;
  try {
    const body = (await req.json()) as { source?: string; id?: string };
    source = body.source === "bundled" ? "bundled" : "live";
    id = (body.id ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!id) {
    return NextResponse.json({ error: "A patient id is required." }, { status: 400 });
  }

  try {
    const record = source === "bundled" ? await bundledDocument(id) : await pullLivePatient(id);
    if (!record) {
      return NextResponse.json({ error: "That test patient was not found." }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Record import failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
