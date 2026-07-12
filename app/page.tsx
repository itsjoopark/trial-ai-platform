"use client";

/* ============================================================================
   Trial — patient-first client state machine

   Portal home + landing are the front door (top header + portal tabs). Once the
   patient enters the flow, the app switches to a Claude-desktop-style workspace
   shell (persistent left sidebar + main board):

     home → landing → capture(extract) → survey(preferences) →
     clarify(AI gaps, if any) → review(+consent) → reason → results

   The criterion ledger stays the signature and the evidence; the decision brief,
   preferences, and geography grouping are the patient-facing decision layer.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import AgentAvatar from "@/app/components/AgentAvatar";
import AsciiBackground from "@/app/components/AsciiBackground";
import ProductCarousel from "@/app/components/ProductCarousel";
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

type PortalMode = "patient" | "clinician" | "partner";
type Phase = "home" | "landing" | "capture" | "survey" | "clarify" | "confirm" | "reason" | "results";

/* Phases that render inside the workspace shell (sidebar + main). */
const SHELL_PHASES: Phase[] = ["capture", "survey", "clarify", "confirm", "reason", "results"];

const PORTAL_MODES: [PortalMode, string][] = [
  ["patient", "Patient"],
  ["clinician", "Clinician"],
  ["partner", "Business Partner"],
];
const MODE_BADGE: Record<PortalMode, string> = { patient: "patient", clinician: "clinician", partner: "partner" };

/* ---- deterministic intake survey (patient preferences) ---- */
type TravelPref = "local" | "regional" | "any";
type StudyPref = "treatment" | "observational" | "either";
type RandPref = "avoid" | "open" | "none";
type SurveyPrefs = { travel: TravelPref | null; studyType: StudyPref | null; randomization: RandPref | null };
const EMPTY_SURVEY: SurveyPrefs = { travel: null, studyType: null, randomization: null };

/* results filters */
type StudyFilter = "all" | "treatment" | "observational";

/* sidebar step tracker */
const STEPS: { key: "note" | "prefs" | "matches"; label: string }[] = [
  { key: "note", label: "Your note" },
  { key: "prefs", label: "Preferences" },
  { key: "matches", label: "Matches" },
];
function stepKey(phase: Phase): "note" | "prefs" | "matches" {
  if (phase === "capture") return "note";
  if (phase === "survey" || phase === "clarify" || phase === "confirm") return "prefs";
  return "matches";
}

