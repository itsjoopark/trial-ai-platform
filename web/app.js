/* ============================================================================
   Trial — coordinator trial matcher (frontend base)

   Agentic onboarding → results, per PRD v4 §5 (the eight phases):
     landing → capture → clarify → confirm → reason → results
   State machine renders one phase at a time into #app; every phase is a
   visible, editable artifact (that transparency is the trust surface).

   PORTING SEAMS — this is a UI scaffold with MOCK data. Swap these for the
   agent/API layer, keep the render + state machine:
     • NOTE / FIELDS      → POST /extract   (note → structured profile)
     • CLARIFY            → GET  /clarify    (only matching-relevant gaps)
     • FACETS             → agent-derived, from the extracted profile (§6.5)
     • RESULTS            → POST /rank       (retrieve + segment + reason + critic)
   All trial data below is SAMPLE data and is labelled as such in the UI.
   No real PHI — synthetic personas only.
   ========================================================================== */

/* ---------------- sample data ---------------- */
const NOTE = `61F, ECOG 1. HR-positive (ER 90%, PR 60%), HER2-negative (IHC 1+) metastatic breast ca, stage IV. 1L letrozole+palbociclib (3/2024) → PD 12/2025. 2L fulvestrant (1/2026) → PD 6/2026. Trial of pembrolizumab on a prior protocol. PIK3CA H1047R+, BRCA wt. Boston MA.`;
const FIELDS = [
  {k:"Diagnosis", v:"Metastatic breast cancer"},
  {k:"Receptors", v:"HR-positive · HER2-negative (IHC 1+)", mono:true},
  {k:"Stage / ECOG", v:"Stage IV · ECOG 1"},
  {k:"Prior lines", v:"1L letrozole+palbociclib → 2L fulvestrant · prior anti-PD-1 (pembrolizumab)"},
  {k:"Biomarkers", v:"PIK3CA H1047R+ · BRCA wt", mono:true},
  {k:"Recent scan", v:"— not found in note", gap:true},
  {k:"Location", v:"Boston, MA"},
];
const CLARIFY = [
  { q:"I read this as HR-positive, HER2-negative metastatic breast cancer. Screen for that?",
    w:"I'll use it as the primary condition gate; you can widen it later.",
    options:[{t:"Yes — HR+/HER2− breast cancer", d:"Use what you read from the note"},
             {t:"Something else", d:"Type the condition or health area"}],
    agent:"Let the agent decide from the note" },
  { q:"No recent scan date in the note — that gates several trials.",
    w:"Some studies require imaging within 28 days. Add a date, or I proceed and flag those criteria as uncertain.",
    options:[{t:"Scan was Jun 28, 2026", d:"Add it — unlocks scan-gated trials"},
             {t:"Proceed and flag as uncertain", d:"Surface those as to-dos, don't drop them"},
             {t:"No recent scan", d:"Exclude scan-gated trials for now"}],
    agent:"Let the agent decide" },
  { q:"How far should this patient travel for a site?",
    w:"I'll pre-apply this as a location filter you can adjust on the results.",
    options:[{t:"Within 25 miles", d:"Local sites only"},
             {t:"Within 100 miles", d:"Regional travel OK"},
             {t:"Anywhere", d:"Travel for the right trial"}],
    agent:"Let the agent decide" },
];
const FACETS=[
  {id:"status",label:"Status",preset:"recruiting",options:[{l:"Recruiting",c:24,sel:true},{l:"Not recruiting",c:190},{l:"Any",c:214}]},
  {id:"cond",label:"Condition",preset:"from note: breast cancer",options:[{l:"Breast cancer",c:24,sel:true},{l:"Solid tumor",c:61}]},
  {id:"phase",label:"Phase",preset:"any",options:[{l:"Any",c:24,sel:true},{l:"Phase 1",c:6},{l:"Phase 2",c:11},{l:"Phase 3",c:5}]},
  {id:"dist",label:"Location",preset:"within 100 mi",options:[{l:"Within 25 mi",c:7},{l:"Within 100 mi",c:15,sel:true},{l:"Anywhere",c:24}]},
];
const RESULTS=[
  {nct:"NCT05127408",status:"eligible",lead:true,title:"Phase 2 antibody–drug conjugate in HER2-low metastatic breast cancer",phase:"Phase 2",sponsor:"Sample Cancer Center",sites:"12 of 12 sites · 0.8 mi",
   crit:[{k:"meets",ck:"meets",t:"<b>HER2-low / HER2-negative</b> disease — matches note"},{k:"meets",ck:"meets",t:"≥1 prior line of systemic therapy (<b>2 lines</b>)"},{k:"meets",ck:"meets",t:"ECOG 0–1 (<b>ECOG 1</b>)"}]},
  {nct:"NCT04983745",status:"near",title:"Immunotherapy combination in advanced triple-negative breast cancer",phase:"Phase 2",sponsor:"Sample Oncology Group",sites:"8 sites",
   crit:[{k:"meets",ck:"meets",t:"Measurable disease per RECIST 1.1"},{k:"fails",ck:"fails",t:"Excludes prior anti-PD-1 — note lists <b>pembrolizumab</b>"},{k:"fails",ck:"fails",t:"Requires TNBC — patient is <b>HR-positive</b>"}]},
  {nct:"NCT05661280",status:"uncertain",title:"CDK4/6 inhibitor maintenance after first progression",phase:"Phase 3",sponsor:"Sample Trials Network",sites:"20 sites",
   crit:[{k:"meets",ck:"meets",t:"HR-positive, HER2-negative disease"},{k:"unc",ck:"confirm",t:"Requires scan &lt; 28 days — <b>confirm imaging date</b>"},{k:"unc",ck:"confirm",t:"Adequate organ function — <b>labs not in note</b>"}]},
];

