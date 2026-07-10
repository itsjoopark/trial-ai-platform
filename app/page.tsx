"use client";

/* ============================================================================
   Trial — the coordinator console (client state machine)

   Ports the prototype's phase flow to React and wires the three seams to real
   backends:
     landing → capture   POST /api/extract  (note → structured profile, Claude)
     clarify → confirm    the gaps that change a match
     reason  → results    POST /api/match   (live trials + per-criterion ledger)

   The criterion ledger, verdict triad, mono-for-data, disclaimer, theme toggle,
   and reduced-motion all come from the design system unchanged.
   ========================================================================== */

import { useEffect, useState } from "react";
import type { TrialMatch, Criterion, Verdict } from "@/lib/types";

/* ---- API response shapes ---- */
type ProfileField = { label: string; value: string; clinical: boolean; gap: boolean };
type Clarification = { id: string; question: string; rationale: string; options: string[] };
type Profile = {
  conditionQuery: string;
  summary: string;
  fields: ProfileField[];
  clarifications: Clarification[];
};
type Counts = {
  poolTotal: number;
  reasoned: number;
  eligible: number;
  uncertain: number;
  near: number;
  screened: number;
};
type MatchResponse = { conditionQuery: string; summary: string; counts: Counts; matches: TrialMatch[] };

type Phase = "landing" | "capture" | "clarify" | "confirm" | "reason" | "results";

const SAMPLE_NOTE = `61F, ECOG 1. HR-positive (ER 90%, PR 60%), HER2-negative (IHC 1+) metastatic breast ca, stage IV. 1L letrozole+palbociclib (3/2024) → PD 12/2025. 2L fulvestrant (1/2026) → PD 6/2026. Trial of pembrolizumab on a prior protocol. PIK3CA H1047R+, BRCA wt. Boston MA.`;

const PHASES: [Phase, string][] = [
  ["capture", "Capture"],
  ["clarify", "Clarify"],
  ["confirm", "Confirm"],
  ["results", "Results"],
];
const ORDER: Phase[] = ["landing", "capture", "clarify", "confirm", "reason", "results"];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [note, setNote] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  /* ---- transitions ---- */

  async function readNote(text: string) {
    const t = text.trim();
    if (!t) return;
    setNote(t);
    setProfile(null);
    setAnswers({});
    setStep(0);
    setMatch(null);
    setError(null);
    setPhase("capture");
    setBusy(true);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: t }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed.");
      setProfile(data.profile as Profile);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function toClarify() {
    if (profile && profile.clarifications.length > 0) {
      setStep(0);
      setPhase("clarify");
    } else {
      setPhase("confirm");
    }
  }

  function answer(value: string) {
    if (!profile) return;
    const c = profile.clarifications[step];
    setAnswers((a) => ({ ...a, [c.id]: value }));
    const next = step + 1;
    if (next >= profile.clarifications.length) setPhase("confirm");
    else setStep(next);
  }

  async function findTrials() {
    if (!profile) return;
    setError(null);
    setPhase("reason");
    setBusy(true);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conditionQuery: profile.conditionQuery,
          summary: profile.summary,
          fields: profile.fields.map((f) => ({ label: f.label, value: f.value })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Matching failed.");
      setMatch(data as MatchResponse);
      setPhase("results");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setPhase("landing");
    setNote("");
    setProfile(null);
    setAnswers({});
    setStep(0);
    setMatch(null);
    setError(null);
  }

  /* ---- header ---- */
  const cur = ORDER.indexOf(phase);
  const header = (
    <div className="top">
      <span className="brand">
        <span className="mk" />
        Trial <small>console</small>
      </span>
      <span className="phasetrack">
        {PHASES.map(([id, label], i) => {
          const idx = ORDER.indexOf(id);
          const on = phase === id || (id === "results" && phase === "reason");
          const cls = on ? "on" : idx < cur ? "done" : "";
          return (
            <span key={id} style={{ display: "contents" }}>
              {i > 0 && <span className="sep" />}
              <span className={`p ${cls}`}>
                <b>{label}</b>
              </span>
            </span>
          );
        })}
      </span>
      <button className="tbtn" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
        {theme === "dark" ? "☀ Light" : "☾ Dark"}
      </button>
      <button className="tbtn" onClick={restart}>
        Restart
      </button>
    </div>
  );

  return (
    <div className="app">
      {header}
      {phase === "landing" && <Landing note={note} setNote={setNote} onRead={readNote} />}
      {phase === "capture" && (
        <Capture note={note} profile={profile} busy={busy} error={error} onRetry={() => readNote(note)} onContinue={toClarify} />
      )}
      {phase === "clarify" && profile && (
        <Clarify profile={profile} step={step} answers={answers} onAnswer={answer} onBack={() => step > 0 && setStep(step - 1)} onSkip={() => answer("(skipped — flagged uncertain)")} />
      )}
      {phase === "confirm" && profile && <Confirm profile={profile} answers={answers} onFind={findTrials} />}
      {phase === "reason" && <Reason busy={busy} error={error} onRetry={findTrials} />}
      {phase === "results" && match && <Results data={match} />}
    </div>
  );
}

