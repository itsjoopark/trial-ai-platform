/* ============================================================================
   GET /api/trials?cond=&status=&pageSize=  —  live ClinicalTrials.gov proxy

   Seam #2 (the raw registry search). The browser can't call ClinicalTrials.gov
   directly (no CORS), so this route proxies it server-side and returns
   normalized Trial[]. Used for direct browsing / verification; the full
   reasoning path is /api/match.
   ========================================================================== */

import { NextResponse } from "next/server";
import { searchTrials } from "@/lib/ctgov";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cond = (searchParams.get("cond") ?? "").trim();
  if (!cond) {
    return NextResponse.json({ error: "A 'cond' query parameter is required." }, { status: 400 });
  }
  const status = searchParams.get("status") ?? "RECRUITING";
  const pageSize = Math.min(Number(searchParams.get("pageSize") ?? 30) || 30, 100);

  try {
    const trials = await searchTrials({ cond, status, pageSize });
    return NextResponse.json({ count: trials.length, trials });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ClinicalTrials.gov request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
