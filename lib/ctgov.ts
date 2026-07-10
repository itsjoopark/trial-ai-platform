/* ============================================================================
   Trial — ClinicalTrials.gov v2 client

   Server-side only. The public v2 API needs no key but does NOT send CORS
   headers, so the browser can't call it directly — everything here runs in a
   Node route handler. We ask for a field allowlist to keep payloads small and
   normalize each study into the app's Trial shape.

   Base + params verified live:
     GET https://clinicaltrials.gov/api/v2/studies
       ?query.cond=breast+cancer
       &filter.overallStatus=RECRUITING
       &pageSize=30
       &fields=<allowlist>
   ========================================================================== */

import type { Trial, TrialLocation } from "./types";

const BASE = "https://clinicaltrials.gov/api/v2/studies";

const FIELDS = [
  "protocolSection.identificationModule",
  "protocolSection.statusModule.overallStatus",
  "protocolSection.designModule",
  "protocolSection.conditionsModule",
  "protocolSection.sponsorCollaboratorsModule.leadSponsor",
  "protocolSection.eligibilityModule",
  "protocolSection.contactsLocationsModule.locations",
].join(",");

export type SearchOptions = {
  cond: string;
  status?: string; // default RECRUITING
  pageSize?: number; // default 30
};

/** Search recruiting trials for a condition and return normalized Trial[]. */
export async function searchTrials(opts: SearchOptions): Promise<Trial[]> {
  const params = new URLSearchParams();
  if (opts.cond) params.set("query.cond", opts.cond);
  params.set("filter.overallStatus", opts.status ?? "RECRUITING");
  params.set("pageSize", String(opts.pageSize ?? 30));
  params.set("fields", FIELDS);

  const res = await fetch(`${BASE}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    // These change on the registry's cadence, not per user — but we never want
    // a stale cached page to hide a newly recruiting trial. Freshness is the
    // differentiator; always hit the source.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`ClinicalTrials.gov responded ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { studies?: RawStudy[] };
  return (data.studies ?? []).map(normalizeStudy).filter((t): t is Trial => t !== null);
}

/* ---- normalization ---- */

// Minimal shapes for the modules we read. Everything is optional because the
// registry omits empty fields.
type RawStudy = {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string; officialTitle?: string };
    statusModule?: { overallStatus?: string };
    designModule?: { studyType?: string; phases?: string[] };
    conditionsModule?: { conditions?: string[] };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    eligibilityModule?: {
      eligibilityCriteria?: string;
      sex?: string;
      minimumAge?: string;
      stdAges?: string[];
    };
    contactsLocationsModule?: { locations?: RawLocation[] };
  };
};

type RawLocation = {
  facility?: string;
  city?: string;
  state?: string;
  country?: string;
  status?: string;
};

function normalizeStudy(study: RawStudy): Trial | null {
  const p = study.protocolSection;
  const id = p?.identificationModule;
  if (!id?.nctId) return null;

  const locations: TrialLocation[] = (p?.contactsLocationsModule?.locations ?? []).map((l) => ({
    facility: l.facility ?? "",
    city: l.city ?? "",
    state: l.state ?? "",
    country: l.country ?? "",
    status: l.status ?? "",
  }));

  return {
    nctId: id.nctId,
    title: id.briefTitle ?? "(untitled study)",
    officialTitle: id.officialTitle ?? "",
    phase: formatPhases(p?.designModule?.phases),
    studyType: titleCase(p?.designModule?.studyType ?? ""),
    overallStatus: p?.statusModule?.overallStatus ?? "",
    sponsor: p?.sponsorCollaboratorsModule?.leadSponsor?.name ?? "—",
    conditions: p?.conditionsModule?.conditions ?? [],
    eligibilityCriteria: p?.eligibilityModule?.eligibilityCriteria ?? "",
    sex: p?.eligibilityModule?.sex ?? "",
    minimumAge: p?.eligibilityModule?.minimumAge ?? "",
    stdAges: p?.eligibilityModule?.stdAges ?? [],
    locations,
    url: `https://clinicaltrials.gov/study/${id.nctId}`,
  };
}

function formatPhases(phases?: string[]): string {
  if (!phases || phases.length === 0) return "N/A";
  const map = (ph: string): string => {
    switch (ph) {
      case "NA":
        return "N/A";
      case "EARLY_PHASE1":
        return "Early Phase 1";
      case "PHASE1":
        return "Phase 1";
      case "PHASE2":
        return "Phase 2";
      case "PHASE3":
        return "Phase 3";
      case "PHASE4":
        return "Phase 4";
      default:
        return titleCase(ph.replace(/_/g, " "));
    }
  };
  // Registry lists combined phases as separate entries (e.g. ["PHASE1","PHASE2"]).
  const labels = phases.map(map);
  if (labels.length === 2 && labels[0].startsWith("Phase") && labels[1].startsWith("Phase")) {
    return `Phase ${labels[0].split(" ")[1]}/${labels[1].split(" ")[1]}`;
  }
  return labels.join(", ");
}

function titleCase(s: string): string {
  if (!s) return s;
  return s
    .toLowerCase()
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