/* ============================ phase views ================================= */

function Landing({ note, setNote, onRead }: { note: string; setNote: (s: string) => void; onRead: (s: string) => void }) {
  return (
    <div className="scroll">
      <div className="col">
        <div className="hero">
          <div className="k">Coordinator screening · single patient</div>
          <h1>Paste a patient&apos;s notes. I&apos;ll surface the trials they&apos;re eligible for — with the reasoning for every match.</h1>
          <p>
            Drop a messy note or describe the patient. I read it into a structured profile, ask only the questions that change a match, then
            screen live against recruiting ClinicalTrials.gov studies and show the inclusion/exclusion call for each one.
          </p>
          <div className="paste">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  onRead(note);
                }
              }}
              placeholder="Paste a patient note or describe the patient…"
            />
            <div className="row">
              <span className="hint">⌘↵ to send</span>
              <span className="sp" />
              <button className="btn go" onClick={() => onRead(note)}>
                Read the note →
              </button>
            </div>
          </div>
          <div className="chips">
            <button className="chip" onClick={() => onRead(SAMPLE_NOTE)}>
              <span className="s">demo</span> Try a sample patient (Margaret)
            </button>
            <button className="chip" onClick={() => setNote(SAMPLE_NOTE)}>
              Paste example note
            </button>
          </div>
          <div className="disclaimer" style={{ marginTop: 20 }}>
            Informational decision support for a coordinator&apos;s review — not medical advice or a final eligibility determination. Trial data is
            live from ClinicalTrials.gov; use synthetic personas only, no real patient data.
          </div>
        </div>
      </div>
    </div>
  );
}

