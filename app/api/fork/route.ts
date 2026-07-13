/* ============================================================================
   POST /api/fork  —  a hypothetical next treatment × the already-reasoned trials

   The payoff (intake-prd §6.3). For a chosen next line of treatment, judge — for
   each trial the patient is CURRENTLY open to — whether starting that treatment
   keeps the door open or closes it, and cite the exact criterion that drives it.

   Design constraints (all from the PRD):
   - REUSE the existing criterion ledgers. We do NOT redo full eligibility
     reasoning; we pass each trial's already-judged criteria and ask only the
     forward-looking "does this treatment trip any of them?" question.
   - Per-trial citation is mandatory: every stays_open/closes cites the specific
     inclusion/exclusion criterion. Precedent for judgment, never a bare oracle.
   - Fail closed, same as /api/match: if the record can't support the call, it's
     "confirm" — never guessed into stays_open or closes.
   - Accepts one option (a chosen treatment) OR many (the "nothing decided yet"
     tree). One model call per option, bounded concurrency, like /api/match.
   ========================================================================== */

import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODEL } from "@/lib/anthropic";
import { ForkResultSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONCURRENCY = 4; // simultaneous per-option model calls

const SYSTEM = `You are the coordinating agent for Trialign. A patient is looking at the clinical trials they may qualify for TODAY. You are told ONE treatment they might start NEXT, and — for each trial — the eligibility criteria that were already judged relevant to this patient.

Your only job: if the patient starts this next treatment, does each trial STAY OPEN or CLOSE, and which criterion drives that?

How to judge each trial (reuse the given criteria — do not invent new ones):
- closes: starting this treatment would newly TRIGGER an exclusion (e.g. an exclusion like "no prior AKT inhibitor" when the treatment is an AKT inhibitor; "no prior PI3K/AKT/mTOR inhibitor" for alpelisib/capivasertib/everolimus) OR newly VIOLATE an inclusion (e.g. "≤ 2 prior lines of therapy" when this treatment would be the patient's 3rd line). Cite that criterion verbatim.
- stays_open: no given criterion is tripped by starting this treatment. The trial remains an option. Cite the most relevant criterion, or leave it empty if genuinely none applies.
- confirm: you cannot tell from the given criteria and profile whether it trips — the honest answer. Never guess a door.

Hard rules:
- Fail closed. If unsure, "confirm" — never a guessed stays_open or closes.
- Cite the SPECIFIC criterion (verbatim from the trial's list) that produced the call, and say plainly why the treatment relates to it. No efficacy or benefit claims — you are only reasoning about eligibility doors.
- Return exactly one verdict per trial, in the SAME order given. Do not add, drop, merge, or reorder.
- This is not advice and not a reason to change treatment. You are surfacing which doors are time-sensitive, for the patient to raise with their oncologist.`;

type ForkTrial = {
  nctId: string;
  title?: string;
  phase?: string;
  criteria?: { kind: "incl" | "excl"; requirement: string; verdict: string; evidence: string }[];
};
type ForkOption = { id: string; label: string; drugClass?: string };
type Body = {
  profile?: { summary?: string; fields?: { label: string; value: string }[] };
  options?: ForkOption[];
  trials?: ForkTrial[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const options = (body.options ?? []).filter((o) => o.label?.trim());
  const trials = (body.trials ?? []).filter((t) => t.nctId);
  if (options.length === 0) return NextResponse.json({ error: "At least one treatment option is required." }, { status: 400 });
  if (trials.length === 0) return NextResponse.json({ error: "At least one reasoned trial is required." }, { status: 400 });

  const profileText = renderProfile(body.profile ?? {});
  const trialsText = trials
    .map((t, i) => {
      const crits = (t.criteria ?? [])
        .map((c) => `    - [${c.kind}] ${c.requirement}${c.evidence ? ` (currently: ${c.evidence})` : ""}`)
        .join("\n");
      return `${i + 1}. ${t.nctId} — ${t.title ?? ""}${t.phase ? ` (Phase ${t.phase})` : ""}\n${crits || "    - (no criteria on file)"}`;
    })
    .join("\n\n");

  try {
    const client = anthropic();
    const results = await mapPool(options, CONCURRENCY, async (opt) => {
      const doors = await judgeOption(client, profileText, opt, trials, trialsText);
      return { optionId: opt.id, optionLabel: opt.label, doors };
    });
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fork reasoning failed.";
    const status = message.includes("ANTHROPIC_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

async function judgeOption(
  client: ReturnType<typeof anthropic>,
  profileText: string,
  option: ForkOption,
  trials: ForkTrial[],
  trialsText: string,
) {
  const msg = await client.messages.parse({
    model: MODEL,
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    output_config: { format: zodOutputFormat(ForkResultSchema) },
    messages: [
      {
        role: "user",
        content:
          `PATIENT PROFILE\n${profileText}\n\n` +
          `NEXT TREATMENT THE PATIENT MIGHT START\n${option.label}${option.drugClass ? ` — ${option.drugClass}` : ""}\n\n` +
          `TRIALS THE PATIENT IS OPEN TO TODAY (judge a door for each, in this order)\n${trialsText}`,
      },
    ],
  });

  const doors = msg.parsed_output?.doors ?? [];
  // Never let a length/order mismatch corrupt alignment: rebuild strictly against
  // the input trials, matching by nctId when possible, else falling back to
  // "confirm" (the fail-closed default) for any trial the model didn't return.
  const byId = new Map(doors.map((d) => [d.nctId, d]));
  return trials.map((t, i) => {
    const d = byId.get(t.nctId) ?? doors[i];
    return d
      ? { nctId: t.nctId, door: d.door, criterion: d.criterion, kind: d.kind, reason: d.reason }
      : { nctId: t.nctId, door: "confirm" as const, criterion: "", kind: "incl" as const, reason: "Not enough information to judge this door." };
  });
}

function renderProfile(profile: { summary?: string; fields?: { label: string; value: string }[] }): string {
  const lines: string[] = [];
  if (profile.summary) lines.push(profile.summary, "");
  for (const f of profile.fields ?? []) lines.push(`${f.label}: ${f.value}`);
  return lines.join("\n");
}

/** Run fn over items with at most `limit` in flight; preserves input order.
 *  (Same bounded-concurrency shape as /api/match's mapPool.) */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}