/* ---------------- state ---------------- */
let S={phase:"landing",step:0,answers:[],scanAdded:false,theme:"light"};
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const PHASES=[["capture","Capture"],["clarify","Clarify"],["confirm","Confirm"],["results","Results"]];

/* ---------------- header ---------------- */
function head(){
  const order=["landing","capture","clarify","confirm","reason","results"];
  const cur=order.indexOf(S.phase);
  const track=PHASES.map(([id,label])=>{
    const idx=order.indexOf(id);
    const cls=S.phase===id||(id==="results"&&S.phase==="reason")?"on":(idx<cur?"done":"");
    return `<span class="p ${cls}"><b>${label}</b></span>`;
  }).join('<span class="sep"></span>');
  return `<div class="top">
    <span class="brand"><span class="mk"></span>Trial <small>console</small></span>
    <span class="phasetrack">${track}</span>
    <button class="tbtn" id="theme">${S.theme==='dark'?'☀ Light':'☾ Dark'}</button>
    <button class="tbtn" id="restart">Restart</button>
  </div>`;
}

/* ---------------- phases ---------------- */
function landing(){
  return `<div class="scroll"><div class="col">
    <div class="hero">
      <div class="k">Coordinator screening · single patient</div>
      <h1>Paste a patient's notes. I'll surface the trials they're eligible for — with the reasoning for every match.</h1>
      <p>Drop a messy note or describe the patient. I read it into a structured profile, ask only the questions that change a match, then screen live against recruiting ClinicalTrials.gov studies.</p>
      <div class="paste">
        <textarea id="note" placeholder="Paste a patient note, type a description, or upload a PDF…"></textarea>
        <div class="row"><span class="hint">⌘↵ to send</span><span class="sp"></span>
          <button class="btn" id="upload">Upload PDF</button>
          <button class="btn go" id="run">Read the note →</button></div>
      </div>
      <div class="chips">
        <button class="chip" id="sample"><span class="s">demo</span> Try a sample patient (Margaret)</button>
        <button class="chip" id="paste2">Paste example note</button>
      </div>
      <div class="disclaimer" style="margin-top:20px">Informational decision support for a coordinator's review — not medical advice or a final eligibility determination. Synthetic personas only; no real patient data.</div>
    </div>
  </div></div>`;
}