function Capture({
  note,
  profile,
  busy,
  error,
  onRetry,
  onContinue,
}: {
  note: string;
  profile: Profile | null;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const gaps = profile?.fields.filter((f) => f.gap).length ?? 0;
  const clar = profile?.clarifications.length ?? 0;
  return (
    <div className="scroll">
      <div className="col">
        <div className="umsg">
          <div className="bub">Screen this patient for recruiting trials she&apos;s eligible for.</div>
        </div>
        <div className="agent-say">
          <span className="av">✳</span>
          <div className="body">
            <div className="who">Coordinating agent · reading the note</div>
            <div className="note-src">{note}</div>
            {error ? (
              <div className="err">
                <b>Couldn&apos;t read the note.</b> {error}
                <div className="retry">
                  <button className="btn" onClick={onRetry}>
                    Try again
                  </button>
                </div>
              </div>
            ) : busy || !profile ? (
              <div className="readout">
                <div className="rh">
                  <span className="pulse" /> Building structured profile
                </div>
                <div style={{ padding: "14px 15px" }}>
                  <div className="working">
                    <span className="dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    reasoning over the note…
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="readout">
                  <div className="rh">
                    <span className="pulse" /> Structured profile · {profile.conditionQuery}
                  </div>
                  {profile.fields.map((f, i) => (
                    <div className="frow" key={i}>
                      <span className="k">{f.label}</span>
                      <span className="v">
                        {f.gap ? (
                          <span className="gap">{f.value}</span>
                        ) : f.clinical ? (
                          <span className="mono">{f.value}</span>
                        ) : (
                          f.value
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="continue-row">
                  <button className="btn go" onClick={onContinue}>
                    {clar > 0 ? "Continue — a few quick questions" : "Continue — confirm the profile"}
                  </button>
                  <span className="n">
                    {gaps > 0 ? `${gaps} gap${gaps > 1 ? "s" : ""} found · ` : ""}
                    {clar > 0 ? `${clar} question${clar > 1 ? "s" : ""} that change a match` : "no blocking gaps"}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Clarify({
  profile,
  step,
  answers,
  onAnswer,
  onBack,
  onSkip,
}: {
  profile: Profile;
  step: number;
  answers: Record<string, string>;
  onAnswer: (v: string) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const list = profile.clarifications;
  const c = step < list.length ? list[step] : null;
  return (
    <div className="scroll">
      <div className="col">
        <div className="agent-say">
          <span className="av">✳</span>
          <div className="body">
            <div className="who">Coordinating agent</div>
            <div>Profile&apos;s in. I only need the gaps that actually change which trials qualify:</div>
          </div>
        </div>
        <div className="qlist">
          {list.map((q) => {
            const a = answers[q.id];
            return (
              <div className={`qcard ${a ? "answered" : ""}`} key={q.id}>
                <div className="q">{q.question}</div>
                {a ? <div className="ans">✓ {a}</div> : <div className="await">Awaiting your answer…</div>}
              </div>
            );
          })}
        </div>
        {c && <ClarifyCard c={c} step={step} total={list.length} onAnswer={onAnswer} onBack={onBack} onSkip={onSkip} />}
      </div>
    </div>
  );
}

function ClarifyCard({
  c,
  step,
  total,
  onAnswer,
  onBack,
  onSkip,
}: {
  c: Clarification;
  step: number;
  total: number;
  onAnswer: (v: string) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [own, setOwn] = useState("");
  return (
    <div className="clarify">
      <div className="steps">
        <div className="dots">
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i <= step ? "on" : ""} />
          ))}
        </div>
        <div className="stepno">
          {step + 1} of {total}
        </div>
      </div>
      <div className="cq">{c.question}</div>
      <div className="cw">{c.rationale}</div>
      {c.options.map((o, i) => (
        <div key={i}>
          <div className="opt" onClick={() => onAnswer(o)}>
            <div className="num">{i + 1}</div>
            <div>
              <div className="ot">{o}</div>
            </div>
          </div>
          <div className="divl" />
        </div>
      ))}
      <div className="opt agent" onClick={() => onAnswer("Let the agent decide from the note")}>
        <div className="num">⤳</div>
        <div>
          <div className="ot">Let the agent decide from the note</div>
        </div>
      </div>
      <div className="cfoot">
        <div className="own">
          <span>✎</span>
          <input
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && own.trim()) {
                e.preventDefault();
                onAnswer(own.trim());
              }
            }}
            placeholder="Or type your own answer…"
          />
        </div>
        {step > 0 && (
          <button className="ghost" onClick={onBack}>
            ← Back
          </button>
        )}
        <button className="ghost" onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  );
}

function Confirm({ profile, answers, onFind }: { profile: Profile; answers: Record<string, string>; onFind: () => void }) {
  const applied = Object.keys(answers).length;
  return (
    <div className="scroll">
      <div className="col">
        <div className="agent-say">
          <span className="av">✳</span>
          <div className="body">
            <div className="who">Coordinating agent · trust checkpoint</div>
            <div>
              Here&apos;s the structured patient I&apos;ll screen with. This is the record every eligibility call is checked against — I&apos;ll
              search live for <span className="mono">{profile.conditionQuery}</span>.
            </div>
          </div>
        </div>
        <div className="profile">
          {profile.fields.map((f, i) => (
            <div className={`prow ${f.gap ? "" : ""}`} key={i}>
              <span className="k">{f.label}</span>
              <span className="v">{f.clinical ? <span className="mono">{f.value}</span> : f.value}</span>
              <button className="edit">edit</button>
            </div>
          ))}
        </div>
        <div className="continue-row">
          <button className="btn go" onClick={onFind}>
            Looks right — find trials →
          </button>
          <span className="n">
            {applied > 0 ? `${applied} answer${applied > 1 ? "s" : ""} applied · ` : ""}
            reasoning over the top 10 recruiting matches
          </span>
        </div>
      </div>
    </div>
  );
}

function Reason({ busy, error, onRetry }: { busy: boolean; error: string | null; onRetry: () => void }) {
  const lines = [
    "Querying recruiting studies on ClinicalTrials.gov…",
    "Applying structural gates (condition · recruiting · phase)…",
    "Segmenting eligibility prose into atomic criteria…",
    "Reasoning criterion-by-criterion against the profile…",
    "Forcing “confirm” where the record is silent · failing closed on near-misses…",
  ];
  return (
    <div className="scroll">
      <div className="col">
        <div className="agent-say">
          <span className="av">✳</span>
          <div className="body">
            <div className="who">Coordinating agent · screening</div>
            {error ? (
              <div className="err">
                <b>Screening failed.</b> {error}
                <div className="retry">
                  <button className="btn" onClick={onRetry}>
                    Try again
                  </button>
                </div>
              </div>
            ) : (
              <div className="reason">
                {lines.map((l, i) => (
                  <div className="l" key={i} style={{ animationDelay: `${i * 0.35}s` }}>
                    <span className="t">·</span>
                    <span>{l}</span>
                  </div>
                ))}
                {busy && (
                  <div className="working" style={{ marginTop: 10 }}>
                    <span className="dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    reasoning live — this runs one Claude call per trial…
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Results({ data }: { data: MatchResponse }) {
  const { counts, matches, conditionQuery, summary } = data;
  return (
    <div className="scroll">
      <div className="col">
        <div className="agent-say">
          <span className="av">✳</span>
          <div className="body">
            <div className="who">Coordinating agent</div>
            <div className="summary">
              {summary ? <>{summary} </> : null}
              Screened <b>{counts.poolTotal} recruiting trials</b> for <span className="mono">{conditionQuery}</span>; reasoned over the top{" "}
              <b>{counts.reasoned}</b>. <b>{counts.eligible} eligible</b>, {counts.uncertain} need info, {counts.near} near-miss (fails closed).
              Every call is shown against its criterion.
              <span className="live-flag">live · clinicaltrials.gov</span>
            </div>
          </div>
        </div>

        <div className="counts">
          <span className="count eligible">
            <b>{counts.eligible}</b> eligible
          </span>
          <span className="count uncertain">
            <b>{counts.uncertain}</b> to confirm
          </span>
          <span className="count near">
            <b>{counts.near}</b> near-miss
          </span>
          <span className="count">
            <b>{counts.screened}</b> screened
          </span>
        </div>

        <div className="mcount">
          Ranked by criteria met · {counts.reasoned} of {counts.poolTotal} deeply reasoned this pass
        </div>

        {matches.filter((m) => m.status !== "screened").map((m) => (
          <MatchCard key={m.nctId} m={m} />
        ))}

        {matches.some((m) => m.status === "screened") && (
          <>
            <div className="screened-note">
              Screened — matched the condition and recruiting filters, not yet reasoned in this pass. Raise the reasoning depth to include them.
            </div>
            {matches.filter((m) => m.status === "screened").map((m) => (
              <MatchCard key={m.nctId} m={m} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ---- one trial + its criterion ledger (the signature component) ---- */

function MatchCard({ m }: { m: TrialMatch }) {
  const label =
    m.status === "eligible" ? "Eligible" : m.status === "near" ? "Near-miss" : m.status === "uncertain" ? "Needs info" : "Screened";
  const lead = m.status === "eligible";
  const n = m.locations.length;
  const first = m.locations[0];
  const place = first ? [first.city, first.state].filter(Boolean).join(", ") || first.country : "";
  const locs = n === 0 ? "Location TBD" : `${n} site${n > 1 ? "s" : ""}${place ? ` · ${place}` : ""}`;

  return (
    <div className={`match ${lead ? "lead" : ""} ${m.status === "screened" ? "screened" : ""}`}>
      <div className="mh">
        <div>
          <div className="nct">{m.nctId}</div>
          <div className="mt">{m.title}</div>
        </div>
        <span className={`vbadge ${badgeClass(m.status)}`}>{label}</span>
      </div>

      {m.headline && <div className="headline">{m.headline}</div>}

      {m.criteria.length > 0 && (
        <div className="crit">
          {m.criteria.map((c, i) => (
            <LedgerRow key={i} c={c} />
          ))}
        </div>
      )}

      <div className="meta">
        <span>{m.phase}</span>
        <span>{m.sponsor}</span>
        <span className="locs site">{locs}</span>
        {m.total > 0 && (
          <span className="mono">
            {m.metCount}/{m.total} met
          </span>
        )}
        <a href={m.url} target="_blank" rel="noopener noreferrer">
          {m.nctId} ↗
        </a>
      </div>
    </div>
  );
}

function LedgerRow({ c }: { c: Criterion }) {
  const cls = verdictRowClass(c.verdict);
  return (
    <div className={`crow ${cls}`}>
      <span className="cd">{verdictGlyph(c.verdict)}</span>
      <span className={`ck ${c.kind}`}>{c.kind}</span>
      <span className="cx">
        {c.requirement}
        {c.evidence ? <span className="ev">{c.evidence}</span> : null}
      </span>
      <span className="verdict">{c.verdict}</span>
    </div>
  );
}

/* ---- verdict → visual mapping ---- */
function verdictRowClass(v: Verdict): string {
  return v === "fails" ? "fails" : v === "confirm" ? "unc" : "meets";
}
function verdictGlyph(v: Verdict): string {
  return v === "fails" ? "✕" : v === "confirm" ? "?" : "✓";
}
function badgeClass(status: TrialMatch["status"]): string {
  return status === "eligible" ? "eligible" : status === "near" ? "near" : status === "uncertain" ? "uncertain" : "screened";
}