const SAMPLE_NOTE = `61F, ECOG 1. HR-positive (ER 90%, PR 60%), HER2-negative (IHC 1+) metastatic breast ca, stage IV. 1L letrozole+palbociclib (3/2024) → PD 12/2025. 2L fulvestrant (1/2026) → PD 6/2026. Trial of pembrolizumab on a prior protocol. PIK3CA H1047R+, BRCA wt. Boston MA.`;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("home");
  const [portalMode, setPortalMode] = useState<PortalMode>("patient");
  const [note, setNote] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // intake preferences + results controls (lifted so the sidebar and board share them)
  const [survey, setSurvey] = useState<SurveyPrefs>(EMPTY_SURVEY);
  const [consent, setConsent] = useState(false);
  const [prefs, setPrefs] = useState<Set<PrefKey>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [studyFilter, setStudyFilter] = useState<StudyFilter>("all");

  const appRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  /* ---- transitions ---- */

  function resetIntake() {
    setNote("");
    setProfile(null);
    setAnswers({});
    setStep(0);
    setMatch(null);
    setError(null);
    setSurvey(EMPTY_SURVEY);
    setConsent(false);
    setPrefs(new Set());
    setSaved(new Set());
    setStudyFilter("all");
  }

  async function readNote(text: string) {
    const t = text.trim();
    if (!t) return;
    resetIntake();
    setNote(t);
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

  function submitSurvey(s: SurveyPrefs) {
    setSurvey(s);
    // Seed the results controls from the survey — this is what makes preferences bite.
    const seeded = new Set<PrefKey>();
    if (s.travel && s.travel !== "any") seeded.add("near");
    if (s.randomization === "avoid") seeded.add("open");
    setPrefs(seeded);
    setStudyFilter(s.studyType === "treatment" ? "treatment" : s.studyType === "observational" ? "observational" : "all");
    // Advance: a short AI clarify only if the note left genuine gaps.
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
    if (!profile || !consent) return;
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

  function goHome() {
    setPhase("home");
    resetIntake();
  }
  function newSearch() {
    resetIntake();
    setPhase("landing");
  }
  function selectMode(mode: PortalMode) {
    setPortalMode(mode);
    if (mode !== "patient" && phase !== "home") goHome();
  }
  function enterPortal() {
    if (portalMode === "patient") setPhase("landing");
  }

  /* ---- top header (home + landing only) ---- */
  const header = (
    <div className="top">
      <div className="top-left">
        <button type="button" className="brand brand-btn" onClick={goHome}>
          <span className="mk" />
          Trial <small>{MODE_BADGE[portalMode]}</small>
        </button>
      </div>
      <div className="mode-switch" role="tablist" aria-label="Portal mode">
        {PORTAL_MODES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={portalMode === id}
            className={`mode-switch__btn${portalMode === id ? " on" : ""}`}
            onClick={() => selectMode(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="top-right">
        <span className="top-actions">
          <span className="demo-badge" title="This is a demonstration. Do not enter real patient information.">
            DEMO · SYNTHETIC DATA ONLY
          </span>
          <button
            className="tbtn tbtn-icon"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </span>
      </div>
    </div>
  );

  const inShell = SHELL_PHASES.includes(phase);

  return (
    <div className="app" ref={appRef}>
      <AsciiBackground trackRef={appRef} />

      {inShell ? (
        <div className="shell">
          <Sidebar
            phase={phase}
            profile={profile}
            theme={theme}
            onTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            onHome={goHome}
            onNewSearch={newSearch}
            showControls={phase === "results"}
            prefs={prefs}
            onTogglePref={togglePref}
            studyFilter={studyFilter}
            onStudyFilter={setStudyFilter}
            saved={saved}
            onToggleSave={toggleSave}
            matches={match?.matches ?? []}
          />
          <div className="shell-main">
            {phase === "capture" && (
              <Capture note={note} profile={profile} busy={busy} error={error} onRetry={() => readNote(note)} onContinue={() => setPhase("survey")} />
            )}
            {phase === "survey" && <Survey initial={survey} onSubmit={submitSurvey} onBack={() => setPhase("capture")} />}
            {phase === "clarify" && profile && (
              <Clarify profile={profile} step={step} onAnswer={answer} onBack={() => step > 0 && setStep(step - 1)} onSkip={() => answer("(skipped — flagged uncertain)")} />
            )}
            {phase === "confirm" && profile && (
              <Review profile={profile} answers={answers} consent={consent} onConsent={setConsent} onFind={findTrials} />
            )}
            {phase === "reason" && <Reason busy={busy} error={error} onRetry={findTrials} />}
            {phase === "results" && match && (
              <Results data={match} prefs={prefs} saved={saved} onToggleSave={toggleSave} studyFilter={studyFilter} survey={survey} />
            )}
            <AppFooter />
          </div>
        </div>
      ) : (
        <>
          {header}
          <div className="app-main">
            {phase === "home" && <Home mode={portalMode} onEnter={enterPortal} onSelectPatient={() => selectMode("patient")} />}
            {phase === "landing" && <Landing note={note} setNote={setNote} onRead={readNote} />}
            <AppFooter />
          </div>
        </>
      )}
    </div>
  );
}

/* ============================ workspace shell ============================= */

function Sidebar({
  phase,
  profile,
  theme,
  onTheme,
  onHome,
  onNewSearch,
  showControls,
  prefs,
  onTogglePref,
  studyFilter,
  onStudyFilter,
  saved,
  onToggleSave,
  matches,
}: {
  phase: Phase;
  profile: Profile | null;
  theme: "light" | "dark";
  onTheme: () => void;
  onHome: () => void;
  onNewSearch: () => void;
  showControls: boolean;
  prefs: Set<PrefKey>;
  onTogglePref: (k: PrefKey) => void;
  studyFilter: StudyFilter;
  onStudyFilter: (f: StudyFilter) => void;
  saved: Set<string>;
  onToggleSave: (n: string) => void;
  matches: TrialMatch[];
}) {
  const active = stepKey(phase);
  const doneUpTo = STEPS.findIndex((s) => s.key === active);
  const savedList = matches.filter((m) => saved.has(m.nctId));
  const studyOpts: [StudyFilter, string][] = [
    ["all", "All"],
    ["treatment", "Treatment"],
    ["observational", "Observational"],
  ];

  return (
    <aside className="sidebar">
      <button type="button" className="sb-brand" onClick={onHome}>
        <span className="mk" />
        Trial <small>patient</small>
      </button>

      <div className="demo-badge sb-demo">DEMO · SYNTHETIC DATA ONLY</div>

      <button type="button" className="sb-new" onClick={onNewSearch}>
        + New search
      </button>

      <nav className="sb-steps" aria-label="Progress">
        {STEPS.map((s, i) => (
          <div key={s.key} className={`sb-step ${s.key === active ? "on" : i < doneUpTo ? "done" : ""}`}>
            <span className="sb-step-dot" />
            {s.label}
          </div>
        ))}
      </nav>

      {showControls && (
        <div className="sb-controls">
          <div className="sb-sec">
            <div className="sb-h">Study type</div>
            <div className="seg">
              {studyOpts.map(([val, label]) => (
                <button key={val} className={`seg-btn ${studyFilter === val ? "on" : ""}`} onClick={() => onStudyFilter(val)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="sb-sec">
            <div className="sb-h">Priorities</div>
            <div className="sb-prefs">
              {PREFS.map((p) => (
                <button key={p.key} className={`pref ${prefs.has(p.key) ? "on" : ""}`} title={p.hint} onClick={() => onTogglePref(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sb-sec">
            <div className="sb-h">To discuss{savedList.length > 0 ? ` (${savedList.length})` : ""}</div>
            {savedList.length === 0 ? (
              <p className="sb-empty">Star a trial to add it here.</p>
            ) : (
              <div className="sb-saved">
                {savedList.map((m) => (
                  <span key={m.nctId} className="sb-saved-chip mono">
                    {m.nctId}
                    <button onClick={() => onToggleSave(m.nctId)} aria-label={`remove ${m.nctId}`}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="sb-spacer" />

      {profile && (
        <div className="sb-profile">
          <div className="sb-h">Your profile</div>
          <p className="sb-summary">{profile.summary}</p>
        </div>
      )}

      <button
        className="sb-theme"
        onClick={onTheme}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark" ? "☀ Light" : "☾ Dark"}
      </button>
    </aside>
  );
}

/* ============================ phase views ================================= */

function Home({
  mode,
  onEnter,
  onSelectPatient,
}: {
  mode: PortalMode;
  onEnter: () => void;
  onSelectPatient: () => void;
}) {
  const copy = {
    patient: {
      kicker: "Patient portal",
      title: "See which clinical trials you may qualify for — and why.",
      lede: "Share your health information in plain language or upload a note. Trial structures it, screens live against recruiting studies on ClinicalTrials.gov, and shows the inclusion and exclusion reasoning for every match.",
      cta: "Enter patient portal →",
    },
    clinician: {
      kicker: "Clinician portal",
      title: "Screen patients against recruiting trials with a sourced criterion ledger.",
      lede: "Built for coordinators and clinicians who need fast, auditable eligibility calls — not a black-box score. Per-criterion reasoning is shown for every trial, with gaps flagged for follow-up.",
      cta: "Clinician portal — coming soon",
    },
    partner: {
      kicker: "Business partner portal",
      title: "Connect sponsors, sites, and patients through transparent trial matching.",
      lede: "Trial gives research organizations a coordinator-first workflow for surfacing recruiting studies with documented inclusion/exclusion calls — ready for integration into your trial operations stack.",
      cta: "Partner portal — coming soon",
    },
  }[mode];

  return (
    <>
      <div className="scroll home-scroll">
        <div className="col home-col">
          <section className="home-hero">
            <p className="home-kicker">{copy.kicker}</p>
            <h1>{copy.title}</h1>
            <p className="home-lede">{copy.lede}</p>
          </section>
          <div className="home-actions">
            {mode === "patient" ? (
              <button type="button" className="btn go home-cta" onClick={onEnter}>
                {copy.cta}
              </button>
            ) : (
              <p className="home-soon">
                <b>{copy.cta}</b> — we&apos;re onboarding {mode === "clinician" ? "clinical teams" : "research partners"} now. Switch to{" "}
                <button type="button" className="home-link" onClick={onSelectPatient}>
                  Patient
                </button>{" "}
                to try the live demo.
              </p>
            )}
          </div>
        </div>
      </div>
      <section className="home-product" aria-label="Product information">
        <div className="home-product__inner">
          <header className="home-product__head">
            <p className="home-product__kicker">Product</p>
            <h2>Built for transparent trial matching</h2>
          </header>
          <ProductCarousel />
        </div>
      </section>
    </>
  );
}

function AppFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p className="footer-demo">Prototype. Not medical advice. Do not enter real health information.</p>
        <div className="site-footer__brand">
          <strong>Trial</strong>
          <span>Clinical trial matching with transparent eligibility reasoning.</span>
        </div>
        <div className="site-footer__cols">
          <section>
            <h3>HIPAA &amp; privacy</h3>
            <p>
              Trial is designed to support HIPAA-aligned workflows. Protected health information (PHI) is encrypted in transit and at rest,
              access is role-based and logged, and we maintain administrative, physical, and technical safeguards consistent with the HIPAA
              Security Rule.
            </p>
          </section>
          <section>
            <h3>Business associate agreements</h3>
            <p>
              Covered entities and business associates may execute a Business Associate Agreement (BAA) before production use with real patient
              data. Demo and evaluation environments must use de-identified or synthetic records only.
            </p>
          </section>
          <section>
            <h3>Your rights</h3>
            <p>
              Users may request access, amendment, or deletion of personal data subject to applicable law and contractual obligations. Report
              security concerns to <a href="mailto:privacy@trial.health">privacy@trial.health</a>.
            </p>
          </section>
        </div>
        <p className="site-footer__legal">
          © {new Date().getFullYear()} Trial. Informational decision support — not medical advice or a final eligibility determination.
          Not a substitute for professional clinical judgment.
        </p>
      </div>
    </footer>
  );
}

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [greeting, setGreeting] = useState("Welcome");
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    setGreeting(pickWelcomeGreeting());
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div ref={scrollRef} className="scroll scroll--landing">
      <div className="col landing-col">
        <div className="hero">
          <h1 className={entered ? "in" : undefined} suppressHydrationWarning>
            {greeting}
          </h1>
          <p>
            Share your notes or describe your situation. I&apos;ll read it into a structured profile, ask a few quick preferences, then screen
            live against recruiting ClinicalTrials.gov studies and show the reasoning behind every match.
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
              placeholder="Paste your notes or describe your situation…"
            />
            <div className="row">
              <span className="hint">⌘↵ to send</span>
              <span className="sp" />
              <button className="btn go" onClick={() => onRead(note)}>
                Get started →
              </button>
            </div>
          </div>
          <div className="chips">
            <button className="chip" onClick={() => onRead(SAMPLE_NOTE)}>
              <span className="s">demo</span> Try a sample patient (Margaret)
            </button>
          </div>
          <div className="disclaimer" style={{ marginTop: 20 }}>
            Informational decision support to review with your care team — not medical advice or a final eligibility determination. Trial data is
            live from ClinicalTrials.gov. Please use synthetic personas only in this demo, not real patient data.
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
  return (
    <div className="scroll">
      <div className="board">
        <div className="umsg">
          <div className="bub">Find clinical trials I may be eligible for.</div>
        </div>
        <div className="agent-say">
          <AgentAvatar />
          <div className="body">
            <div className="who">Your guide · reading your note</div>
            <div className="note-src">{note}</div>
            {error ? (
              <div className="err">
                <b>I couldn&apos;t read that.</b> {error}
                <div className="retry">
                  <button className="btn" onClick={onRetry}>
                    Try again
                  </button>
                </div>
              </div>
            ) : busy || !profile ? (
              <div className="readout">
                <div className="rh">
                  <span className="pulse" /> Building your profile
                </div>
                <div style={{ padding: "14px 15px" }}>
                  <div className="working">
                    <span className="dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    reading your note…
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="readout">
                  <div className="rh">
                    <span className="pulse" /> Your profile · {profile.conditionQuery}
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
                    Continue — a few quick preferences
                  </button>
                  <span className="n">{gaps > 0 ? `${gaps} thing${gaps > 1 ? "s" : ""} we may ask you to confirm` : "no blocking gaps"}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- deterministic preference survey ---- */
const SURVEY_Q: {
  key: keyof SurveyPrefs;
  q: string;
  why: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "travel",
    q: "How far are you able to travel for a trial?",
    why: "We keep everything, but push far-away trials into a separate group so nearby options come first.",
    options: [
      { value: "local", label: "Close to home (~25 miles)" },
      { value: "regional", label: "Regional (~100 miles)" },
      { value: "any", label: "Anywhere for the right trial" },
    ],
  },
  {
    key: "studyType",
    q: "Are you looking for treatment, or open to observational (data-only) studies too?",
    why: "Observational studies collect information and don't provide treatment. Most people want treatment trials.",
    options: [
      { value: "treatment", label: "Treatment trials only" },
      { value: "observational", label: "Observational studies" },
      { value: "either", label: "Show me both" },
    ],
  },
  {
    key: "randomization",
    q: "Are you comfortable with trials that may randomize you or use a placebo?",
    why: "Some trials assign your treatment by chance, and a few include a placebo group.",
    options: [
      { value: "avoid", label: "I'd prefer to avoid it" },
      { value: "open", label: "I'm open to it" },
      { value: "none", label: "No preference" },
    ],
  },
];

function Survey({ initial, onSubmit, onBack }: { initial: SurveyPrefs; onSubmit: (s: SurveyPrefs) => void; onBack: () => void }) {
  const [picks, setPicks] = useState<SurveyPrefs>(initial);
  const set = (key: keyof SurveyPrefs, value: string) => setPicks((p) => ({ ...p, [key]: value }));
  const complete = picks.travel && picks.studyType && picks.randomization;

  return (
    <div className="scroll">
      <div className="board">
        <div className="agent-say">
          <AgentAvatar />
          <div className="body">
            <div className="who">Your guide</div>
            <div>A few quick preferences so I can focus your matches. These don&apos;t change who qualifies — they change what comes first.</div>
          </div>
        </div>

        <div className="survey">
          {SURVEY_Q.map((item) => (
            <div className="sq" key={item.key}>
              <div className="sq-q">{item.q}</div>
              <div className="sq-why">{item.why}</div>
              <div className="sq-opts">
                {item.options.map((o) => (
                  <button key={o.value} className={`sq-opt ${picks[item.key] === o.value ? "on" : ""}`} onClick={() => set(item.key, o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="continue-row">
          <button className="btn go" disabled={!complete} onClick={() => complete && onSubmit(picks)}>
            Continue →
          </button>
          <button className="ghost" onClick={onBack}>
            ← Back
          </button>
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
      <div className="board">
        <div className="agent-say">
          <AgentAvatar />
          <div className="body">
            <div className="who">Your guide</div>
            <div>A few quick questions to sharpen your matches — only the gaps that actually change which trials qualify:</div>
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
      <div className="opt agent" onClick={() => onAnswer("Let my guide decide from the note")}>
        <div className="num">⤳</div>
        <div>
          <div className="ot">Let my guide decide from the note</div>
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

function Review({
  profile,
  answers,
  consent,
  onConsent,
  onFind,
}: {
  profile: Profile;
  answers: Record<string, string>;
  consent: boolean;
  onConsent: (v: boolean) => void;
  onFind: () => void;
}) {
  const applied = Object.keys(answers).length;
  return (
    <div className="scroll">
      <div className="board">
        <div className="agent-say">
          <AgentAvatar />
          <div className="body">
            <div className="who">Your guide · quick check</div>
            <div>
              Here&apos;s what I&apos;ll match on. Correct anything before we search — this is the record every eligibility call is checked
              against. I&apos;ll search live for <span className="mono">{profile.conditionQuery}</span>.
            </div>
          </div>
        </div>
        <div className="profile">
          {profile.fields.map((f, i) => (
            <div className="prow" key={i}>
              <span className="k">{f.label}</span>
              <span className="v">{f.clinical ? <span className="mono">{f.value}</span> : f.value}</span>
              <button className="edit">edit</button>
            </div>
          ))}
        </div>

        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} />
          <span>
            I understand this is informational decision support to review with a care team — <b>not medical advice</b> — and I agree to my entered
            information being processed to find trials. In this demo I&apos;ll use synthetic information only.
          </span>
        </label>

        <div className="continue-row">
          <button className="btn go" disabled={!consent} onClick={onFind}>
            Find my trials →
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
    "Searching recruiting studies on ClinicalTrials.gov…",
    "Applying the basics (your condition · recruiting · phase)…",
    "Breaking each study's eligibility into plain criteria…",
    "Checking every criterion against your profile…",
    "Flagging what needs confirming · never guessing a maybe into a yes…",
  ];
  return (
    <div className="scroll">
      <div className="board">
        <div className="agent-say">
          <AgentAvatar />
          <div className="body">
            <div className="who">Your guide · searching</div>
            {error ? (
              <div className="err">
                <b>The search failed.</b> {error}
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
                    reading each trial closely — one check per trial…
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
  { key: "near", label: "Stay near home", hint: "prioritize a site close to you" },
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

function ratioOf(m: TrialMatch): number {
  return m.total === 0 ? 0 : m.metCount / m.total;
}
function travelThreshold(t: TravelPref | null): number {
  return t === "local" ? 2 : t === "regional" ? 1 : 0; // 'any'/null → 0 (no grouping)
}
function passesStudyFilter(m: TrialMatch, f: StudyFilter): boolean {
  if (f === "all") return true;
  return f === "treatment" ? m.interventional : !m.interventional;
}

function Results({
  data,
  prefs,
  saved,
  onToggleSave,
  studyFilter,
  survey,
}: {
  data: MatchResponse;
  prefs: Set<PrefKey>;
  saved: Set<string>;
  onToggleSave: (n: string) => void;
  studyFilter: StudyFilter;
  survey: SurveyPrefs;
}) {
  const { counts, matches, conditionQuery } = data;
  const active = prefs.size > 0;

  const consider = matches.filter((m) => (m.status === "eligible" || m.status === "uncertain") && passesStudyFilter(m, studyFilter));
  const ruledOut = matches.filter((m) => m.status === "near" && passesStudyFilter(m, studyFilter));
  const screened = matches.filter((m) => m.status === "screened" && passesStudyFilter(m, studyFilter));

  const ordered = active ? [...consider].sort((a, b) => prefScore(b, prefs) - prefScore(a, prefs) || ratioOf(b) - ratioOf(a)) : consider;

  // Geography: soft grouping — nothing excluded, far trials collapsed below.
  const thr = travelThreshold(survey.travel);
  const canGroup = thr > 0 && ordered.some((m) => m.factors.proximityScore >= thr);
  const inRange = canGroup ? ordered.filter((m) => m.factors.proximityScore >= thr) : ordered;
  const farther = canGroup ? ordered.filter((m) => m.factors.proximityScore < thr) : [];

  const shownEligible = consider.filter((m) => m.status === "eligible").length;
  const shownUncertain = consider.filter((m) => m.status === "uncertain").length;

  const card = (m: TrialMatch) => (
    <DecisionCard key={m.nctId} m={m} saved={saved.has(m.nctId)} onSave={() => onToggleSave(m.nctId)} reasons={active ? prefReasons(m, prefs) : []} />
  );

  return (
    <div className="scroll">
      <div className="board board--results">
        <div className="board-head">
          <h2>Matches for you</h2>
          <span className="live-flag">live · clinicaltrials.gov</span>
        </div>
        <p className="results-caveat">
          Eligibility shown here is generated by an AI model and is not a determination of eligibility. Only a study team can confirm whether
          you qualify.
        </p>
        <p className="board-sub">
          I screened <b>{counts.poolTotal} recruiting trials</b> for <span className="mono">{conditionQuery}</span> and looked closely at the top{" "}
          <b>{counts.reasoned}</b>. These are worth discussing with your care team — nothing here is a recommendation; it&apos;s to help you weigh
          the options and know what to ask.
        </p>

        <div className="counts">
          <span className="count eligible">
            <b>{shownEligible}</b> eligible
          </span>
          <span className="count uncertain">
            <b>{shownUncertain}</b> to confirm
          </span>
          <span className="count near">
            <b>{ruledOut.length}</b> ruled out
          </span>
          <span className="count">
            <b>{screened.length}</b> screened
          </span>
        </div>

        {consider.length === 0 && (
          <div className="empty-note">No trials match the current study-type filter. Try switching it to “All” in the sidebar.</div>
        )}

        {inRange.map(card)}

        {farther.length > 0 && (
          <details className="farther">
            <summary>
              Farther from you ({farther.length}) <span>— beyond your travel range, kept just in case</span>
            </summary>
            <div className="farther-list">{farther.map(card)}</div>
          </details>
        )}

        {ruledOut.length > 0 && (
          <>
            <div className="section-h">
              Ruled out <span>— listed in full, fails closed</span>
            </div>
            {ruledOut.map(card)}
          </>
        )}

        {screened.length > 0 && (
          <>
            <div className="section-h">
              Screened <span>— matched your condition &amp; recruiting filters, not deeply reasoned this pass</span>
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
          Informational decision support to review with your care team — not medical advice, and it does not choose for you. Trial data is live
          from ClinicalTrials.gov; synthetic personas only in this demo.
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
              <div className="qask-h">Questions to ask your care team</div>
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