function capture(){
  const rows=FIELDS.map((f,i)=>{
    const v=f.gap?`<span class="gap">${esc(f.v)}</span>`:(f.mono?`<span class="mono">${esc(f.v)}</span>`:esc(f.v));
    return `<div class="frow" style="animation-delay:${reduce?0:i*0.32}s"><span class="k">${esc(f.k)}</span><span class="v">${v}</span></div>`;
  }).join('');
  const total=reduce?0:FIELDS.length*0.32+0.3;
  setTimeout(()=>{const c=document.getElementById('cont');if(c)c.style.display='flex';}, total*1000);
  return `<div class="scroll"><div class="col">
    <div class="umsg"><div class="bub">Screen this patient for recruiting trials she's eligible for.</div></div>
    <div class="agent-say"><span class="av">✳</span><div class="body">
      <div class="who">Coordinating agent · reading the note</div>
      <div class="note-src">${esc(NOTE)}</div>
      <div class="readout">
        <div class="rh"><span class="pulse"></span> Building structured profile</div>
        ${rows}
      </div>
      <div class="continue-row" id="cont" style="display:none">
        <button class="btn go" id="toclarify">Continue — a few quick questions</button>
        <span class="n">1 gap found · I'll ask only what changes a match</span>
      </div>
    </div></div>
  </div></div>`;
}

function clarify(){
  const qcards=CLARIFY.map((c,i)=>{const a=S.answers[i];
    return `<div class="qcard ${a?'answered':''}"><div class="q">${esc(c.q)}</div>${a?`<div class="ans">✓ ${esc(a)}</div>`:`<div class="await">Awaiting your answer…</div>`}</div>`;}).join('');
  const active=S.step<CLARIFY.length?clarifyCard(S.step):'';
  return `<div class="scroll"><div class="col">
    <div class="agent-say"><span class="av">✳</span><div class="body">
      <div class="who">Coordinating agent</div>
      <div>Profile's in. I only need the gaps that actually change which trials qualify:</div>
    </div></div>
    <div class="qlist">${qcards}</div>
    ${active}
  </div></div>`;
}
function clarifyCard(step){
  const c=CLARIFY[step];
  const dots=CLARIFY.map((_,i)=>`<i class="${i<=step?'on':''}"></i>`).join('');
  const opts=c.options.map((o,i)=>`<div class="opt" data-pick="${esc(o.t)}"><div class="num">${i+1}</div><div><div class="ot">${esc(o.t)}</div><div class="od">${esc(o.d)}</div></div></div>`).join('<div class="divl"></div>');
  return `<div class="clarify">
    <div class="steps"><div class="dots">${dots}</div><div class="stepno">${step+1} of ${CLARIFY.length}</div></div>
    <div class="cq">${esc(c.q)}</div><div class="cw">${esc(c.w)}</div>
    ${opts}<div class="divl"></div>
    <div class="opt agent" data-pick="${esc(c.agent)}"><div class="num">⤳</div><div><div class="ot">${esc(c.agent)}</div></div></div>
    <div class="cfoot"><div class="own"><span>✎</span><input id="own" placeholder="Or type your own answer…"></div>
      ${step>0?`<button class="ghost" id="back">← Back</button>`:''}<button class="ghost" id="skip">Skip</button></div>
  </div>`;
}

