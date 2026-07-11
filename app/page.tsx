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

import { useEffect, useRef, useState } from "react";
import AsciiBackground from "@/app/components/AsciiBackground";
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
  const appRef = useRef<HTMLDivElement>(null);

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
    <div className="app" ref={appRef}>
      <AsciiBackground trackRef={appRef} />
      {header}
      {phase === "landing" && <Landing note={note} setNote={setNote} onRead={readNote} />}
      {phase === "capture" && (
        <Capture note={note} profile={profile} busy={busy} error={error} onRetry={() => readNote(note)} onContinue={toClarify} />
      )}
      {phase === "clarify" && profile && (
        <Clarify profile={profile} step={step} onAnswer={answer} onBack={() => step > 0 && setStep(step - 1)} onSkip={() => answer("(skipped — flagged uncertain)")} />
      )}
      {phase === "confirm" && profile && <Confirm profile={profile} answers={answers} onFind={findTrials} />}
      {phase === "reason" && <Reason busy={busy} error={error} onRetry={findTrials} />}
      {phase === "results" && match && <Results data={match} />}
    </div>
  );
}

/* ============================ phase views ================================= */

function pickWelcomeGreeting(): string {
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  let returning = false;
  try {
    returning = !!localStorage.getItem("trial:visited");
    localStorage.setItem("trial:visited", "1");
  } catch {
    // storage unavailable (private mode, etc.)
  }

  const pool = [
    "Welcome",
    timeGreeting,
    "Good to see you",
    "Ready when you are",
    ...(returning ? (["Hey, you're back", "Welcome back"] as const) : []),
  ];

  return pool[Math.floor(Math.random() * pool.length)];
}

