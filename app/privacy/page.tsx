import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy & data handling · Trialign",
  description:
    "How Trialign handles data, where inference happens, PHI boundaries, and retention — the compliance detail partner organizations need before inputting patient data.",
};

/* ============================================================================
   /privacy — dedicated privacy & compliance guide (PRD P2.5)

   Named by the reviewer as the #1 pre-adoption requirement for partner orgs and
   clinical-data professionals. This is the standalone, stringent reference the
   footer summary points to. Content only — not a legal contract.
   ========================================================================== */

const UPDATED = "July 2026";

export default function PrivacyPage() {
  return (
    <div className="legal">
      <div className="legal-inner">
        <p className="legal-eyebrow">
          <Link href="/">← Back to Trialign</Link>
        </p>

        <header className="legal-head">
          <h1>Privacy &amp; data handling</h1>
          <p className="legal-lede">
            The detailed reference for clinical-data professionals and partner organizations evaluating Trialign. It covers what
            data we touch, where inference happens, the PHI boundaries we enforce, and how long anything is kept.
          </p>
          <p className="legal-meta">
            Last updated {UPDATED} · This is product documentation, not legal advice or a contract. A signed Business Associate
            Agreement (BAA) and Data Processing Agreement govern any production use with real patient data.
          </p>
        </header>

        <div className="legal-callout">
          <strong>Demo posture.</strong> This hackathon build is for evaluation with <b>synthetic personas only</b>. Do not enter
          real protected health information (PHI). The safeguards below describe the intended production design; the demo does not
          persist records or execute a BAA.
        </div>

        <section className="legal-sec">
          <h2>1. What data Trialign processes</h2>
          <ul>
            <li>
              <b>The information you enter</b> — the free-text note or structured fields describing a patient, plus the intake
              preferences (travel radius, study-type, randomization) and the location you provide for distance filtering.
            </li>
            <li>
              <b>Derived profile</b> — the structured profile the model extracts from your note (diagnosis, biomarkers, prior
              therapies, and any gaps it flags).
            </li>
            <li>
              <b>Public registry data</b> — recruiting studies pulled live from ClinicalTrials.gov. This is public data and
              contains no patient information.
            </li>
          </ul>
        </section>

        <section className="legal-sec">
          <h2>2. Where inference happens</h2>
          <p>
            All model reasoning runs <b>server-side</b>, in route handlers on the application server. Your entered note is sent
            from your browser to that server over TLS, then to the Anthropic API for extraction and per-criterion eligibility
            reasoning. The Anthropic API key never reaches the browser, and registry calls to ClinicalTrials.gov are proxied
            server-side (the browser never calls the registry directly).
          </p>
          <ul>
            <li>Model provider: Anthropic (Claude). Inputs are processed to return the structured profile and the ledger.</li>
            <li>
              Trialign does not use your entered data to train models, and Anthropic does not train on API traffic under its
              commercial terms.
            </li>
            <li>Registry provider: ClinicalTrials.gov (U.S. National Library of Medicine) — public data, no PHI transmitted.</li>
          </ul>
        </section>

        <section className="legal-sec">
          <h2>3. PHI boundaries</h2>
          <ul>
            <li>
              <b>Minimum necessary.</b> Only the fields needed to reason eligibility are sent downstream. Direct identifiers (name,
              MRN, contact details) are not required by the workflow and should be omitted.
            </li>
            <li>
              <b>Decision support, not a determination.</b> Output is informational support for a qualified reviewer. It is never a
              final eligibility decision, diagnosis, or treatment recommendation.
            </li>
            <li>
              <b>Role-based access &amp; audit logging.</b> In production, access to entered records is role-based and logged, with
              administrative, physical, and technical safeguards consistent with the HIPAA Security Rule.
            </li>
            <li>
              <b>Encryption.</b> Data is encrypted in transit (TLS) and, in production, at rest.
            </li>
          </ul>
        </section>

        <section className="legal-sec">
          <h2>4. Retention &amp; deletion</h2>
          <ul>
            <li>
              <b>Demo:</b> entered data lives in your browser session for the duration of a search and is not persisted server-side
              beyond the request needed to process it.
            </li>
            <li>
              <b>Production:</b> retention windows are set in the BAA/DPA with the covered entity. Users may request access,
              amendment, or deletion of personal data subject to applicable law and contractual obligations.
            </li>
          </ul>
        </section>

        <section className="legal-sec">
          <h2>5. Registry coverage &amp; limits</h2>
          <p>
            Trialign screens against ClinicalTrials.gov today. It is not a catch-all: some studies register only with national or
            regional registries (ISRCTN, EU CTIS, Health Canada, and others). Retrieval is built as a registry-agnostic adapter
            layer so additional registries can be added without changing how eligibility is reasoned. Absence of a match here is
            not evidence that no trial exists.
          </p>
        </section>

        <section className="legal-sec">
          <h2>6. Contact</h2>
          <p>
            Report a security or privacy concern, or request a BAA, at{" "}
            <a href="mailto:privacy@trial.health">privacy@trial.health</a>.
          </p>
        </section>

        <p className="legal-foot">
          <Link href="/">← Back to Trialign</Link>
        </p>
      </div>
    </div>
  );
}