function confirm(){
  const p=[
    ["Diagnosis","Metastatic breast cancer",false],
    ["Receptors","HR-positive · HER2-negative (IHC 1+)",true],
    ["Stage / ECOG","Stage IV · ECOG 1",false],
    ["Prior therapy","1L letrozole+palbociclib · 2L fulvestrant · prior anti-PD-1",false],
    ["Biomarkers","PIK3CA H1047R+ · BRCA wt",true],
    ["Recent scan", S.scanAdded?"Jun 28, 2026":"flagged uncertain", false, S.scanAdded],
    ["Location · travel","Boston, MA · within 100 mi",false],
  ].map(([k,v,mono,filled])=>`<div class="prow ${filled?'filled':''}"><span class="k">${esc(k)}</span><span class="v">${mono?`<span class="mono">${esc(v)}</span>`:esc(v)}</span><button class="edit">edit</button></div>`).join('');
  return `<div class="scroll"><div class="col">
    <div class="agent-say"><span class="av">✳</span><div class="body">
      <div class="who">Coordinating agent · trust checkpoint</div>
      <div>Here's the structured patient I'll screen with. Correct anything before I match — this is the record every eligibility call is checked against.</div>
    </div></div>
    <div class="profile">${p}</div>
    <div class="continue-row"><button class="btn go" id="tomatch">Looks right — find trials →</button><span class="n">3 answers applied · 1 field flagged uncertain</span></div>
  </div></div>`;
}

function reason(){
  const lines=[
    ['14:22:04','Querying recruiting studies · <b>query.cond=breast cancer</b> · filter.overallStatus=RECRUITING'],
    ['14:22:05','<span class="ok">214</span> studies → structural gates (age, sex, phase, distance)'],
    ['14:22:06','<span class="ok">24</span> pass condition + recruiting + within 100 mi'],
    ['14:22:07','Segmenting eligibility prose into atomic criteria…'],
    ['14:22:08','Reasoning criterion-by-criterion against the profile…'],
    ['14:22:10','Actor–critic review · forcing "uncertain" where the record is silent'],
    ['14:22:11','<span class="ok">Done</span> · 1 eligible · 1 near-miss (fails closed) · 1 needs info'],
  ];
  const html=lines.map((l,i)=>`<div class="l" style="animation-delay:${reduce?0:i*0.5}s"><span class="t">${l[0]}</span><span>${l[1]}</span></div>`).join('');
  setTimeout(()=>{S.phase='results';render();}, reduce?200:lines.length*500+500);
  return `<div class="scroll"><div class="col">
    <div class="agent-say"><span class="av">✳</span><div class="body">
      <div class="who">Coordinating agent · screening</div>
      <div class="reason">${html}</div>
    </div></div>
  </div></div>`;
}

function results(){
  const refine=FACETS.map(f=>{
    const opts=f.options.map(o=>`<div class="fopt ${o.sel?'sel':''}" data-facet="${f.id}" data-val="${esc(o.l)}"><span class="rad"></span><span>${esc(o.l)}</span><span class="c">${o.c}</span></div>`).join('');
    return `<div class="facet"><div class="fl"><span>${esc(f.label)}</span><span style="color:var(--ink-3)">–</span></div><div class="preset">agent set: ${esc(f.preset)}</div>${opts}</div>`;
  }).join('');
  const cards=RESULTS.map(r=>{
    const label=r.status==='eligible'?'Eligible':r.status==='near'?'Near-miss':'Needs info';
    const crit=r.crit.map(c=>{const cls=c.k==='meets'?'meets':c.k==='fails'?'fails':'unc';const gl=c.k==='meets'?'✓':c.k==='fails'?'✕':'?';
      return `<div class="crow ${cls}"><span class="cd">${gl}</span><span class="ck">${c.ck}</span><span class="cx">${c.t}</span></div>`;}).join('');
    return `<div class="match ${r.lead?'lead':''}"><div class="mh"><div><div class="nct">${r.nct}</div><div class="mt">${esc(r.title)}</div></div><span class="vbadge ${r.status}">${label}</span></div>
      <div class="crit">${crit}</div>
      <div class="meta"><span>${r.phase}</span><span>${esc(r.sponsor)}</span><span class="site">${esc(r.sites)}</span><a href="https://clinicaltrials.gov/study/${r.nct}" target="_blank" rel="noopener">${r.nct} ↗</a></div></div>`;
  }).join('');
  return `<div class="scroll"><div class="col">
    <div class="agent-say"><span class="av">✳</span><div class="body"><div class="who">Coordinating agent</div>
      <div class="summary">Screened <b>24 recruiting trials</b> for a HR+/HER2− metastatic breast cancer patient with 2 prior lines. <b>1 eligible</b>, 1 near-miss (prior anti-PD-1, fails closed), 1 needs a recent scan date. Every call is shown against its criterion.<span class="sample-flag">sample data</span></div>
    </div></div>
    <div class="results">
      <div class="refine"><div class="rt"><span class="h">Refine</span><span class="clr">clear</span></div>
        <div class="agentnote">Filters derived from the note and pre-applied. Adjust to re-screen.</div>${refine}</div>
      <div><div class="mcount">3 of 24 shown · ranked by criteria met</div>${cards}</div>
    </div>
  </div></div>
  <div class="composer"><div class="cwrap">
    <div class="cbox"><input placeholder="Resolve a criterion or ask a follow-up — “her ECOG is 1”, “why is she excluded from NCT04983745?”"><span class="k">Opus 4.8</span><button class="send">✳</button></div>
    <div class="cfollow"><button class="chip">Only within 25 miles</button><button class="chip">Confirm scan date → re-screen</button><button class="chip">Export shortlist</button></div>
  </div></div>`;
}