function Landing({ note, setNote, onRead }: { note: string; setNote: (s: string) => void; onRead: (s: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [greeting, setGreeting] = useState("Welcome");
  const [entered, setEntered] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    setGreeting(pickWelcomeGreeting());
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  async function handlePdfUpload(file: File) {
    setPdfError(null);
    setPdfBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload-pdf", { method: "POST", body: form });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not read that PDF.");
      const text = (data.text ?? "").trim();
      if (!text) throw new Error("No readable text found in that PDF.");
      setNote(text);
      onRead(text);
    } catch (e) {
      setPdfError(errMsg(e));
    } finally {
      setPdfBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div ref={scrollRef} className="scroll scroll--landing">
      <div className="col landing-col">
        <div className="hero">
          <h1 className={entered ? "in" : undefined} suppressHydrationWarning>
            {greeting}
          </h1>
          <p>
            Drop a messy note, upload a PDF, or describe the patient. I read it into a structured profile, ask only the questions that change a
            match, then screen live against recruiting ClinicalTrials.gov studies and show the inclusion/exclusion call for each one.
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
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handlePdfUpload(file);
                }}
              />
              <button className="btn" type="button" disabled={pdfBusy} onClick={() => fileRef.current?.click()}>
                {pdfBusy ? "Reading PDF…" : "Upload PDF"}
              </button>
              <button className="btn go" disabled={pdfBusy} onClick={() => onRead(note)}>
                Read the note →
              </button>
            </div>
            {pdfError && <p className="paste-err">{pdfError}</p>}
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
  onAnswer,
  onBack,
  onSkip,
}: {
  profile: Profile;
  step: number;
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

/* ---- preference controls: the patient-agency lever (transparent re-ranking) ---- */
type PrefKey = "near" | "established" | "open" | "burden";
const PREFS: { key: PrefKey; label: string; hint: string }[] = [
  { key: "near", label: "Stay near home", hint: "prioritize a site close to the patient" },
  { key: "established", label: "Established science", hint: "weight later-phase trials" },
  { key: "open", label: "Avoid randomization / placebo", hint: "down-rank blinded or randomized designs" },
  { key: "burden", label: "Lower burden", hint: "favor fewer visits and procedures (rough estimate)" },
];

function prefScore(m: TrialMatch, prefs: Set<PrefKey>): number {
  let s = 0;
  if (prefs.has("near")) s += m.factors.proximityScore * 2; // 0..6
  if (prefs.has("established")) s += m.factors.phaseRank; // 0..4
  if (prefs.has("open")) s += m.factors.randomized ? 0 : 3;
  if (prefs.has("burden")) s += 2 - m.factors.burdenProxy; // 0..2
  return s;
}

function prefReasons(m: TrialMatch, prefs: Set<PrefKey>): string[] {
  const r: string[] = [];
  if (prefs.has("near")) {
    if (m.factors.proximityScore >= 3) r.push(`site in ${m.factors.nearestSite}`);
    else if (m.factors.proximityScore === 2) r.push("a site in your state");
  }
  if (prefs.has("established") && m.factors.phaseRank >= 3) r.push(`later-phase (${m.phase})`);
  if (prefs.has("open") && !m.factors.randomized) r.push("open-label, no randomization");
  if (prefs.has("burden") && m.factors.burdenProxy === 0) r.push("observational — lower burden");
  return r;
}

function Results({ data }: { data: MatchResponse }) {
  const { counts, matches, conditionQuery } = data;
  const [prefs, setPrefs] = useState<Set<PrefKey>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const togglePref = (k: PrefKey) =>
    setPrefs((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const toggleSave = (nct: string) =>
    setSaved((s) => {
      const n = new Set(s);
      if (n.has(nct)) n.delete(nct);
      else n.add(nct);
      return n;
    });

  const consider = matches.filter((m) => m.status === "eligible" || m.status === "uncertain");
  const ruledOut = matches.filter((m) => m.status === "near");
  const screened = matches.filter((m) => m.status === "screened");

  // Preference re-ranking (agency) — transparent, over deterministic factors only.
  const active = prefs.size > 0;
  const ordered = active
    ? [...consider].sort(
        (a, b) => prefScore(b, prefs) - prefScore(a, prefs) || b.metCount / (b.total || 1) - a.metCount / (a.total || 1),
      )
    : consider;

  const savedList = matches.filter((m) => saved.has(m.nctId));

  return (
    <div className="scroll">
      <div className="col">
        <div className="agent-say">
          <span className="av">✳</span>
          <div className="body">
            <div className="who">Coordinating agent</div>
            <div className="summary">
              Screened <b>{counts.poolTotal} recruiting trials</b> for <span className="mono">{conditionQuery}</span> and reasoned over the top{" "}
              <b>{counts.reasoned}</b>. Here are the ones worth discussing with the care team — <b>{counts.eligible} eligible</b>, {counts.uncertain}{" "}
              that need info. Nothing here is a recommendation; it&apos;s to help weigh the options and know what to ask.
              <span className="live-flag">live · clinicaltrials.gov</span>
            </div>
          </div>
        </div>

        <div className="prefs">
          <div className="prefs-h">What matters most to this patient?</div>
          <div className="prefs-row">
            {PREFS.map((p) => (
              <button key={p.key} className={`pref ${prefs.has(p.key) ? "on" : ""}`} title={p.hint} onClick={() => togglePref(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          {active && <div className="prefs-note">Re-ordered by these priorities — based on trial facts, not a recommendation.</div>}
        </div>

        {savedList.length > 0 && (
          <div className="tray">
            <span className="tray-h">To discuss ({savedList.length})</span>
            {savedList.map((m) => (
              <span key={m.nctId} className="tray-chip mono">
                {m.nctId}
                <button onClick={() => toggleSave(m.nctId)} aria-label={`remove ${m.nctId}`}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="counts">
          <span className="count eligible">
            <b>{counts.eligible}</b> eligible
          </span>
          <span className="count uncertain">
            <b>{counts.uncertain}</b> to confirm
          </span>
          <span className="count near">
            <b>{counts.near}</b> ruled out
          </span>
          <span className="count">
            <b>{counts.screened}</b> screened
          </span>
        </div>

        {ordered.map((m) => (
          <DecisionCard key={m.nctId} m={m} saved={saved.has(m.nctId)} onSave={() => toggleSave(m.nctId)} reasons={active ? prefReasons(m, prefs) : []} />
        ))}

        {ruledOut.length > 0 && (
          <>
            <div className="section-h">
              Ruled out <span>— listed in full, fails closed</span>
            </div>
            {ruledOut.map((m) => (
              <DecisionCard key={m.nctId} m={m} saved={saved.has(m.nctId)} onSave={() => toggleSave(m.nctId)} reasons={[]} />
            ))}
          </>
        )}

        {screened.length > 0 && (
          <>
            <div className="section-h">
              Screened <span>— matched the condition &amp; recruiting filters, not deeply reasoned this pass</span>
            </div>
            <div className="screened-list">
              {screened.map((m) => (
                <a key={m.nctId} className="screened-row" href={m.url} target="_blank" rel="noopener noreferrer">
                  <span className="mono">{m.nctId}</span>
                  <span className="sr-title">{m.title}</span>
                  <span className="mono sr-phase">{m.phase}</span>
                </a>
              ))}
            </div>
          </>
        )}

        <div className="disclaimer" style={{ marginTop: 20 }}>
          Informational decision support for review with a care team — not medical advice, and it does not choose for you. Trial data is live from
          ClinicalTrials.gov; synthetic personas only, no real patient data.
        </div>
      </div>
    </div>
  );
}

/* ---- one trial as a decision card: brief-first, ledger grouped behind an accordion ---- */

function DecisionCard({ m, saved, onSave, reasons }: { m: TrialMatch; saved: boolean; onSave: () => void; reasons: string[] }) {
  const label = m.status === "eligible" ? "Eligible" : m.status === "uncertain" ? "Needs info" : "Ruled out";
  const near = m.status === "near";
  const tally = ledgerTally(m.criteria);

  return (
    <div className={`dcard ${m.status}`}>
      <div className="dc-head">
        <div className="dc-title">
          <a className="nct" href={m.url} target="_blank" rel="noopener noreferrer">
            {m.nctId} ↗
          </a>
          <div className="mt">{m.title}</div>
        </div>
        <div className="dc-actions">
          <span className={`vbadge ${badgeClass(m.status)}`}>{label}</span>
          <button className={`save ${saved ? "on" : ""}`} onClick={onSave}>
            {saved ? "★ Saved" : "☆ Save to discuss"}
          </button>
        </div>
      </div>

      {reasons.length > 0 && <div className="why">▲ moved up: {reasons.join(" · ")}</div>}

      {m.headline && <div className="headline">{m.headline}</div>}

      {!near && m.brief && (
        <>
          <div className="brief">
            <div className="bcol offer">
              <div className="bk">Could offer</div>
              <div className="bv">{m.brief.offers}</div>
            </div>
            <div className="bcol ask">
              <div className="bk">Asks of you</div>
              <div className="bv">{m.brief.commitment}</div>
            </div>
            <div className="bcol unc">
              <div className="bk">Still uncertain</div>
              <div className="bv">{m.brief.uncertainty}</div>
            </div>
          </div>
          {m.brief.questionsToAsk.length > 0 && (
            <div className="qask">
              <div className="qask-h">Questions to ask the care team</div>
              <ul>
                {m.brief.questionsToAsk.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="factors">
        <span className="fchip">{m.phase}</span>
        <span className="fchip">{m.factors.randomized ? "Randomized / placebo possible" : "Open-label"}</span>
        <span className="fchip" title="Approximate — matched on city/state">
          ◎ {m.factors.nearestSite}
        </span>
        {!m.interventional && <span className="fchip">Observational</span>}
      </div>

      {m.criteria.length > 0 && (
        <details className="ledger-d" open={near}>
          <summary>
            <span className="lsum-label">Eligibility reasoning</span>
            <span className="lsum-tally">
              {tally.met > 0 && <span className="t meets">{tally.met} met</span>}
              {tally.confirm > 0 && <span className="t unc">{tally.confirm} to confirm</span>}
              {tally.fails > 0 && <span className="t fails">{tally.fails} not met</span>}
            </span>
          </summary>
          <Ledger criteria={m.criteria} />
        </details>
      )}

      <div className="meta">
        <span>{m.sponsor}</span>
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

/* ---- the criterion ledger — grouped by verdict + filterable (the hierarchy) ---- */

type Group = "confirm" | "fails" | "met";
const GROUP_META: { key: Group; label: string; cls: string }[] = [
  { key: "confirm", label: "To confirm", cls: "unc" },
  { key: "fails", label: "Not met", cls: "fails" },
  { key: "met", label: "Met", cls: "meets" },
];
function groupOf(v: Verdict): Group {
  return v === "confirm" ? "confirm" : v === "fails" ? "fails" : "met";
}
function ledgerTally(criteria: Criterion[]) {
  return {
    met: criteria.filter((c) => c.verdict === "meets" || c.verdict === "clear").length,
    confirm: criteria.filter((c) => c.verdict === "confirm").length,
    fails: criteria.filter((c) => c.verdict === "fails").length,
  };
}

function Ledger({ criteria }: { criteria: Criterion[] }) {
  const [only, setOnly] = useState<Group | null>(null);
  const groups: Record<Group, Criterion[]> = { confirm: [], fails: [], met: [] };
  for (const c of criteria) groups[groupOf(c.verdict)].push(c);
  const shown = GROUP_META.filter((g) => groups[g.key].length > 0 && (!only || only === g.key));

  return (
    <div className="ledger">
      <div className="ledger-filter">
        {GROUP_META.filter((g) => groups[g.key].length > 0).map((g) => (
          <button key={g.key} className={`lchip ${g.cls} ${only === g.key ? "on" : ""}`} onClick={() => setOnly(only === g.key ? null : g.key)}>
            <b>{groups[g.key].length}</b> {g.label}
          </button>
        ))}
        {only && (
          <button className="lchip clear" onClick={() => setOnly(null)}>
            show all
          </button>
        )}
      </div>
      {shown.map((g) => (
        <div className="lgroup" key={g.key}>
          <div className={`lgh ${g.cls}`}>
            {g.label} · {groups[g.key].length}
          </div>
          {groups[g.key].map((c, i) => (
            <LedgerRow key={i} c={c} />
          ))}
        </div>
      ))}
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
