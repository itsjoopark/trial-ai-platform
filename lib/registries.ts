/* ============================================================================
   Trialign — registry-agnostic retrieval layer

   ClinicalTrials.gov is not a catch-all: not every study registers there, and
   many cross-register with national/regional registries. So retrieval is
   modeled as a set of *adapters* behind one interface. Adding a registry is a
   new adapter here — never a rewrite of the match route.

   Today only the ClinicalTrials.gov adapter is live. The others are declared
   (so the roadmap is legible and the wiring is real) but disabled until their
   normalization is built. `searchRegistries()` fans out across every ENABLED
   adapter, tags each Trial with its source registry, and de-duplicates
   cross-registered studies by a shared registration id where we can.
   ========================================================================== */

import type { Trial } from "./types";
import { searchTrials, type SearchOptions } from "./ctgov";

/** One trial registry we can retrieve recruiting studies from. */
export type Registry = {
  /** Stable id, e.g. "ctgov". */
  id: string;
  /** Display name, e.g. "ClinicalTrials.gov". */
  name: string;
  /** Home URL, for attribution in the UI. */
  url: string;
  /** Live today, or a declared-but-not-yet-implemented roadmap adapter. */
  enabled: boolean;
  /** Fetch normalized recruiting Trials for a condition. */
  search(opts: SearchOptions): Promise<Trial[]>;
};

/** Not-yet-implemented adapter body — keeps the interface honest without faking data. */
function notImplemented(name: string): Registry["search"] {
  return async () => {
    throw new Error(`${name} adapter is not implemented yet.`);
  };
}

/* ---- the ClinicalTrials.gov adapter (the only live one today) ---- */
const ctgov: Registry = {
  id: "ctgov",
  name: "ClinicalTrials.gov",
  url: "https://clinicaltrials.gov/",
  enabled: true,
  search: (opts) => searchTrials(opts),
};

/* ---- declared roadmap adapters (disabled; see PRD P2.4) ----
   Each is a normalization job, not an architectural change: implement `search`
   to return the shared Trial shape and flip `enabled` to true. */
const isrctn: Registry = {
  id: "isrctn",
  name: "ISRCTN (UK)",
  url: "https://www.isrctn.com/",
  enabled: false,
  search: notImplemented("ISRCTN"),
};
const euCtis: Registry = {
  id: "eu-ctis",
  name: "EU CTIS / EU Clinical Trials Register",
  url: "https://euclinicaltrials.eu/",
  enabled: false,
  search: notImplemented("EU CTIS"),
};
const healthCanada: Registry = {
  id: "health-canada",
  name: "Health Canada Clinical Trials Database",
  url: "https://health-products.canada.ca/ctdb-bdec/",
  enabled: false,
  search: notImplemented("Health Canada"),
};

/** Every registry we know about — live and roadmap — in display order. */
export const REGISTRIES: Registry[] = [ctgov, isrctn, euCtis, healthCanada];

/** The subset we actually query today. */
export function enabledRegistries(): Registry[] {
  return REGISTRIES.filter((r) => r.enabled);
}

/**
 * Fan out a condition search across every enabled registry, tag each Trial with
 * its source, and de-duplicate obvious cross-registrations by NCT id. A single
 * registry failing does not sink the whole search — it's logged and skipped.
 */
export async function searchRegistries(opts: SearchOptions): Promise<Trial[]> {
  const live = enabledRegistries();
  const settled = await Promise.allSettled(live.map((r) => r.search(opts)));

  const seen = new Set<string>();
  const merged: Trial[] = [];
  settled.forEach((result, i) => {
    if (result.status === "rejected") {
      console.warn(`[registries] ${live[i].name} search failed:`, result.reason);
      return;
    }
    for (const trial of result.value) {
      const key = trial.nctId || `${live[i].id}:${trial.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...trial, registry: trial.registry || live[i].name });
    }
  });

  // If every enabled registry failed, surface it rather than returning empty.
  if (merged.length === 0 && settled.every((s) => s.status === "rejected")) {
    const first = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
    throw first?.reason instanceof Error ? first.reason : new Error("All registry searches failed.");
  }
  return merged;
}
