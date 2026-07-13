/* ============================================================================
   Trial — bundled mCODE R4 oncology test patients

   The public SMART open sandbox has real FHIR mechanics but no DocumentReferences
   and no oncology data, so it can't demonstrate the moat on its own (§5). These
   local mCODE 4.0.0 / US Core 6.1.0 test patients close that gap: real FHIR R4
   resources whose STRUCTURED half carries what a (g)(10) pull reliably gives us
   (demographics, cancer condition + stage, receptor tumor markers, ECOG, meds)
   and whose DocumentReference NOTE carries exactly what FHIR can't (PIK3CA, RECIST
   measurable disease, the last fulvestrant dose for washout, 1L→2L sequencing).

   They run through the identical `composeDocument` path as a live pull, so the
   base64 DocumentReference→narrative decoding is exercised for real.
   ========================================================================== */

import { composeDocument, type ComposedRecord, type FhirResource, type PatientSummary } from "./client";

/** Inline a plain-text note as a base64 DocumentReference attachment, exactly as
 *  a certified EHR would return it. Encoded at import time so the fixture stays
 *  readable in source. */
function noteDocRef(id: string, subject: string, kind: string, date: string, narrative: string): FhirResource {
  return {
    resourceType: "DocumentReference",
    id,
    status: "current",
    type: { text: kind, coding: [{ system: "http://loinc.org", code: "11506-3", display: "Progress note" }] },
    date,
    subject: { reference: `Patient/${subject}` },
    content: [
      {
        attachment: {
          contentType: "text/plain",
          title: kind,
          data: Buffer.from(narrative, "utf8").toString("base64"),
        },
      },
    ],
  };
}

/* ---- Patient 1: HR+/HER2− metastatic breast cancer (the flagship moat demo) ---- */

const MARGARET_ID = "trial-mcode-001";

const MARGARET_NOTE = `ONCOLOGY PROGRESS NOTE
Patient: 62F. ECOG performance status 1.

Assessment: HR-positive, HER2-negative (IHC 1+) metastatic invasive ductal carcinoma of
the left breast, stage IV with osseous and hepatic metastases.

Molecular: NGS on the liver biopsy shows PIK3CA H1047R (activating). BRCA1/2 wild type.
MSI-stable, TMB low.

Disease status (RECIST 1.1): measurable disease — target lesions are a 2.4 cm segment VII
hepatic lesion and a 1.8 cm segment IVb lesion. Most recent restaging CT chest/abdomen/pelvis
2026-06-08. New progression in the liver versus the March scan.

Therapy history:
- 1L letrozole + palbociclib, started 2024-03, progression 2025-12.
- 2L fulvestrant, started 2026-01. LAST FULVESTRANT DOSE 2026-06-10 (relevant to washout for
  any trial requiring a treatment-free interval). Progression 2026-06.

Plan: evaluate for a PIK3CA-directed trial (alpelisib-based or novel PI3K/AKT combinations).
Confirm adequate organ function and a treatment-free washout window before enrollment.`;

const MARGARET_RESOURCES: FhirResource[] = [
  {
    resourceType: "Patient",
    id: MARGARET_ID,
    name: [{ family: "Okafor", given: ["Margaret"], text: "Margaret Okafor" }],
    gender: "female",
    birthDate: "1963-04-12",
    address: [{ postalCode: "02115", city: "Boston", state: "MA" }],
  },
  {
    resourceType: "Condition",
    id: `${MARGARET_ID}-cond-primary`,
    // mcode-primary-cancer-condition
    code: { text: "Malignant neoplasm of left breast, stage IV", coding: [{ system: "http://snomed.info/sct", code: "254837009", display: "Malignant tumor of breast" }] },
    clinicalStatus: { text: "active", coding: [{ code: "active" }] },
    onsetDateTime: "2024-02",
  },
  {
    resourceType: "Condition",
    id: `${MARGARET_ID}-cond-secondary`,
    // mcode-secondary-cancer-condition
    code: { text: "Secondary malignant neoplasm of bone and liver", coding: [{ system: "http://snomed.info/sct", code: "94222008", display: "Secondary malignant neoplasm of bone" }] },
    clinicalStatus: { text: "active", coding: [{ code: "active" }] },
    onsetDateTime: "2025-12",
  },
  {
    resourceType: "Observation",
    id: `${MARGARET_ID}-er`,
    // mcode-tumor-marker-test
    code: { text: "Estrogen receptor (ER) status", coding: [{ system: "http://loinc.org", code: "16112-5", display: "Estrogen receptor" }] },
    effectiveDateTime: "2024-02-20",
    valueString: "Positive, 90%",
  },
  {
    resourceType: "Observation",
    id: `${MARGARET_ID}-pr`,
    code: { text: "Progesterone receptor (PR) status", coding: [{ system: "http://loinc.org", code: "16113-3", display: "Progesterone receptor" }] },
    effectiveDateTime: "2024-02-20",
    valueString: "Positive, 60%",
  },
  {
    resourceType: "Observation",
    id: `${MARGARET_ID}-her2`,
    code: { text: "HER2 receptor status (IHC)", coding: [{ system: "http://loinc.org", code: "48676-1", display: "HER2 receptor" }] },
    effectiveDateTime: "2024-02-20",
    valueString: "Negative (IHC 1+)",
  },
  {
    resourceType: "Observation",
    id: `${MARGARET_ID}-ecog`,
    // mcode-ecog-performance-status
    code: { text: "ECOG performance status", coding: [{ system: "http://loinc.org", code: "89247-1", display: "ECOG performance status" }] },
    effectiveDateTime: "2026-06-08",
    valueQuantity: { value: 1, unit: "{score}" },
  },
  {
    resourceType: "MedicationRequest",
    id: `${MARGARET_ID}-med-letrozole`,
    medicationCodeableConcept: { text: "Letrozole 2.5 mg oral (1L, with palbociclib)" },
    status: "completed",
    authoredOn: "2024-03",
  },
  {
    resourceType: "MedicationRequest",
    id: `${MARGARET_ID}-med-palbo`,
    medicationCodeableConcept: { text: "Palbociclib 125 mg oral (1L)" },
    status: "completed",
    authoredOn: "2024-03",
  },
  {
    resourceType: "MedicationRequest",
    id: `${MARGARET_ID}-med-fulv`,
    medicationCodeableConcept: { text: "Fulvestrant 500 mg IM (2L)" },
    status: "active",
    authoredOn: "2026-01",
  },
  noteDocRef(`${MARGARET_ID}-note`, MARGARET_ID, "Oncology progress note", "2026-06-11", MARGARET_NOTE),
];

/* ---- registry of bundled patients ---- */

type BundledPatient = { id: string; label: string; summary: string; resources: FhirResource[] };

const BUNDLED: BundledPatient[] = [
  {
    id: MARGARET_ID,
    label: "Margaret Okafor (mCODE test patient)",
    summary: "HR+/HER2− metastatic breast cancer · PIK3CA+ · progress note attached",
    resources: MARGARET_RESOURCES,
  },
];

export function listBundled(): PatientSummary[] {
  return BUNDLED.map(({ id, label, summary }) => ({ id, label, summary }));
}

export async function bundledDocument(id: string): Promise<ComposedRecord | null> {
  const p = BUNDLED.find((b) => b.id === id);
  if (!p) return null;
  // No network: inline base64 narratives resolve locally.
  return composeDocument(p.resources, /* allowNetwork */ false);
}