/* ---------------- render + events ---------------- */
function render(){
  document.documentElement.setAttribute('data-theme', S.theme);
  const app=document.getElementById('app');
  let body='';
  if(S.phase==='landing')body=landing();
  else if(S.phase==='capture')body=capture();
  else if(S.phase==='clarify')body=clarify();
  else if(S.phase==='confirm')body=confirm();
  else if(S.phase==='reason')body=reason();
  else body=results();
  app.innerHTML=head()+body;
  wire();
}
function toCapture(){S.phase='capture';render();}
function answer(v){
  S.answers[S.step]=v;
  if(S.step===1 && /jun 28|scan was/i.test(v)) S.scanAdded=true;
  S.step++;
  if(S.step>=CLARIFY.length)S.phase='confirm';
  render();
}
function wire(){
  const on=(id,fn,ev='click')=>{const e=document.getElementById(id);if(e)e.addEventListener(ev,fn);};
  on('theme',()=>{S.theme=S.theme==='dark'?'light':'dark';render();});
  on('restart',()=>{S={phase:"landing",step:0,answers:[],scanAdded:false,theme:S.theme};render();});
  on('run',toCapture); on('sample',toCapture);
  on('paste2',()=>{const n=document.getElementById('note');if(n)n.value=NOTE;});
  on('upload',()=>{const n=document.getElementById('note');if(n){n.value=NOTE;n.focus();}});
  const note=document.getElementById('note');
  if(note)note.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();toCapture();}});
  on('toclarify',()=>{S.phase='clarify';S.step=0;S.answers=[];render();});
  document.querySelectorAll('[data-pick]').forEach(o=>o.addEventListener('click',()=>answer(o.getAttribute('data-pick'))));
  const own=document.getElementById('own');
  if(own)own.addEventListener('keydown',e=>{if(e.key==='Enter'&&own.value.trim()){e.preventDefault();answer(own.value.trim());}});
  on('skip',()=>answer('(skipped — flagged uncertain)'));
  on('back',()=>{if(S.step>0){S.step--;render();}});
  on('tomatch',()=>{S.phase='reason';render();});
  document.querySelectorAll('[data-facet]').forEach(f=>f.addEventListener('click',()=>{
    const id=f.getAttribute('data-facet'),val=f.getAttribute('data-val');
    const fa=FACETS.find(x=>x.id===id);fa.options.forEach(o=>o.sel=(o.l===val));render();
  }));
}
render();
