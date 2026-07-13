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

import { memo, useEffect, useRef, useState } from "react";
import AgentAvatar from "@/app/components/AgentAvatar";
import TrialLogo from "@/app/components/TrialLogo";
import AsciiBackground from "@/app/components/AsciiBackground";
import HeroVideo from "@/app/components/HeroVideo";
import ProductCarousel from "@/app/components/ProductCarousel";
import type { TrialMatch, Criterion, Verdict, MatchStatus } from "@/lib/types";
import { deriveStatus, metCountOf } from "@/lib/verdict";

/* ---- API response shapes ---- */
type FieldSource = "fhir" | "note" | "you";
type ProfileField = { label: string; value: string; clinical: boolean; gap: boolean; mcode: string; source: FieldSource };
type Clarification = { id: string; question: string; rationale: string; gloss: string; options: string[] };
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
type LocationInfo = { applied: boolean; label: string; travel: TravelPref | null; inRange: number };
type MatchResponse = { conditionQuery: string; summary: string; counts: Counts; location: LocationInfo; matches: TrialMatch[] };

type PortalMode = "patient" | "clinician" | "partner";
type Phase = "home" | "landing" | "connect" | "capture" | "clarify" | "confirm" | "reason" | "results" | "fork" | "refer";

/* ---- record-import (SMART on FHIR) shapes ---- */
type ConnectPatient = { id: string; label: string; summary: string };
type ConnectList = { base: string; live: ConnectPatient[]; liveError: string | null; bundled: ConnectPatient[] };
type ImportOrigin = "note" | "fhir";

/* ---- the Fork (intake-prd §6) shapes ---- */
type ForkOptionKind = "treatment" | "all" | "other";
type ForkOption = { id: string; label: string; drugClass: string; rationale: string; kind: ForkOptionKind };
type ForkDoor = { nctId: string; door: "stays_open" | "closes" | "confirm"; criterion: string; kind: "incl" | "excl"; reason: string };
type ForkResult = { optionId: string; optionLabel: string; doors: ForkDoor[] };

/* §6.4 — required verbatim on every Fork payoff view that shows a closing door.
   The failure mode we must never enable is a patient delaying standard-of-care
   to preserve trial eligibility. Non-negotiable. */
const FORK_DISCLAIMER =
  "This is not medical advice, and it is not a reason to change your treatment plan. Treatment decisions belong with your oncologist. This shows you which trial options are time-sensitive so you can raise them at your next appointment.";

/* Phases that render inside the workspace shell (sidebar + main). */
const SHELL_PHASES: Phase[] = ["capture", "clarify", "confirm", "reason", "results", "fork", "refer"];

const PORTAL_MODES: [PortalMode, string][] = [
  ["patient", "Patient"],
  ["clinician", "Clinician"],
  ["partner", "Business Partner"],
];
const MODE_BADGE: Record<PortalMode, string> = { patient: "patient", clinician: "clinician", partner: "partner" };

/* ---- scope: travel band + location (relocated into the Capture chip row) ---- */
type TravelPref = "local" | "regional" | "any";
type SurveyPrefs = { travel: TravelPref | null; location: string };
const EMPTY_SURVEY: SurveyPrefs = { travel: null, location: "" };

/* A distance preference (anything but "any") requires an entered location. */
function travelNeedsLocation(t: TravelPref | null): boolean {
  return t === "local" || t === "regional";
}

/* ---- study-type scope chips (intake-prd §4.1) — patient language, NOT the
   CT.gov taxonomy. Multi-select; treatment + tests default ON, the rest OFF.
   Threaded to /api/match and applied at the registry BEFORE the reasoning pass,
   so excluded study types never consume a Claude call. */
type StudyTypeKey = "treatment" | "tests" | "observational" | "expanded";
const STUDY_TYPE_CHIPS: { key: StudyTypeKey; label: string; hint: string }[] = [
  { key: "treatment", label: "Treatment studies", hint: "testing a new drug or therapy for my cancer" },
  { key: "tests", label: "Tests & monitoring", hint: "new ways to detect, measure, or track my cancer" },
  { key: "observational", label: "Observational", hint: "no new treatment; my data helps future patients" },
  { key: "expanded", label: "Expanded access", hint: "access to a drug outside a trial (compassionate use)" },
];
const DEFAULT_STUDY_TYPES: StudyTypeKey[] = ["treatment", "tests"];

/* Travel bands are commitment bands, not mileage bands (§4.2). */
const TRAVEL_BANDS: { value: TravelPref; label: string }[] = [
  { value: "local", label: "Local only" },
  { value: "regional", label: "Within a few hours" },
  { value: "any", label: "Anywhere for the right trial" },
];

/* ---- "Who's filling this out?" (§5.3) — one click, defaults to Patient, never
   gates progress. Changes the output voice only; not an eligibility question. */
type Entrant = "patient" | "caregiver" | "clinician";
const ENTRANTS: { value: Entrant; label: string }[] = [
  { value: "patient", label: "Patient" },
  { value: "caregiver", label: "Family / caregiver" },
  { value: "clinician", label: "Clinician" },
];

/* §8 — Confirm echoes the scope the search will run with, built from real state
   (study-type chips + travel band + location), never hardcoded. */
function scopeSummary(types: Set<StudyTypeKey>, survey: SurveyPrefs): string {
  const labels = STUDY_TYPE_CHIPS.filter((c) => types.has(c.key)).map((c) => c.label.toLowerCase());
  const studyPart = labels.length ? labels.join(" + ") : "all study types";
  const loc = survey.location.trim();
  const band = survey.travel ? TRAVEL_BANDS.find((b) => b.value === survey.travel)?.label.toLowerCase() : "";
  let rankPart: string;
  if (loc) rankPart = `ranked for ${loc}${band ? ` (${band})` : ""}`;
  else if (band) rankPart = `ranked ${band}`;
  else rankPart = "ranked by fit";
  return `Searching ${studyPart}, ${rankPart}`;
}

/* results filters */
type StudyFilter = "all" | "treatment" | "observational";
type StatusFilter = "all" | MatchStatus;
type TopK = 10 | 25 | "all";

/* sidebar step tracker */
const STEPS: { key: "note" | "review" | "matches" | "fork"; label: string }[] = [
  { key: "note", label: "Your note" },
  { key: "review", label: "Review" },
  { key: "matches", label: "Matches" },
  { key: "fork", label: "What's next" },
];
function stepKey(phase: Phase): "note" | "review" | "matches" | "fork" {
  if (phase === "capture") return "note";
  if (phase === "clarify" || phase === "confirm") return "review";
  if (phase === "fork") return "fork";
  return "matches";
}

const SAMPLE_NOTE = `61F, ECOG 1. HR-positive (ER 90%, PR 60%), HER2-negative (IHC 1+) metastatic breast ca, stage IV. 1L letrozole+palbociclib (3/2024) → PD 12/2025. 2L fulvestrant (1/2026) → PD 6/2026. Trial of pembrolizumab on a prior protocol. PIK3CA H1047R+, BRCA wt. Boston MA.`;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

/* §5.2 — the NGS clarify answer (id "ngs-status") turns a dead end into an action.
   Show the Results banner only when the patient answered no / not sure. */
function ngsActionNeeded(answers: Record<string, string>): boolean {
  const a = (answers["ngs-status"] ?? "").toLowerCase();
  if (!a || a.includes("yes")) return false;
  return a.includes("no") || a.includes("not sure");
}

/* ---- provenance (record-import-prd §7.1): label every field FHIR · note · you.
   Connect §3 adds a 4th value for criteria: "not documented" (nothing on record). ---- */
type BadgeSource = FieldSource | "not_documented";
const SOURCE_META: Record<BadgeSource, { label: string; hint: string }> = {
  fhir: { label: "FHIR", hint: "Structured data pulled from your chart via SMART on FHIR" },
  note: { label: "note", hint: "Read from a clinical note or document" },
  you: { label: "you told us", hint: "You told us this / edited it here" },
  not_documented: { label: "not documented", hint: "Nothing in your record addresses this yet" },
};
function SourceBadge({ source }: { source: BadgeSource }) {
  const m = SOURCE_META[source] ?? SOURCE_META.note;
  return (
    <span className={`srcbadge ${source}`} title={m.hint}>
      {m.label}
    </span>
  );
}
function ProvenanceLegend() {
  return (
    <div className="prov-legend" aria-label="How to read the source labels">
      <span className="prov-legend__h">Sources</span>
      {(["fhir", "note", "you"] as FieldSource[]).map((s) => (
        <span key={s} className="prov-legend__item">
          <SourceBadge source={s} /> {SOURCE_META[s].hint}
        </span>
      ))}
    </div>
  );
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("home");
  const [portalMode, setPortalMode] = useState<PortalMode>("patient");
  const [note, setNote] = useState("");
  const [origin, setOrigin] = useState<ImportOrigin>("note");
  // Friendly label for the capture screen when the input isn't a raw note
  // (a FHIR patient name, or an uploaded file name) — the note itself may be a
  // long composed FHIR document we don't want to dump on screen.
  const [sourceLabel, setSourceLabel] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Scope (§4.1/§4.2): study-type chips + travel band + location. Set on the
  // Capture/Landing chip row BEFORE the note is read, so they must survive the
  // per-note reset — only a brand-new search resets them to defaults.
  const [studyTypes, setStudyTypes] = useState<Set<StudyTypeKey>>(new Set(DEFAULT_STUDY_TYPES));
  const [survey, setSurvey] = useState<SurveyPrefs>(EMPTY_SURVEY);
  const [entrant, setEntrant] = useState<Entrant>("patient"); // §5.3 — output voice only
  // Connect (referral) stage — which trial is being prepared, and a Fork summary
  // to carry into Packet A ("Starting X would close N of your M open trials").
  const [referTrial, setReferTrial] = useState<string | null>(null);
  const [forkNote, setForkNote] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [prefs, setPrefs] = useState<Set<PrefKey>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [studyFilter, setStudyFilter] = useState<StudyFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [phaseFilter, setPhaseFilter] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState<TopK>(10);
  const [flash, setFlash] = useState<string | null>(null);
  // Resolving a "confirm": the background re-check of other trials, and the
  // "Your next steps" panel for when the patient doesn't have the info yet.
  const [recheck, setRecheck] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const [showNextSteps, setShowNextSteps] = useState(false);

  const appRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  /* ---- transitions ---- */

  function resetIntake() {
    setNote("");
    setOrigin("note");
    setSourceLabel("");
    setProfile(null);
    setAnswers({});
    setStep(0);
    setMatch(null);
    setError(null);
    // NB: scope (studyTypes / survey) is intentionally NOT reset here — it's
    // captured on the chip row before the note and must carry into this run.
    setConsent(false);
    setPrefs(new Set());
    setSaved(new Set());
    setStudyFilter("all");
    setStatusFilter("all");
    setPhaseFilter(new Set());
    setQuery("");
    setTopK(10);
  }

  // Shared extraction call: text (a note or a composed FHIR document) → profile.
  // Does not touch phase/reset — the entry handlers own that.
  async function extractInto(text: string, o: ImportOrigin) {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: text, origin: o }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Extraction failed.");
    setProfile(data.profile as Profile);
  }

  // Paste / describe path — the universal funnel every text entry point uses.
  async function readNote(text: string) {
    const t = text.trim();
    if (!t) return;
    resetIntake();
    setNote(t);
    setPhase("capture");
    setBusy(true);
    try {
      await extractInto(t, "note");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // Upload PDF path — wire the previously-orphaned /api/upload-pdf route: extract
  // text server-side, then run the same extraction as a note.
  async function readPdf(file: File) {
    resetIntake();
    setSourceLabel(file.name);
    setPhase("capture");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/upload-pdf", { method: "POST", body: fd });
      const upd = await up.json();
      if (!up.ok) throw new Error(upd.error || "Could not read that PDF.");
      setNote(upd.text as string);
      await extractInto(upd.text as string, "note");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // Connect-my-records path — pull the patient's chart (SMART on FHIR), then feed
  // the composed document into the same extractor. The moat: FHIR resources + the
  // DocumentReference notes both flow through /api/extract.
  async function readRecords(src: "live" | "bundled", id: string, label: string) {
    resetIntake();
    setOrigin("fhir");
    setSourceLabel(label);
    setPhase("capture");
    setBusy(true);
    try {
      const res = await fetch("/api/connect-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: src, id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Record import failed.");
      const doc = data.document as string;
      const meta = data.meta as { patientLabel?: string; counts?: Record<string, number>; hasNotes?: boolean };
      setNote(doc);
      if (meta?.patientLabel) setSourceLabel(meta.patientLabel);
      await extractInto(doc, "fhir");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // Retry re-runs extraction against whatever text/document is already loaded
  // (works for note, pdf, and fhir — the source text is retained in `note`).
  async function retryExtract() {
    setError(null);
    setBusy(true);
    try {
      await extractInto(note, origin);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // Patient corrects a value on the Confirm screen → it becomes "you told us"
  // (provenance flips to `you`), the honest basis for that field going forward.
  function editField(index: number, value: string) {
    setProfile((p) =>
      p ? { ...p, fields: p.fields.map((f, i) => (i === index ? { ...f, value, source: "you" as FieldSource } : f)) } : p,
    );
  }

  // Capture → the review flow. Scope now lives on the chip row (no survey step),
  // so this just advances: a short AI clarify only if the note left genuine gaps.
  function afterCapture() {
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
    // Seed the results ranking from the travel band — this is what makes the
    // distance preference bite (it ranks/groups; it never hard-filters).
    const seeded = new Set<PrefKey>();
    if (survey.travel && survey.travel !== "any") seeded.add("near");
    setPrefs(seeded);
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
          location: survey.location.trim(),
          travel: survey.travel,
          studyTypes: Array.from(studyTypes),
          entrant,
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

  // ---- resolving a "confirm" to-do -------------------------------------------
  // The patient supplies the missing fact for one criterion. We (1) save it to the
  // shared profile as told-by-you, (2) re-judge that one criterion honestly, and
  // (3) re-check every OTHER reasoned trial's open items against the new fact in the
  // background. Returns true on success so the row can collapse; throws on failure
  // so the row can show the error inline (and stay open as a to-do).
  async function resolveCriterion(nctId: string, critIndex: number, answer: string): Promise<boolean> {
    if (!match || !profile) return false;
    const trial = match.matches.find((m) => m.nctId === nctId);
    const crit = trial?.criteria[critIndex];
    if (!trial || !crit) return false;

    // 1. Persist to the shared profile (provenance "you") so it carries forward.
    const field: ProfileField = {
      label: confirmFieldLabel(crit.requirement),
      value: answer,
      clinical: false,
      gap: false,
      mcode: "",
      source: "you",
    };
    const updatedProfile: Profile = { ...profile, fields: [...profile.fields, field] };
    setProfile(updatedProfile);

    // 2. Re-judge just this criterion with the added info.
    const res = await fetch("/api/reconfirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: { summary: updatedProfile.summary, fields: updatedProfile.fields.map((f) => ({ label: f.label, value: f.value })) },
        trial: { nctId: trial.nctId, title: trial.title, phase: trial.phase },
        criteria: [{ kind: crit.kind, requirement: crit.requirement, evidence: crit.evidence }],
        answer,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't update this item.");
    const nv = (data.verdicts?.[0] ?? null) as { verdict: Verdict; evidence: string } | null;
    if (!nv) throw new Error("No verdict returned.");

    setMatch((prev) => applyReverdicts(prev, nctId, [critIndex], [nv]));
    setFlash(nctId);
    window.setTimeout(() => setFlash((f) => (f === nctId ? null : f)), 1400);

    // 3. Fire-and-forget: re-check the other reasoned trials' open items.
    void backgroundRecheck(nctId, updatedProfile);
    return true;
  }

  async function backgroundRecheck(sourceNctId: string, updatedProfile: Profile) {
    if (!match) return;
    const targets = match.matches.filter((m) => m.nctId !== sourceNctId && m.criteria.some((c) => c.verdict === "confirm"));
    if (targets.length === 0) return;
    setRecheck({ busy: true, note: `Re-checking ${targets.length} other trial${targets.length > 1 ? "s" : ""} with your new info…` });

    let changed = 0;
    await runBounded(targets, 4, async (t) => {
      const open = t.criteria.map((c, i) => ({ c, i })).filter((x) => x.c.verdict === "confirm");
      try {
        const res = await fetch("/api/reconfirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: { summary: updatedProfile.summary, fields: updatedProfile.fields.map((f) => ({ label: f.label, value: f.value })) },
            trial: { nctId: t.nctId, title: t.title, phase: t.phase },
            criteria: open.map((x) => ({ kind: x.c.kind, requirement: x.c.requirement, evidence: x.c.evidence })),
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const verdicts = (data.verdicts ?? []) as { verdict: Verdict; evidence: string }[];
        changed += open.reduce((n, _x, k) => n + (verdicts[k] && verdicts[k].verdict !== "confirm" ? 1 : 0), 0);
        setMatch((prev) =>
          applyReverdicts(
            prev,
            t.nctId,
            open.map((x) => x.i),
            verdicts,
          ),
        );
      } catch {
        /* leave this trial's items unchanged on error — never invent a resolution */
      }
    });

    setRecheck({
      busy: false,
      note:
        changed > 0
          ? `Updated ${changed} open item${changed > 1 ? "s" : ""} on other trials from your new info.`
          : "Checked other trials — your new info didn't resolve any of their open items.",
    });
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
  const togglePhase = (p: string) =>
    setPhaseFilter((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  // Re-open a saved trial from the left menu: clear any result filters that could
  // be hiding it, then scroll its card into view and flash it once it's rendered.
  function openSaved(nct: string) {
    setStatusFilter("all");
    setStudyFilter("all");
    setPhaseFilter(new Set());
    setQuery("");
    setTopK("all");
    setFlash(nct);
    setTimeout(() => {
      document.getElementById(`trial-${nct}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    setTimeout(() => setFlash((f) => (f === nct ? null : f)), 1600);
  }

  // A brand-new search is the only place scope resets to its defaults.
  function resetScope() {
    setStudyTypes(new Set(DEFAULT_STUDY_TYPES));
    setSurvey(EMPTY_SURVEY);
    setEntrant("patient");
  }
  const toggleStudyType = (k: StudyTypeKey) =>
    setStudyTypes((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  function goHome() {
    setPhase("home");
    resetIntake();
    resetScope();
  }
  function newSearch() {
    resetIntake();
    resetScope();
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
          <TrialLogo />
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
      {/* front-landing hero uses a video backdrop (HeroVideo) instead of the
          ASCII; keep the ASCII app-wide everywhere else */}
      {phase !== "home" && <AsciiBackground trackRef={appRef} />}

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
            query={query}
            onQuery={setQuery}
            phaseFilter={phaseFilter}
            onTogglePhase={togglePhase}
            topK={topK}
            onTopK={setTopK}
            saved={saved}
            onToggleSave={toggleSave}
            onOpenSaved={openSaved}
            matches={match?.matches ?? []}
          />
          <div className="shell-main">
            {phase === "capture" && (
              <Capture
                note={note}
                origin={origin}
                sourceLabel={sourceLabel}
                profile={profile}
                busy={busy}
                error={error}
                onRetry={retryExtract}
                onContinue={afterCapture}
              />
            )}
            {phase === "clarify" && profile && (
              <Clarify profile={profile} step={step} onAnswer={answer} onBack={() => step > 0 && setStep(step - 1)} onSkip={() => answer("(skipped — flagged uncertain)")} />
            )}
            {phase === "confirm" && profile && (
              <Review
                profile={profile}
                answers={answers}
                consent={consent}
                onConsent={setConsent}
                onFind={findTrials}
                onEditField={editField}
                scopeLine={scopeSummary(studyTypes, survey)}
              />
            )}
            {phase === "reason" && <Reason busy={busy} error={error} onRetry={findTrials} />}
            {phase === "results" && match && (
              <Results
                data={match}
                prefs={prefs}
                saved={saved}
                onToggleSave={toggleSave}
                studyFilter={studyFilter}
                statusFilter={statusFilter}
                onStatusFilter={setStatusFilter}
                phaseFilter={phaseFilter}
                query={query}
                topK={topK}
                flash={flash}
                onResolve={resolveCriterion}
                recheck={recheck}
                onDismissRecheck={() => setRecheck((r) => ({ ...r, note: null }))}
                onOpenNextSteps={() => setShowNextSteps(true)}
                onOpenFork={() => setPhase("fork")}
                onRefer={(nctId) => {
                  setReferTrial(nctId);
                  setPhase("refer");
                }}
                showNgsAction={ngsActionNeeded(answers)}
              />
            )}
            {phase === "fork" && match && profile && (
              <Fork
                profile={profile}
                matches={match.matches}
                location={match.location}
                onForkNote={setForkNote}
                onBack={() => setPhase("results")}
              />
            )}
            {phase === "refer" &&
              match &&
              profile &&
              (() => {
                const t = match.matches.find((m) => m.nctId === referTrial);
                return t ? (
                  <Refer trial={t} profile={profile} location={match.location} forkNote={forkNote} onBack={() => setPhase("results")} />
                ) : null;
              })()}
          </div>
          {showNextSteps && match && <NextStepsPanel matches={match.matches} onClose={() => setShowNextSteps(false)} />}
        </div>
      ) : (
        <>
          {header}
          <div className="app-main">
            {phase === "home" && <Home mode={portalMode} onEnter={enterPortal} onSelectPatient={() => selectMode("patient")} />}
            {phase === "landing" && (
              <Landing
                note={note}
                setNote={setNote}
                onRead={readNote}
                onPdf={readPdf}
                onConnect={() => setPhase("connect")}
                studyTypes={studyTypes}
                onToggleStudyType={toggleStudyType}
                survey={survey}
                onSurvey={setSurvey}
                entrant={entrant}
                onEntrant={setEntrant}
              />
            )}
            {phase === "connect" && (
              <Connect onPick={readRecords} onBack={() => setPhase("landing")} />
            )}
            {phase === "home" && <AppFooter />}
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
  query,
  onQuery,
  phaseFilter,
  onTogglePhase,
  topK,
  onTopK,
  saved,
  onToggleSave,
  onOpenSaved,
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
  query: string;
  onQuery: (q: string) => void;
  phaseFilter: Set<string>;
  onTogglePhase: (p: string) => void;
  topK: TopK;
  onTopK: (k: TopK) => void;
  saved: Set<string>;
  onToggleSave: (n: string) => void;
  onOpenSaved: (n: string) => void;
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
  const topOpts: [TopK, string][] = [
    [10, "10"],
    [25, "25"],
    ["all", "All"],
  ];
  // CT.gov-familiar phase facet, in registry order, limited to phases present.
  const phaseOrder = ["Early Phase 1", "Phase 1", "Phase 1/2", "Phase 2", "Phase 2/3", "Phase 3", "Phase 4", "N/A"];
  const presentPhases = Array.from(new Set(matches.map((m) => m.phase))).sort(
    (a, b) => phaseOrder.indexOf(a) - phaseOrder.indexOf(b),
  );

  return (
    <aside className="sidebar">
      <button type="button" className="sb-brand" onClick={onHome}>
        <TrialLogo />
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

      {profile && (
        <div className="sb-profile">
          <div className="sb-h">Your profile</div>
          <p className="sb-summary">{profile.summary}</p>
        </div>
      )}

      {showControls && (
        <div className="sb-controls">
          <div className="sb-sec">
            <div className="sb-h">Search</div>
            <input
              className="sb-search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="NCT id or title…"
              aria-label="Search results by NCT id or title"
              autoComplete="off"
            />
          </div>

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

          {presentPhases.length > 1 && (
            <div className="sb-sec">
              <div className="sb-h">Phase</div>
              <div className="sb-prefs">
                {presentPhases.map((p) => (
                  <button key={p} className={`pref ${phaseFilter.has(p) ? "on" : ""}`} onClick={() => onTogglePhase(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

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
            <div className="sb-h">Show ranked</div>
            <div className="seg">
              {topOpts.map(([val, label]) => (
                <button key={String(val)} className={`seg-btn ${topK === val ? "on" : ""}`} onClick={() => onTopK(val)}>
                  {label}
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
                  <span key={m.nctId} className="sb-saved-chip">
                    <button className="sb-saved-open mono" onClick={() => onOpenSaved(m.nctId)} title={m.title}>
                      {m.nctId}
                    </button>
                    <button className="sb-saved-x" onClick={() => onToggleSave(m.nctId)} aria-label={`remove ${m.nctId}`}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
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
      lede: "Describe your situation, upload a note, or connect your medical records (SMART on FHIR). Trial structures it, screens live against recruiting studies on ClinicalTrials.gov, and shows the inclusion and exclusion reasoning for every match.",
      cta: "Enter patient portal →",
    },
    clinician: {
      kicker: "Clinician & CRC portal",
      title: "Screen patients against recruiting trials with a sourced criterion ledger.",
      lede: "Built for clinical research coordinators (CRCs) and clinicians who need fast, auditable eligibility calls — not a black-box score. Per-criterion reasoning is shown for every trial, with gaps flagged for follow-up.",
      cta: "Clinician & CRC portal — coming soon",
    },
    partner: {
      kicker: "Business partner portal",
      title: "Connect sponsors, sites, and patients through transparent trial matching.",
      lede: "Trial gives research organizations a clinical research coordinator (CRC)-first workflow for surfacing recruiting studies with documented inclusion/exclusion calls — ready for integration into your trial operations stack.",
      cta: "Partner portal — coming soon",
    },
  }[mode];

  return (
    <>
      <div className="scroll home-scroll">
        <HeroVideo />
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
            <p>
              <a href="/privacy">Read the full privacy &amp; data-handling guide →</a>
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

function Landing({
  note,
  setNote,
  onRead,
  onPdf,
  onConnect,
  studyTypes,
  onToggleStudyType,
  survey,
  onSurvey,
  entrant,
  onEntrant,
}: {
  note: string;
  setNote: (s: string) => void;
  onRead: (s: string) => void;
  onPdf: (f: File) => void;
  onConnect: () => void;
  studyTypes: Set<StudyTypeKey>;
  onToggleStudyType: (k: StudyTypeKey) => void;
  survey: SurveyPrefs;
  onSurvey: (s: SurveyPrefs) => void;
  entrant: Entrant;
  onEntrant: (e: Entrant) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
            Share your notes or describe your situation. I&apos;ll read it into a structured profile, then screen live against recruiting
            ClinicalTrials.gov studies and show the reasoning behind every match. Set your scope below if you like — it&apos;s optional.
          </p>
          <div className="intro-steps" aria-label="What to expect">
            <div className="intro-steps__h">Three quick steps — about 2 minutes:</div>
            <ol>
              <li>
                <span className="isn">1</span> Profile setup — I read your note into a structured profile
              </li>
              <li>
                <span className="isn">2</span> A few profile-specific questions — only the gaps that change your matches
              </li>
              <li>
                <span className="isn">3</span> Review &amp; edit — you correct anything before I search
              </li>
            </ol>
          </div>
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

          {/* Other ways in: upload a document, or pull your chart via SMART on FHIR. */}
          <div className="entry-more">
            <span className="entry-more__or">or bring your records in</span>
            <div className="entry-opts">
              <button type="button" className="entry-opt" onClick={() => fileRef.current?.click()}>
                <span className="entry-opt__ic" aria-hidden>
                  ⬆
                </span>
                <span className="entry-opt__body">
                  <span className="entry-opt__t">Upload a PDF</span>
                  <span className="entry-opt__d">A visit summary or pathology report — I&apos;ll read the text.</span>
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPdf(f);
                  e.target.value = "";
                }}
              />
              <button type="button" className="entry-opt" onClick={onConnect}>
                <span className="entry-opt__ic" aria-hidden>
                  ⚕
                </span>
                <span className="entry-opt__body">
                  <span className="entry-opt__t">
                    Connect my medical records <span className="entry-opt__badge">FHIR</span>
                  </span>
                  <span className="entry-opt__d">Pull your chart from your provider (SMART on FHIR). Demo uses a public sandbox.</span>
                </span>
              </button>
            </div>
          </div>

          {/* Scope chip row (§4) — zero added steps: collapsed with defaults visible. */}
          <ChipRow
            studyTypes={studyTypes}
            onToggleStudyType={onToggleStudyType}
            survey={survey}
            onSurvey={onSurvey}
            entrant={entrant}
            onEntrant={onEntrant}
          />

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

/* ---- Capture chip row (§4): study-type scope + travel band, zero added steps.
   Collapsed by default with the current scope visible; expandable. Study type
   is applied server-side before reasoning; travel ranks (never hard-filters). */
function ChipRow({
  studyTypes,
  onToggleStudyType,
  survey,
  onSurvey,
  entrant,
  onEntrant,
}: {
  studyTypes: Set<StudyTypeKey>;
  onToggleStudyType: (k: StudyTypeKey) => void;
  survey: SurveyPrefs;
  onSurvey: (s: SurveyPrefs) => void;
  entrant: Entrant;
  onEntrant: (e: Entrant) => void;
}) {
  const [open, setOpen] = useState(false);
  const needsLoc = travelNeedsLocation(survey.travel);
  const setTravel = (t: TravelPref) => onSurvey({ ...survey, travel: survey.travel === t ? null : t });

  const typeLabels = STUDY_TYPE_CHIPS.filter((c) => studyTypes.has(c.key)).map((c) => c.label);
  const travelLabel = survey.travel ? TRAVEL_BANDS.find((b) => b.value === survey.travel)?.label : "Anywhere (default)";
  const entrantLabel = ENTRANTS.find((e) => e.value === entrant)?.label ?? "Patient";
  const summary = `${entrantLabel} · ${typeLabels.length ? typeLabels.join(" + ") : "no study types selected"} · ${travelLabel}`;

  return (
    <div className={`chiprow ${open ? "open" : ""}`}>
      <button type="button" className="chiprow__bar" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="chiprow__k">Scope</span>
        <span className="chiprow__sum">{summary}</span>
        <span className="chiprow__toggle">{open ? "Done ▲" : "Adjust ▾"}</span>
      </button>

      {open && (
        <div className="chiprow__panel">
          <div className="chiprow__group">
            <div className="chiprow__q">Who&apos;s filling this out?</div>
            <div className="chiprow__bands">
              {ENTRANTS.map((e) => (
                <button key={e.value} type="button" className={`band ${entrant === e.value ? "on" : ""}`} onClick={() => onEntrant(e.value)}>
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          <div className="chiprow__group">
            <div className="chiprow__q">What kinds of studies should I look for?</div>
            <div className="chiprow__chips">
              {STUDY_TYPE_CHIPS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`scope-chip ${studyTypes.has(c.key) ? "on" : ""}`}
                  aria-pressed={studyTypes.has(c.key)}
                  onClick={() => onToggleStudyType(c.key)}
                >
                  <span className="scope-chip__box" aria-hidden>
                    {studyTypes.has(c.key) ? "✓" : ""}
                  </span>
                  <span className="scope-chip__text">
                    <span className="scope-chip__label">{c.label}</span>
                    <span className="scope-chip__hint">{c.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="chiprow__group">
            <div className="chiprow__q">Where are you, and how far could you go?</div>
            <div className="chiprow__bands">
              {TRAVEL_BANDS.map((b) => (
                <button key={b.value} type="button" className={`band ${survey.travel === b.value ? "on" : ""}`} onClick={() => setTravel(b.value)}>
                  {b.label}
                </button>
              ))}
            </div>
            {needsLoc && (
              <div className="chiprow__loc">
                <input
                  className="chiprow__zip"
                  value={survey.location}
                  onChange={(e) => onSurvey({ ...survey, location: e.target.value })}
                  placeholder="ZIP code (e.g. 02114)"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  aria-label="ZIP code"
                />
                <span className="chiprow__lochint">
                  ZIP only — used to <b>rank</b> by distance. Trials farther away are still shown under “Farther from you,” never dropped.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Connect my medical records: patient-mediated SMART on FHIR import ---- */
function Connect({
  onPick,
  onBack,
}: {
  onPick: (src: "live" | "bundled", id: string, label: string) => void;
  onBack: () => void;
}) {
  const [list, setList] = useState<ConnectList | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/connect-records")
      .then((r) => r.json())
      .then((d) => {
        if (live) setList(d as ConnectList);
      })
      .catch((e) => live && setLoadErr(errMsg(e)));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="scroll scroll--landing">
      <div className="col landing-col">
        <div className="hero">
          <p className="home-kicker">Connect my medical records</p>
          <h1 className="in">Pull your chart, not just your memory.</h1>
          <p>
            Under the 21st Century Cures Act, you can authorize an app to pull your own records from your provider through a standardized FHIR
            API — the same mechanism Apple Health uses. I read the documents it returns into your profile.
          </p>
          <div className="demo-badge" style={{ display: "inline-block", marginTop: 4 }}>
            DEMO · SMART HEALTH IT PUBLIC SANDBOX · SYNTHETIC DATA ONLY
          </div>

          {loadErr && (
            <div className="err" style={{ marginTop: 16 }}>
              <b>Couldn&apos;t reach the sandbox.</b> {loadErr}
            </div>
          )}

          {!list && !loadErr && (
            <div className="working" style={{ marginTop: 18 }}>
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              finding available patients…
            </div>
          )}

          {list && (
            <div className="connect">
              {list.bundled.length > 0 && (
                <div className="connect-group">
                  <div className="connect-group__h">Oncology test patient · mCODE R4 bundle</div>
                  {list.bundled.map((p) => (
                    <button key={p.id} className="connect-row" onClick={() => onPick("bundled", p.id, p.label)}>
                      <span className="connect-row__name">{p.label}</span>
                      <span className="connect-row__sum">{p.summary}</span>
                      <span className="connect-row__go">Connect →</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="connect-group">
                <div className="connect-group__h">
                  Live sandbox patients · <span className="mono">{prettyBase(list.base)}</span>
                </div>
                {list.liveError && <p className="sb-empty">Live sandbox unavailable: {list.liveError}</p>}
                {list.live.map((p) => (
                  <button key={p.id} className="connect-row" onClick={() => onPick("live", p.id, p.label)}>
                    <span className="connect-row__name">{p.label}</span>
                    <span className="connect-row__sum">{p.summary}</span>
                    <span className="connect-row__go">Connect →</span>
                  </button>
                ))}
                <p className="connect-note">
                  Real FHIR pull. These synthetic patients are general-population — expect the oncology specifics (biomarkers, staging) to come
                  back as gaps, which is exactly why the notes matter.
                </p>
              </div>
            </div>
          )}

          <div className="continue-row">
            <button className="ghost" onClick={onBack}>
              ← Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function prettyBase(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Capture({
  note,
  origin,
  sourceLabel,
  profile,
  busy,
  error,
  onRetry,
  onContinue,
}: {
  note: string;
  origin: ImportOrigin;
  sourceLabel: string;
  profile: Profile | null;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const gaps = profile?.fields.filter((f) => f.gap).length ?? 0;
  // For a FHIR import the "note" is a long composed document — show a friendly
  // source line instead of dumping it. For paste/PDF, show the text we read.
  const sourceText = origin === "fhir" ? `Imported from your chart via SMART on FHIR${sourceLabel ? ` · ${sourceLabel}` : ""}` : sourceLabel ? `${sourceLabel} — ${note}` : note;
  return (
    <div className="scroll">
      <div className="board">
        <div className="umsg">
          <div className="bub">Find clinical trials I may be eligible for.</div>
        </div>
        <div className="agent-say">
          <AgentAvatar />
          <div className="body">
            <div className="who">Your guide · {origin === "fhir" ? "reading your imported record" : "reading your note"}</div>
            <div className={`note-src${origin === "fhir" ? " note-src--fhir" : ""}`}>{sourceText}</div>
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
                        <SourceBadge source={f.source ?? "note"} />
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
                <ProvenanceLegend />
                <div className="continue-row">
                  <button className="btn go" onClick={onContinue}>
                    Continue →
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

/* The preference survey phase was removed in §4: scope (study type + travel)
   now lives on the Capture chip row (ChipRow), adding zero steps. Randomization
   was dropped per §7. */

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
      {c.gloss && (
        <details className="cgloss">
          <summary>what does this mean?</summary>
          <div className="cgloss__body">{c.gloss}</div>
        </details>
      )}
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
  onEditField,
  scopeLine,
}: {
  profile: Profile;
  answers: Record<string, string>;
  consent: boolean;
  onConsent: (v: boolean) => void;
  onFind: () => void;
  onEditField: (index: number, value: string) => void;
  scopeLine: string;
}) {
  const applied = Object.keys(answers).length;
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const startEdit = (i: number, current: string) => {
    setEditing(i);
    setDraft(current);
  };
  const commitEdit = (i: number) => {
    const v = draft.trim();
    if (v) onEditField(i, v);
    setEditing(null);
  };

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
            {/* §8 — echo the scope the search will run with. */}
            <div className="scope-echo">
              ◎ {scopeLine}
            </div>
          </div>
        </div>

        {/* Federal-schema conformance — the sentence no other team will say (§6). */}
        <div className="mcode-banner">
          <span className="mcode-banner__chip">mCODE / USCDI+ CTM</span>
          <span className="mcode-banner__txt">
            Your profile is mapped to <b>mCODE 4.0.0 / US Core 6.1.0</b> — the federal Cancer Clinical Trials Matching schema. Every field is
            labeled with its source so you see what came from your chart, a note, or you.
          </span>
        </div>

        <div className="profile">
          {profile.fields.map((f, i) => (
            <div className={`prow${editing === i ? " editing" : ""}`} key={i}>
              <span className="k">
                {f.label}
                {f.mcode ? <span className="mcode">{f.mcode}</span> : null}
              </span>
              <span className="v">
                <SourceBadge source={f.source ?? "note"} />
                {editing === i ? (
                  <input
                    className="prow-input"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitEdit(i)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitEdit(i);
                      } else if (e.key === "Escape") {
                        setEditing(null);
                      }
                    }}
                  />
                ) : f.clinical ? (
                  <span className="mono">{f.value}</span>
                ) : (
                  f.value
                )}
              </span>
              {editing === i ? (
                <button className="edit" onClick={() => commitEdit(i)}>
                  done
                </button>
              ) : (
                <button className="edit" onClick={() => startEdit(i, f.value)}>
                  edit
                </button>
              )}
            </div>
          ))}
        </div>
        <ProvenanceLegend />

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
function passesStudyFilter(m: TrialMatch, f: StudyFilter): boolean {
  if (f === "all") return true;
  return f === "treatment" ? m.interventional : !m.interventional;
}
function passesPhaseFilter(m: TrialMatch, f: Set<string>): boolean {
  return f.size === 0 || f.has(m.phase);
}
function matchesQuery(m: TrialMatch, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return m.nctId.toLowerCase().includes(t) || m.title.toLowerCase().includes(t);
}
/** Apply the CT.gov-familiar refine facets (search · study type · phase) shared by every section. */
function passesFacets(m: TrialMatch, studyFilter: StudyFilter, phaseFilter: Set<string>, query: string): boolean {
  return passesStudyFilter(m, studyFilter) && passesPhaseFilter(m, phaseFilter) && matchesQuery(m, query);
}
function limitK<T>(list: T[], k: TopK): T[] {
  return k === "all" ? list : list.slice(0, k);
}
function travelLabel(t: TravelPref | null): string {
  return t === "local" ? "in your state" : t === "regional" ? "in your country" : "anywhere";
}

/** The four summary buckets — canonical counts, always reconcile to the pool total. */
const COUNT_BUCKETS: { key: MatchStatus; cls: string; label: string }[] = [
  { key: "eligible", cls: "eligible", label: "eligible" },
  { key: "uncertain", cls: "uncertain", label: "to confirm" },
  { key: "near", cls: "near", label: "ruled out" },
  { key: "screened", cls: "", label: "not yet reasoned" },
];

/* ============================ THE FORK (§6) ============================== */
/* Post-Results decision screen: pick a hypothetical next treatment, see which
   currently-open trials it would keep open vs. close, each with the driving
   criterion. "Nothing decided yet" opens the whole tree. */

function Fork({
  profile,
  matches,
  location,
  onForkNote,
  onBack,
}: {
  profile: Profile;
  matches: TrialMatch[];
  location: LocationInfo;
  onForkNote: (note: string | null) => void;
  onBack: () => void;
}) {
  // Input universe: the trials the patient is OPEN to today (a next line can only
  // "close" a door that's currently open). Must carry a criterion ledger to reuse.
  const openTrials = matches.filter((m) => (m.status === "eligible" || m.status === "uncertain") && m.criteria.length > 0);
  const trialById = new Map(openTrials.map((m) => [m.nctId, m]));

  const [options, setOptions] = useState<ForkOption[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [results, setResults] = useState<ForkResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/fork-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { summary: profile.summary, fields: profile.fields.map((f) => ({ label: f.label, value: f.value })) } }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!live) return;
        if (!ok) setLoadErr(d.error || "Couldn't generate options.");
        else setOptions(d.options as ForkOption[]);
      })
      .catch((e) => live && setLoadErr(errMsg(e)));
    return () => {
      live = false;
    };
  }, [profile]);

  async function run(opt: ForkOption) {
    if (opt.kind === "other" && !custom.trim()) return;
    setSelectedId(opt.id);
    setBusy(true);
    setRunErr(null);
    setResults(null);
    // Which treatment(s) to judge: the whole tree, a single line, or a typed one.
    const treatments = (options ?? []).filter((o) => o.kind === "treatment");
    const send =
      opt.kind === "all"
        ? treatments.map((o) => ({ id: o.id, label: o.label, drugClass: o.drugClass }))
        : opt.kind === "other"
          ? [{ id: "something-else", label: custom.trim(), drugClass: "" }]
          : [{ id: opt.id, label: opt.label, drugClass: opt.drugClass }];
    try {
      const res = await fetch("/api/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: { summary: profile.summary, fields: profile.fields.map((f) => ({ label: f.label, value: f.value })) },
          options: send,
          trials: openTrials.map((m) => ({
            nctId: m.nctId,
            title: m.title,
            phase: m.phase,
            criteria: m.criteria.map((c) => ({ kind: c.kind, requirement: c.requirement, verdict: c.verdict, evidence: c.evidence })),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fork reasoning failed.");
      const results = data.results as ForkResult[];
      setResults(results);
      // Carry a one-line summary into Packet A when the patient picked a single
      // concrete treatment (not the whole tree).
      if (opt.kind !== "all" && results.length === 1) {
        const closes = results[0].doors.filter((d) => d.door === "closes").length;
        onForkNote(`Starting ${results[0].optionLabel} would close ${closes} of your ${openTrials.length} currently-open trials.`);
      }
    } catch (e) {
      setRunErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scroll">
      <div className="board">
        <div className="agent-say">
          <AgentAvatar />
          <div className="body">
            <div className="who">Your guide · what&apos;s next</div>
            <div>
              You&apos;re looking at <b>{openTrials.length}</b> trial{openTrials.length === 1 ? "" : "s"} you may qualify for today. Some are
              time-sensitive: a next line of treatment can quietly <b>close</b> the door on a trial. Pick what your care team is weighing — or see
              the whole tree — and I&apos;ll show you which doors stay open.
            </div>
          </div>
        </div>

        {/* §6.4 — non-negotiable, shown on every Fork view. */}
        <div className="fork-disclaimer">{FORK_DISCLAIMER}</div>

        {loadErr && <div className="err">{loadErr}</div>}
        {!options && !loadErr && (
          <div className="working" style={{ marginTop: 6 }}>
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            reading your note for the plausible next lines of treatment…
          </div>
        )}

        {options && (
          <div className="fork-opts">
            <div className="fork-opts__h">What might you start next?</div>
            {options.map((o) => {
              const on = selectedId === o.id;
              if (o.kind === "other") {
                return (
                  <div key={o.id} className={`fork-opt other ${on ? "on" : ""}`}>
                    <div className="fork-opt__main">
                      <div className="fork-opt__label">{o.label}</div>
                      <div className="fork-opt__sub">{o.rationale}</div>
                    </div>
                    <div className="fork-opt__other-row">
                      <input
                        className="fork-opt__input"
                        value={custom}
                        onChange={(e) => setCustom(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && custom.trim()) run(o);
                        }}
                        placeholder="e.g. sacituzumab govitecan"
                      />
                      <button className="btn" disabled={!custom.trim()} onClick={() => run(o)}>
                        Check
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <button key={o.id} className={`fork-opt ${o.kind === "all" ? "tree" : ""} ${on ? "on" : ""}`} onClick={() => run(o)}>
                  <div className="fork-opt__main">
                    <div className="fork-opt__label">
                      {o.label}
                      {o.kind === "all" && <span className="fork-opt__tag">default · full tree</span>}
                    </div>
                    <div className="fork-opt__sub">
                      {o.drugClass ? <span className="fork-opt__class">{o.drugClass}</span> : null}
                      {o.rationale}
                    </div>
                  </div>
                  <span className="fork-opt__go">→</span>
                </button>
              );
            })}
          </div>
        )}

        {busy && (
          <div className="working" style={{ marginTop: 16 }}>
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            checking each open trial against that treatment — reusing the eligibility we already reasoned…
          </div>
        )}
        {runErr && <div className="err">{runErr}</div>}

        {results && !busy && (
          <div className="fork-results">
            {results.map((r) => (
              <ForkPayoff key={r.optionId} result={r} trialById={trialById} location={location} />
            ))}
            <div className="fork-disclaimer bottom">{FORK_DISCLAIMER}</div>
          </div>
        )}

        <div className="continue-row">
          <button className="ghost" onClick={onBack}>
            ← Back to matches
          </button>
        </div>
      </div>
    </div>
  );
}

/* One treatment's payoff: the two-column stays-open / closes split + time line. */
function ForkPayoff({
  result,
  trialById,
  location,
}: {
  result: ForkResult;
  trialById: Map<string, TrialMatch>;
  location: LocationInfo;
}) {
  const rows = result.doors.map((d) => ({ d, m: trialById.get(d.nctId) })).filter((x): x is { d: ForkDoor; m: TrialMatch } => !!x.m);
  const open = rows.filter((x) => x.d.door === "stays_open");
  const closes = rows.filter((x) => x.d.door === "closes");
  const confirm = rows.filter((x) => x.d.door === "confirm");
  const timeLine = forkTimeLine(closes, location);

  return (
    <div className="fork-result">
      <div className="fork-result__h">
        If you start <b>{result.optionLabel}</b> next:
      </div>
      <div className="fork-cols">
        <div className="fork-col open">
          <div className="fork-col__h">Stays open ({open.length})</div>
          {open.length === 0 ? <div className="fork-col__empty">None</div> : open.map((x) => <ForkDoorRow key={x.d.nctId} d={x.d} m={x.m} />)}
        </div>
        <div className="fork-col closes">
          <div className="fork-col__h">Closes ({closes.length})</div>
          {closes.length === 0 ? <div className="fork-col__empty">None</div> : closes.map((x) => <ForkDoorRow key={x.d.nctId} d={x.d} m={x.m} />)}
        </div>
      </div>
      {confirm.length > 0 && (
        <div className="fork-confirm">
          <div className="fork-confirm__h">Can&apos;t tell without more info ({confirm.length}) — never guessed either way</div>
          {confirm.map((x) => (
            <ForkDoorRow key={x.d.nctId} d={x.d} m={x.m} />
          ))}
        </div>
      )}
      {timeLine && <div className="fork-time">◷ {timeLine}</div>}
    </div>
  );
}

function ForkDoorRow({ d, m }: { d: ForkDoor; m: TrialMatch }) {
  const glyph = d.door === "stays_open" ? "✓" : d.door === "closes" ? "✕" : "?";
  return (
    <a className={`fork-door ${d.door}`} href={m.url} target="_blank" rel="noopener noreferrer">
      <span className="fork-door__glyph">{glyph}</span>
      <span className="fork-door__body">
        <span className="fork-door__top">
          <span className="mono">{d.nctId}</span> <span className="fork-door__title">{m.title}</span>
        </span>
        {d.criterion && (
          <span className="fork-door__crit">
            <span className={`ck ${d.kind}`}>{d.kind}</span> {d.criterion}
          </span>
        )}
        {d.reason && <span className="fork-door__why">{d.reason}</span>}
      </span>
    </a>
  );
}

/* Time dimension (§6.3) — reuse enrollmentWindow + proximity; no new geo work. */
function forkTimeLine(closes: { d: ForkDoor; m: TrialMatch }[], location: LocationInfo): string {
  const M = closes.length;
  if (M === 0) return "";
  const openNow = closes.filter((x) => x.m.factors.enrollmentWindow.startsWith("Open now"));
  const plural = M > 1 ? "s" : "";
  if (location.applied) {
    const inRange = openNow.filter((x) => x.m.factors.withinRange === true).length;
    return `${inRange} of the ${M} closing trial${plural} ${inRange === 1 ? "is" : "are"} enrolling now with a site within your range — worth raising first.`;
  }
  return `${openNow.length} of the ${M} closing trial${plural} ${openNow.length === 1 ? "is" : "are"} enrolling now.`;
}

/* ============================ CONNECT / REFERRAL (connect-prd) ============================
   Per-trial, post-Fork. We attach at Steps 1–2 of the regulated enrollment sequence
   (initial contact + pre-screen) and hand off at Step 3. Pre-screen accelerator, NOT an
   eligibility determiner: surface the basis for judgment, never render the verdict. */

const CONNECT_DISCLAIMER =
  "We don't determine eligibility and we don't obtain consent — the study team does that, in person, after a screening workup. Never delay or decline standard-of-care therapy to preserve trial eligibility. This helps your conversation with your care team start informed.";
const ELIGIBILITY_FRAMING =
  "This is not an eligibility determination. Only the study team can confirm whether you qualify, after a screening workup. This shows you how your record lines up against the published criteria.";

/* Four §3 display states, derived from verdict + provenance (never a new verdict). */
type CritState = "met" | "not_met" | "confirm" | "unknown";
function critState(c: Criterion): CritState {
  if (c.verdict === "fails") return "not_met";
  if (c.verdict === "meets" || c.verdict === "clear") return "met";
  return c.provenance === "not_documented" ? "unknown" : "confirm"; // confirm verdict
}
const CRIT_STATE_META: Record<CritState, { glyph: string; label: string; cls: string }> = {
  met: { glyph: "✓", label: "Met", cls: "met" },
  not_met: { glyph: "✕", label: "Not met", cls: "notmet" },
  confirm: { glyph: "⚠", label: "Needs confirmation", cls: "confirm" },
  unknown: { glyph: "?", label: "Unknown", cls: "unknown" },
};
/** The ⚠️/❓ rows are the product — the gaps a coordinator would phone to discover. */
function isGap(c: Criterion): boolean {
  const s = critState(c);
  return s === "confirm" || s === "unknown";
}

/* §4 readiness: classify each gap by lead time (longest first — that's what gates
   the timeline) and give a copy-able "ask your oncologist about…" (never an order). */
type Lead = { order: number; band: string; ask: string; why: string };
function classifyGap(c: Criterion): Lead {
  const r = c.requirement.toLowerCase();
  if (/tissue|biopsy|archiv|block|patholog|specimen|tumou?r sample|slides?/.test(r))
    return {
      order: 0,
      band: "2–4 weeks — start this first",
      ask: `Ask my pathology department to confirm a tumor tissue block from my biopsy exists and can be released to an outside institution. (Trial requirement: "${c.requirement}")`,
      why: "Missing biomarker or archived tissue accounts for ~8% of patients who fall out of phase I trials.",
    };
  if (/imag|scan|\bct\b|mri|\bpet\b|recist|measurable|radiograph|restag|lesion/.test(r))
    return {
      order: 1,
      band: "1–2 weeks",
      ask: `Ask my oncologist whether I need fresh imaging (e.g. a restaging CT) — this trial keys off a recent scan. (Trial requirement: "${c.requirement}")`,
      why: "Imaging/measurability issues drive ~29% of post-consent screen failures.",
    };
  if (/lab|cbc|cmp|organ|hemoglob|platelet|creatinin|bilirubin|neutrophil|blood count|marrow|hepatic|renal|function/.test(r))
    return {
      order: 2,
      band: "days",
      ask: `Ask about recent bloodwork (CBC and CMP) within the trial's window. (Trial requirement: "${c.requirement}")`,
      why: "Organ-function/biological issues drive ~24% of post-consent screen failures.",
    };
  return {
    order: 3,
    band: "timing varies",
    ask: `Ask my care team to confirm this with the study team: "${c.requirement}".`,
    why: "",
  };
}

/** Whole months since a "YYYY-MM(-DD)" date, or null if unparseable. */
function monthsSince(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  const now = new Date();
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`copy-btn ${done ? "done" : ""}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
    >
      {done ? "✓ Copied" : `⧉ ${label}`}
    </button>
  );
}

/** Print just one packet: tag <body>, print, untag when the dialog closes. */
function printPacket(cls: string) {
  const b = document.body;
  b.classList.add(cls);
  const cleanup = () => {
    b.classList.remove(cls);
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}

const REFER_SECTIONS: { id: string; label: string }[] = [
  { id: "refer-elig", label: "Eligibility" },
  { id: "refer-ready", label: "Before you call" },
  { id: "refer-contacts", label: "Contacts" },
  { id: "refer-packets", label: "Packets" },
  { id: "refer-auth", label: "Refer" },
  { id: "refer-timeline", label: "Timeline" },
];

function Refer({
  trial,
  profile,
  location,
  forkNote,
  onBack,
}: {
  trial: TrialMatch;
  profile: Profile;
  location: LocationInfo;
  forkNote: string | null;
  onBack: () => void;
}) {
  const gaps = trial.criteria.filter(isGap);
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="scroll">
      <div className="board refer">
        <div className="refer-head">
          <button className="ghost" onClick={onBack}>
            ← Back to matches
          </button>
          <div className="refer-title">
            <a className="nct" href={trial.url} target="_blank" rel="noopener noreferrer">
              {trial.nctId} ↗
            </a>
            <h2>{trial.title}</h2>
            <div className="refer-sub">
              {trial.phase} · {trial.sponsor} · ◎ {trial.factors.nearestSite}
            </div>
          </div>
        </div>

        <nav className="refer-nav" aria-label="Referral sections">
          {REFER_SECTIONS.map((s) => (
            <button key={s.id} onClick={() => jump(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="refer-disclaimer">{CONNECT_DISCLAIMER}</div>

        <EligibilityTable trial={trial} />
        <ReadinessChecklist gaps={gaps} />
        <ContactRouting trial={trial} />
        <div id="refer-packets" className="refer-sec">
          <PacketA trial={trial} gaps={gaps} location={location} forkNote={forkNote} />
          <PacketB trial={trial} profile={profile} />
        </div>
        <ReferralAuthorization trial={trial} profile={profile} />
        <ReferTimeline gaps={gaps} trial={trial} />
      </div>
    </div>
  );
}

/* §3 — per-criterion eligibility table (four states + provenance + source link). */
function EligibilityTable({ trial }: { trial: TrialMatch }) {
  const counts = trial.criteria.reduce(
    (acc, c) => {
      acc[critState(c)]++;
      return acc;
    },
    { met: 0, not_met: 0, confirm: 0, unknown: 0 } as Record<CritState, number>,
  );
  return (
    <section id="refer-elig" className="refer-sec">
      <div className="refer-sec__h">How your record lines up ({trial.criteria.length} criteria)</div>
      <div className="refer-framing">{ELIGIBILITY_FRAMING}</div>
      <div className="ct-tally">
        <span className="met">{counts.met} met</span>
        <span className="confirm">{counts.confirm} to confirm</span>
        <span className="unknown">{counts.unknown} unknown</span>
        {counts.not_met > 0 && <span className="notmet">{counts.not_met} not met</span>}
      </div>
      <div className="ct-table">
        {trial.criteria.map((c, i) => {
          const st = CRIT_STATE_META[critState(c)];
          return (
            <div key={i} className={`ct-row ${st.cls}`}>
              <span className="ct-glyph">{st.glyph}</span>
              <span className="ct-req">
                <span className={`ck ${c.kind}`}>{c.kind}</span> {c.requirement}
                {c.evidence ? <span className="ct-ev">{c.evidence}</span> : null}
              </span>
              <span className="ct-status">{st.label}</span>
              <span className="ct-prov">
                <SourceBadge source={c.provenance ?? "not_documented"} />
              </span>
              <a className="ct-src" href={trial.url} target="_blank" rel="noopener noreferrer" title="See the trial's eligibility criteria on ClinicalTrials.gov">
                source ↗
              </a>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* §4 — "Before you call" readiness checklist: gaps → actions, longest lead first. */
function ReadinessChecklist({ gaps }: { gaps: Criterion[] }) {
  const items = gaps.map((c) => ({ c, lead: classifyGap(c) })).sort((a, b) => a.lead.order - b.lead.order);
  return (
    <section id="refer-ready" className="refer-sec">
      <div className="refer-sec__h">
        {items.length > 0 ? `${items.length} thing${items.length > 1 ? "s" : ""} to close before you contact this site` : "You're ready to contact this site"}
      </div>
      {items.length === 0 ? (
        <p className="refer-empty">No open readiness gaps from your record — bring the packet below to your care team to confirm.</p>
      ) : (
        <ol className="ready-list">
          {items.map(({ c, lead }, i) => (
            <li key={i} className="ready-item">
              <div className="ready-top">
                <span className="ready-n">{i + 1}</span>
                <span className="ready-req">{c.requirement}</span>
                <span className="ready-band">{lead.band}</span>
              </div>
              <div className="ready-ask">{lead.ask}</div>
              {lead.why && <div className="ready-why">Why: {lead.why}</div>}
              <CopyButton text={lead.ask} label="Copy this ask" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* §6 — contact routing + honest staleness. */
function ContactRouting({ trial }: { trial: TrialMatch }) {
  const months = monthsSince(trial.lastUpdatePostDate);
  const stale = months !== null && months >= 3;
  // Nearest site first (best we can do at city/state granularity).
  const sites = [...trial.locations].sort((a, b) => {
    const near = trial.factors.nearestSite;
    const am = `${a.city}, ${a.state}` === near ? 0 : 1;
    const bm = `${b.city}, ${b.state}` === near ? 0 : 1;
    return am - bm;
  });
  const central = trial.contacts;
  const email = central.find((c) => c.email)?.email ?? "";
  const draft = `Subject: Interest in ${trial.nctId} — pre-screening\n\nHello,\n\nI'm a patient interested in ${trial.nctId} (${trial.title}). Working from my own records, my profile appears to line up with several of the published criteria, with a few items to confirm. Could you tell me whether the study is currently enrolling and what the next step would be?\n\nThank you.`;

  return (
    <section id="refer-contacts" className="refer-sec">
      <div className="refer-sec__h">Who to contact</div>

      {stale && (
        <div className="stale-warn">
          ⚠ This site's listing was last updated {months} months ago. Call to confirm they&apos;re still enrolling before you rely on it.
        </div>
      )}
      <div className="slot-note">Being eligible isn&apos;t the same as having a slot — in dose-escalation trials a cohort can be full even when you qualify. Ask.</div>

      {central.length > 0 && (
        <div className="contact-group">
          <div className="contact-group__h">Study contacts</div>
          {central.map((c, i) => (
            <div key={i} className="contact-row">
              <span className="contact-name">{c.name}</span>
              {c.phone && <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}>{c.phone}</a>}
              {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
            </div>
          ))}
        </div>
      )}

      <div className="contact-group">
        <div className="contact-group__h">Sites (nearest first — matched at city/state level, not exact miles)</div>
        {sites.slice(0, 6).map((s, i) => (
          <div key={i} className="site-row">
            <span className="site-place">
              {[s.city, s.state, s.country].filter(Boolean).join(", ") || s.facility}
            </span>
            <span className="site-facility">{s.facility}</span>
            {s.status && <span className="mono site-status">{s.status}</span>}
          </div>
        ))}
        {sites.length > 6 && <div className="refer-empty">+{sites.length - 6} more sites on ClinicalTrials.gov.</div>}
      </div>

      <div className="draft-email">
        <div className="contact-group__h">Draft outreach {email ? `to ${email}` : ""}</div>
        <pre className="draft-body">{draft}</pre>
        <CopyButton text={draft} label="Copy email" />
      </div>
    </section>
  );
}

/* §5 Packet A — "Bring this to your oncologist" one-pager. */
function PacketA({ trial, gaps, location, forkNote }: { trial: TrialMatch; gaps: Criterion[]; location: LocationInfo; forkNote: string | null }) {
  void location;
  return (
    <div className="packet packet-a">
      <div className="packet-head">
        <div className="packet-kicker">Packet A · bring this to your oncologist</div>
        <button className="btn" onClick={() => printPacket("printing-a")}>
          ⎙ Print
        </button>
      </div>
      <div className="packet-body">
        <h3>
          {trial.nctId} — {trial.title}
        </h3>
        <div className="packet-meta">
          {trial.phase} · {trial.sponsor} · nearest listed site: {trial.factors.nearestSite}
        </div>
        <div className="packet-block">
          <b>How the record lines up:</b> {trial.metCount}/{trial.total} criteria met · {gaps.length} to confirm before screening.
        </div>
        {gaps.length > 0 && (
          <div className="packet-block">
            <b>To close first:</b>
            <ul>
              {gaps
                .map((c) => ({ c, lead: classifyGap(c) }))
                .sort((a, b) => a.lead.order - b.lead.order)
                .map(({ c, lead }, i) => (
                  <li key={i}>
                    {c.requirement} <span className="packet-band">({lead.band})</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
        {forkNote && (
          <div className="packet-block fork">
            <b>Timing tradeoff:</b> {forkNote}
          </div>
        )}
        <div className="packet-framing">A conversation starter, not a recommendation. This is not an eligibility determination — the study team confirms that.</div>
      </div>
    </div>
  );
}

/* §5 Packet B — "For the study coordinator": mCODE profile + criterion status. */
function PacketB({ trial, profile }: { trial: TrialMatch; profile: Profile }) {
  const groups: { key: CritState; label: string }[] = [
    { key: "met", label: "Confirmed from record" },
    { key: "confirm", label: "Needs confirmation" },
    { key: "unknown", label: "Unknown / not documented" },
    { key: "not_met", label: "Not met" },
  ];
  return (
    <div className="packet packet-b">
      <div className="packet-head">
        <div className="packet-kicker">Packet B · for the study coordinator</div>
        <button className="btn" onClick={() => printPacket("printing-b")}>
          ⎙ Print
        </button>
      </div>
      <div className="packet-body">
        <h3>Pre-screen summary · {trial.nctId}</h3>
        <div className="packet-block">
          <b>Patient profile (mCODE / USCDI+ CTM), provenance on every field:</b>
          <div className="pb-fields">
            {profile.fields.map((f, i) => (
              <div key={i} className="pb-field">
                <span className="pb-k">
                  {f.label}
                  {f.mcode ? <span className="mcode">{f.mcode}</span> : null}
                </span>
                <span className="pb-v">
                  <SourceBadge source={f.source ?? "note"} /> {f.value}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="packet-block">
          <b>Criterion-by-criterion status:</b>
          {groups.map((g) => {
            const rows = trial.criteria.filter((c) => critState(c) === g.key);
            if (rows.length === 0) return null;
            return (
              <div key={g.key} className="pb-group">
                <div className={`pb-gh ${g.key}`}>
                  {g.label} ({rows.length})
                </div>
                {rows.map((c, i) => (
                  <div key={i} className="pb-crit">
                    <SourceBadge source={c.provenance ?? "not_documented"} /> <span className={`ck ${c.kind}`}>{c.kind}</span> {c.requirement}
                    {c.evidence ? ` — ${c.evidence}` : ""}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="packet-framing">Pre-screen only. Eligibility is determined by the study team after a screening workup.</div>
      </div>
    </div>
  );
}

/* §7 — referral = the authorization moment (front-end only; synthetic demo). */
function ReferralAuthorization({ trial, profile }: { trial: TrialMatch; profile: Profile }) {
  const [stage, setStage] = useState<"idle" | "review" | "done">("idle");
  return (
    <section id="refer-auth" className="refer-sec">
      <div className="refer-sec__h">Refer me to this study</div>
      {stage === "idle" && (
        <>
          <p className="refer-empty">
            When you refer, we share a specific, itemized set of your data with this one site for this one purpose — not a generic
            &quot;we may share with pharma.&quot; You see exactly what, with whom, and why first.
          </p>
          <button className="btn go" onClick={() => setStage("review")}>
            Review what would be shared →
          </button>
        </>
      )}
      {stage === "review" && (
        <div className="auth-card">
          <div className="auth-row">
            <span className="auth-k">What is disclosed</span>
            <span className="auth-v">{profile.fields.map((f) => f.label).join(" · ")}</span>
          </div>
          <div className="auth-row">
            <span className="auth-k">To whom</span>
            <span className="auth-v">{trial.sponsor} · site nearest {trial.factors.nearestSite} ({trial.nctId})</span>
          </div>
          <div className="auth-row">
            <span className="auth-k">Purpose</span>
            <span className="auth-v">Eligibility pre-screening and contact for possible enrollment in {trial.nctId}.</span>
          </div>
          <div className="auth-row">
            <span className="auth-k">Terms</span>
            <span className="auth-v">One year · revocable at any time · this trial only.</span>
          </div>
          <div className="auth-actions">
            <button className="btn go" onClick={() => setStage("done")}>
              Authorize &amp; refer
            </button>
            <button className="ghost" onClick={() => setStage("idle")}>
              Cancel
            </button>
          </div>
          <div className="auth-demo">Demo: nothing is transmitted and this is synthetic data — this screen shows the authorization the real flow would capture.</div>
        </div>
      )}
      {stage === "done" && (
        <div className="auth-done">
          <div className="auth-done__h">✓ Referral prepared</div>
          <p>
            In production, {trial.sponsor} would receive your consented pre-screen packet for {trial.nctId} — a referral-ready candidate you
            initiated, not a row in a purchased list.
          </p>
          <div className="auth-demo">Demo: no data was actually sent.</div>
        </div>
      )}
    </section>
  );
}

/* §8 — timeline (honest estimate). Time is the clinical risk, not a UX nicety. */
function ReferTimeline({ gaps, trial }: { gaps: Criterion[]; trial: TrialMatch }) {
  const expiring: string[] = [];
  if (gaps.some((c) => /imag|scan|\bct\b|mri|recist|measurable|restag/.test(c.requirement.toLowerCase()))) expiring.push("Scan validity — trials often require imaging within ~28 days.");
  if (gaps.some((c) => /lab|cbc|cmp|organ|creatinin|bilirubin|platelet|neutrophil|function/.test(c.requirement.toLowerCase()))) expiring.push("Lab recency — bloodwork typically must be within ~14 days of screening.");
  expiring.push("Cohort slots — dose-escalation cohorts can fill while you wait.");
  return (
    <section id="refer-timeline" className="refer-sec">
      <div className="refer-sec__h">Timeline &amp; what&apos;s expiring</div>
      <p className="refer-empty">
        First contact to first dose is commonly <b>2–8 weeks</b> (estimated). You&apos;re at the very start — initial contact. The window matters:
        after a screen failure, decline while waiting is a real clinical risk, so close the time-sensitive items early.
      </p>
      <div className="enroll" style={{ marginBottom: 10 }}>
        <span className="enroll-k">Enrollment</span>
        <span className="enroll-v">{trial.factors.enrollmentWindow || "status not published — confirm with the site"}</span>
      </div>
      <ul className="expiring-list">
        {expiring.map((e, i) => (
          <li key={i}>◷ {e}</li>
        ))}
      </ul>
    </section>
  );
}

function Results({
  data,
  prefs,
  saved,
  onToggleSave,
  studyFilter,
  statusFilter,
  onStatusFilter,
  phaseFilter,
  query,
  topK,
  flash,
  onResolve,
  recheck,
  onDismissRecheck,
  onOpenNextSteps,
  onOpenFork,
  onRefer,
  showNgsAction,
}: {
  data: MatchResponse;
  prefs: Set<PrefKey>;
  saved: Set<string>;
  onToggleSave: (n: string) => void;
  studyFilter: StudyFilter;
  statusFilter: StatusFilter;
  onStatusFilter: (s: StatusFilter) => void;
  phaseFilter: Set<string>;
  query: string;
  topK: TopK;
  flash: string | null;
  onResolve: (nctId: string, critIndex: number, answer: string) => Promise<boolean>;
  recheck: { busy: boolean; note: string | null };
  onDismissRecheck: () => void;
  onOpenNextSteps: () => void;
  onOpenFork: () => void;
  onRefer: (nctId: string) => void;
  showNgsAction: boolean;
}) {
  const { counts, matches, conditionQuery, location } = data;
  const active = prefs.size > 0;
  const [showAllScreened, setShowAllScreened] = useState(false);
  // Total open to-confirm items across the reasoned trials — the Next Steps count.
  const openConfirms = matches.reduce((n, m) => n + m.criteria.filter((c) => c.verdict === "confirm").length, 0);

  // Canonical counts (from the single source of truth on the server). These four
  // buckets ALWAYS sum to poolTotal, so the header and buckets can never disagree.
  const bucketCounts: Record<MatchStatus, number> = {
    eligible: counts.eligible,
    uncertain: counts.uncertain,
    near: counts.near,
    screened: counts.screened,
  };
  const reconTotal = counts.eligible + counts.uncertain + counts.near + counts.screened;

  // Shared refine facets (search · study type · phase) apply to every section.
  const facet = (m: TrialMatch) => passesFacets(m, studyFilter, phaseFilter, query);
  const statusOk = (m: TrialMatch) => statusFilter === "all" || m.status === statusFilter;

  const consider = matches.filter((m) => (m.status === "eligible" || m.status === "uncertain") && facet(m) && statusOk(m));
  const ruledOut = matches.filter((m) => m.status === "near" && facet(m) && statusOk(m));
  const screened = matches.filter((m) => m.status === "screened" && facet(m) && statusOk(m));

  const ordered = active ? [...consider].sort((a, b) => prefScore(b, prefs) - prefScore(a, prefs) || ratioOf(b) - ratioOf(a)) : consider;

  // Geography: when the server actually ran distance filtering, split the ranked
  // list into within-range and farther. Nothing is dropped — far trials collapse below.
  const grouped = location.applied;
  const inRangeAll = grouped ? ordered.filter((m) => m.factors.withinRange === true) : ordered;
  const fartherAll = grouped ? ordered.filter((m) => m.factors.withinRange !== true) : [];

  // top-k caps the ranked (in-range) list the user is scanning first.
  const inRange = limitK(inRangeAll, topK);
  const farther = fartherAll;
  const rankedHidden = inRangeAll.length - inRange.length;

  // §4.2 behavior: when distance grouping ran but nothing is in-range, don't show
  // an empty list behind a collapsed "Farther" toggle — auto-open it and say so.
  const emptyInRange = grouped && inRangeAll.length === 0 && fartherAll.length > 0;

  const totalShown = inRange.length + farther.length + ruledOut.length + screened.length;
  const filtersActive = statusFilter !== "all" || studyFilter !== "all" || phaseFilter.size > 0 || query.trim().length > 0;

  const card = (m: TrialMatch) => (
    <DecisionCard
      key={m.nctId}
      m={m}
      saved={saved.has(m.nctId)}
      onSave={() => onToggleSave(m.nctId)}
      reasons={active ? prefReasons(m, prefs) : []}
      flash={flash === m.nctId}
      onResolve={onResolve}
      onOpenNextSteps={onOpenNextSteps}
      onRefer={onRefer}
    />
  );

  const SCREENED_PREVIEW = 8;
  const screenedShown = showAllScreened ? screened : screened.slice(0, SCREENED_PREVIEW);

  return (
    <div className="scroll">
      <div className="board board--results">
        <div className="board-head">
          <h2>Matches for you</h2>
          <div className="board-head-r">
            {openConfirms > 0 && (
              <button className="nextsteps-btn" onClick={onOpenNextSteps}>
                Your next steps <span className="ns-count">{openConfirms}</span>
              </button>
            )}
            <span className="live-flag">live · clinicaltrials.gov</span>
          </div>
        </div>

        {/* Background re-check status — never silent: says what's happening / what changed. */}
        {(recheck.busy || recheck.note) && (
          <div className={`recheck-banner ${recheck.busy ? "busy" : "done"}`} role="status" aria-live="polite">
            <span className="rb-dot" aria-hidden="true" />
            <span className="rb-text">{recheck.note}</span>
            {!recheck.busy && recheck.note && (
              <button className="rb-x" onClick={onDismissRecheck} aria-label="Dismiss">
                ✕
              </button>
            )}
          </div>
        )}

        <p className="results-caveat">
          Eligibility shown here is generated by an AI model and is not a determination of eligibility. Only a study team can confirm whether
          you qualify.
        </p>
        <p className="board-sub">
          Screened <b>{counts.poolTotal} recruiting trials</b> for <span className="mono">{conditionQuery}</span> · reasoned the top{" "}
          <b>{counts.reasoned}</b> in depth
          {filtersActive ? (
            <>
              {" "}
              · showing <b>{totalShown}</b> after filters
            </>
          ) : null}
          . These are worth discussing with your care team — nothing here is a recommendation; it&apos;s to help you weigh the options and know
          what to ask.
        </p>

        {/* §5.2 — NGS gap reframed as an action, not a dead end. Honest: no fabricated count. */}
        {showNgsAction && (
          <div className="ngs-action">
            <span className="ngs-action__ic" aria-hidden>
              ⊕
            </span>
            <div className="ngs-action__body">
              <div className="ngs-action__h">Getting genomic testing could open more trials</div>
              <p>
                You haven&apos;t had comprehensive genomic (NGS) testing on record. Many trials screen on specific tumor alterations — testing
                like <b>FoundationOne</b>, <b>Guardant360</b>, <b>Tempus xT</b>, or <b>MSK-IMPACT</b> could open biomarker-selected trials you
                can&apos;t be screened for yet. Ask your oncologist whether NGS testing is right for you, and bring the results back to re-run
                this search.
              </p>
            </div>
          </div>
        )}

        {/* Location filter status — always explicit about whether distance was applied. */}
        <div className={`loc-banner ${location.applied ? "on" : "off"}`}>
          {location.applied ? (
            <>
              ◎ Filtered to trials with a site near <b>{location.label}</b> ({travelLabel(location.travel)}) — matched at city/state level, not
              exact mileage. Trials farther away are kept below under “Farther from you,” never dropped.
            </>
          ) : (
            <>
              ◎ No distance limit applied — showing trials anywhere. Set a travel range and location in preferences to filter by distance.
            </>
          )}
        </div>

        {/* Clickable status buckets — canonical counts that always reconcile to the pool total. */}
        <div className="counts">
          {COUNT_BUCKETS.map((b) => (
            <button
              key={b.key}
              className={`count ${b.cls} ${statusFilter === b.key ? "on" : ""}`}
              aria-pressed={statusFilter === b.key}
              onClick={() => onStatusFilter(statusFilter === b.key ? "all" : b.key)}
            >
              <b>{bucketCounts[b.key]}</b> {b.label}
            </button>
          ))}
          <span className="count total" title="Every bucket sums to the total screened.">
            <b>{reconTotal}</b> screened total
          </span>
          {statusFilter !== "all" && (
            <button className="count clear-status" onClick={() => onStatusFilter("all")}>
              show all ✕
            </button>
          )}
        </div>

        {/* The Fork prompt (intake-prd §6.1) — the differentiator. Only meaningful
            when the patient is actually open to trials that a next line could close. */}
        {counts.eligible + counts.uncertain > 0 && (
          <button className="fork-prompt" onClick={onOpenFork}>
            <div className="fork-prompt__body">
              <div className="fork-prompt__h">Has your care team recommended what&apos;s next?</div>
              <div className="fork-prompt__d">
                Some treatments close doors. See which of these trials a next line of treatment would keep open — or close — before your next
                appointment.
              </div>
            </div>
            <span className="fork-prompt__go">See what&apos;s at stake →</span>
          </button>
        )}

        {totalShown === 0 && (
          <div className="empty-note">
            No trials match the current filters.{" "}
            {filtersActive ? "Try clearing a filter in the sidebar or the status buckets above." : ""}
          </div>
        )}

        {(statusFilter === "all" || statusFilter === "eligible" || statusFilter === "uncertain") && (
          <>
            {emptyInRange && <div className="empty-range">No matches near you — here are the closest.</div>}

            {inRange.map(card)}

            {rankedHidden > 0 && (
              <div className="topk-note">
                {rankedHidden} more ranked match{rankedHidden > 1 ? "es" : ""} hidden by the “Show ranked” limit — raise it in the sidebar.
              </div>
            )}

            {farther.length > 0 && (
              <details className="farther" open={emptyInRange}>
                <summary>
                  Farther from you ({farther.length}) <span>— beyond your travel range, kept just in case</span>
                </summary>
                <div className="farther-list">{farther.map(card)}</div>
              </details>
            )}
          </>
        )}

        {ruledOut.length > 0 && (statusFilter === "all" || statusFilter === "near") && (
          <>
            <div className="section-h">
              Ruled out <span>— listed in full, fails closed</span>
            </div>
            {ruledOut.map(card)}
          </>
        )}

        {screened.length > 0 && (statusFilter === "all" || statusFilter === "screened") && (
          <>
            <div className="section-h">
              Not yet reasoned ({screened.length}) <span>— matched your condition &amp; recruiting filters, not deeply reasoned this pass</span>
            </div>
            <div className="screened-list">
              {screenedShown.map((m) => (
                <a key={m.nctId} className="screened-row" href={m.url} target="_blank" rel="noopener noreferrer">
                  <span className="mono">{m.nctId}</span>
                  <span className="sr-title">{m.title}</span>
                  <span className="mono sr-phase">{m.phase}</span>
                </a>
              ))}
            </div>
            {screened.length > SCREENED_PREVIEW && (
              <button className="ghost show-more" onClick={() => setShowAllScreened((v) => !v)}>
                {showAllScreened ? "Show fewer" : `Show all ${screened.length}`}
              </button>
            )}
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

const DecisionCard = memo(function DecisionCard({
  m,
  saved,
  onSave,
  reasons,
  flash,
  onResolve,
  onOpenNextSteps,
  onRefer,
}: {
  m: TrialMatch;
  saved: boolean;
  onSave: () => void;
  reasons: string[];
  flash: boolean;
  onResolve: (nctId: string, critIndex: number, answer: string) => Promise<boolean>;
  onOpenNextSteps: () => void;
  onRefer: (nctId: string) => void;
}) {
  const label = m.status === "eligible" ? "Eligible" : m.status === "uncertain" ? "Needs info" : "Ruled out";
  const near = m.status === "near";
  // A referral only makes sense for a trial the patient is still open to.
  const canRefer = m.status === "eligible" || m.status === "uncertain";
  const tally = ledgerTally(m.criteria);
  // Lazy-render the ledger body: it's the densest part of the page, so we only
  // build its rows when the accordion is actually open (near-misses open by default).
  const [ledgerOpen, setLedgerOpen] = useState(near);
  const enroll = m.factors.enrollmentWindow;
  const enrollUrgent = near || m.status === "uncertain";

  return (
    <div id={`trial-${m.nctId}`} className={`dcard ${m.status}${flash ? " flash" : ""}`}>
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
          {canRefer && (
            <button className="refer-btn" onClick={() => onRefer(m.nctId)}>
              Prepare referral →
            </button>
          )}
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
        {m.factors.locationUnknown && (
          <span className="fchip warn" title="This study lists no site we could place against your location.">
            location not verified
          </span>
        )}
        {!m.interventional && <span className="fchip">Observational</span>}
      </div>

      {/* Enrollment window (estimated) — placed next to the required next steps for near-misses. */}
      {enroll && (
        <div className={`enroll ${enrollUrgent ? "urgent" : ""}`}>
          <span className="enroll-k">Enrollment</span>
          <span className="enroll-v">{enroll}</span>
          {enrollUrgent && <span className="enroll-note">check this window against any “confirm first” steps below</span>}
        </div>
      )}

      {m.criteria.length > 0 && (
        <details className="ledger-d" open={near} onToggle={(e) => setLedgerOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>
            <span className="lsum-label">Eligibility reasoning</span>
            <span className="lsum-tally">
              {tally.met > 0 && <span className="t meets">{tally.met} met</span>}
              {tally.confirm > 0 && <span className="t unc">{tally.confirm} to confirm</span>}
              {tally.fails > 0 && <span className="t fails">{tally.fails} not met</span>}
            </span>
          </summary>
          {ledgerOpen && (
            <Ledger
              criteria={m.criteria}
              onResolve={(critIndex, answer) => onResolve(m.nctId, critIndex, answer)}
              onOpenNextSteps={onOpenNextSteps}
            />
          )}
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
});

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

function Ledger({
  criteria,
  onResolve,
  onOpenNextSteps,
}: {
  criteria: Criterion[];
  onResolve: (critIndex: number, answer: string) => Promise<boolean>;
  onOpenNextSteps: () => void;
}) {
  const [only, setOnly] = useState<Group | null>(null);
  // Carry each criterion's ORIGINAL index so a resolve targets the right row even
  // after grouping reorders them.
  const groups: Record<Group, { c: Criterion; idx: number }[]> = { confirm: [], fails: [], met: [] };
  criteria.forEach((c, idx) => groups[groupOf(c.verdict)].push({ c, idx }));
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
          {groups[g.key].map(({ c, idx }) => (
            <LedgerRow key={idx} c={c} index={idx} onResolve={onResolve} onOpenNextSteps={onOpenNextSteps} />
          ))}
        </div>
      ))}
    </div>
  );
}

function LedgerRow({
  c,
  index,
  onResolve,
  onOpenNextSteps,
}: {
  c: Criterion;
  index: number;
  onResolve: (critIndex: number, answer: string) => Promise<boolean>;
  onOpenNextSteps: () => void;
}) {
  const cls = verdictRowClass(c.verdict);
  const resolvable = c.verdict === "confirm";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fid = `cf-${index}`;

  async function submit() {
    const answer = draft.trim();
    if (!answer || busy) return;
    setBusy(true);
    setError(null);
    try {
      // On success the criterion moves to its new verdict group and this row
      // unmounts — no need to reset local state.
      await onResolve(index, answer);
      setOpen(false);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }

  return (
    <div className={`crow ${cls}${open ? " editing" : ""}`}>
      <div className="crow-main">
        <span className="cd">{verdictGlyph(c.verdict)}</span>
        <span className={`ck ${c.kind}`}>{c.kind}</span>
        <span className="cx">
          {c.requirement}
          {c.evidence ? <span className="ev">{c.evidence}</span> : null}
        </span>
        {resolvable ? (
          <button
            className={`verdict confirm-btn${open ? " on" : ""}`}
            aria-expanded={open}
            aria-controls={fid}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "cancel" : "confirm"}
          </button>
        ) : (
          <span className="verdict">{c.verdict}</span>
        )}
      </div>

      {resolvable && open && (
        <div className="confirm-form" id={fid}>
          <label className="cf-q" htmlFor={`${fid}-a`}>
            Add what you know
            {c.evidence ? <span className="cf-why"> — {c.evidence}</span> : null}
          </label>
          <div className="cf-chips">
            {["Yes", "No", "Not sure"].map((chip) => (
              <button type="button" key={chip} className="cf-chip" disabled={busy || draft.trim().length > 0} onClick={() => setDraft(chip)}>
                {chip}
              </button>
            ))}
          </div>
          <textarea
            id={`${fid}-a`}
            className="cf-input"
            rows={2}
            value={draft}
            placeholder="e.g. Yes — my oncologist ordered these during routine care in March."
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
          />
          {error && <div className="cf-error">{error}</div>}
          <div className="cf-actions">
            <button className="cf-submit" onClick={submit} disabled={busy || !draft.trim()}>
              {busy ? "Re-checking…" : "Submit"}
            </button>
            <button
              className="cf-defer"
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onOpenNextSteps();
              }}
            >
              I don&apos;t have this yet — add to Next Steps
            </button>
          </div>
          <p className="cf-note">Your answer is saved to your profile and used to re-check every trial. It never gets guessed into a pass or fail.</p>
        </div>
      )}
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

/* ---- resolving a "confirm": state updates that reconcile with the server ---- */

/* Turn a criterion requirement into a short profile field label (told-by-you). */
function confirmFieldLabel(requirement: string): string {
  const s = requirement.trim().replace(/\s+/g, " ");
  return s.length > 48 ? `${s.slice(0, 46)}…` : s;
}

/* Apply re-judged verdicts to specific criterion indices of one trial, then
   re-derive that trial's status and met tally from the SAME shared logic the
   server used — so a resolved "confirm" reconciles exactly, never drifts. */
function applyReverdicts(
  prev: MatchResponse | null,
  nctId: string,
  indices: number[],
  verdicts: { verdict: Verdict; evidence: string }[],
): MatchResponse | null {
  if (!prev) return prev;
  const matches = prev.matches.map((m) => {
    if (m.nctId !== nctId) return m;
    const criteria = m.criteria.map((c, i) => {
      const at = indices.indexOf(i);
      if (at === -1 || !verdicts[at]) return c;
      return { ...c, verdict: verdicts[at].verdict, evidence: verdicts[at].evidence || c.evidence };
    });
    return { ...m, criteria, status: deriveStatus(criteria), metCount: metCountOf(criteria), total: criteria.length };
  });
  return { ...prev, matches, counts: recomputeCounts(prev.counts, matches) };
}

/* Keep the header status buckets honest after a criterion flips a trial's status. */
function recomputeCounts(base: Counts, matches: TrialMatch[]): Counts {
  const reasoned = matches.filter((m) => m.status !== "screened");
  return {
    ...base,
    eligible: reasoned.filter((m) => m.status === "eligible").length,
    uncertain: reasoned.filter((m) => m.status === "uncertain").length,
    near: reasoned.filter((m) => m.status === "near").length,
  };
}

/* Run fn over items with at most `limit` in flight — polite background concurrency. */
async function runBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

/* ---- "Your next steps": the on-screen handoff for items the patient can't
   resolve on the spot. Batches every open to-confirm across the reasoned trials,
   grouped by trial, with the questions to bring to the care team and the nearest
   site — the honest to-do list a study team ultimately confirms. ---- */
function NextStepsPanel({ matches, onClose }: { matches: TrialMatch[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trials = matches
    .filter((m) => m.status !== "screened")
    .map((m) => ({ m, confirms: m.criteria.filter((c) => c.verdict === "confirm") }))
    .filter((t) => t.confirms.length > 0);
  const totalOpen = trials.reduce((n, t) => n + t.confirms.length, 0);

  return (
    <div className="ns-overlay" role="dialog" aria-modal="true" aria-label="Your next steps" onClick={onClose}>
      <div className="ns-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ns-head">
          <div>
            <h2>Your next steps</h2>
            <p className="ns-sub">
              {totalOpen > 0
                ? `${totalOpen} open item${totalOpen > 1 ? "s" : ""} to check with your care team. A study team confirms eligibility — this is the list to bring them.`
                : "You've answered every open item we could re-check."}
            </p>
          </div>
          <button className="ns-close" onClick={onClose} aria-label="Close next steps">
            ✕
          </button>
        </div>

        <div className="ns-body">
          {trials.length === 0 && (
            <div className="ns-empty">Nothing outstanding right now. Any item we can&apos;t decide from your record will show up here to confirm.</div>
          )}
          {trials.map(({ m, confirms }) => (
            <section className="ns-trial" key={m.nctId}>
              <div className="ns-trial-h">
                <a className="nct" href={m.url} target="_blank" rel="noopener noreferrer">
                  {m.nctId} ↗
                </a>
                <span className="ns-title">{m.title}</span>
              </div>
              <div className="ns-site">
                <span title="Approximate — matched on city/state">◎ {m.factors.nearestSite}</span>
                {m.factors.enrollmentWindow && <span className="ns-enroll">{m.factors.enrollmentWindow}</span>}
              </div>

              <div className="ns-sec-h unc">To confirm · {confirms.length}</div>
              <ul className="ns-confirms">
                {confirms.map((c, i) => (
                  <li key={i}>
                    <span className={`ck ${c.kind}`}>{c.kind}</span>
                    <span className="ns-req">
                      {c.requirement}
                      {c.evidence ? <span className="ev">{c.evidence}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>

              {m.brief && m.brief.questionsToAsk.length > 0 && (
                <>
                  <div className="ns-sec-h">Questions to ask your care team</div>
                  <ul className="ns-questions">
                    {m.brief.questionsToAsk.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ))}
        </div>

        <div className="ns-foot disclaimer">
          Informational decision support to review with your care team — not medical advice, and it does not choose for you. Only a study team can confirm whether you
          qualify.
        </div>
      </div>
    </div>
  );
}
