import type { Express } from "express";
import type { Server } from "http";
import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import type { CountryContext, GenerationResult } from "@shared/schema";

const client = new Anthropic();

// ─── SYSTEM PROMPT: Country Research ─────────────────────────────────────────

const RESEARCH_PROMPT = `You are a research assistant for Alpha Education / 2hr Learning.
Your job is to produce a country context profile for a sales engagement.

CRITICAL: These materials may be presented to heads of state, sovereign rulers, and senior government officials.
- Use formal diplomatic names (e.g., "The United Arab Emirates" not "UAE")
- Use proper honorifics for leaders
- NEVER reference internal tiers, scores, or rankings
- Write with the voice of a trusted advisor presenting to royalty

Return valid JSON matching this exact structure:
{
  "country": "Display name",
  "formalName": "Official diplomatic name",
  "headOfState": "Full name with honorifics",
  "headOfStateTitle": "Their title",
  "flagEmoji": "🇺🇸",
  "population": "Total population (e.g. 10.1 million)",
  "gdpPerCapita": "$XX,XXX",
  "schoolAgePopulation": "X million children aged 5-18",
  "currentEdSpendPerStudent": "$X,XXX per student annually (government spend)",
  "nationalEdVision": "1-2 sentence summary of the country's stated education reform goals",
  "culturalNarrative": "2-3 compelling sentences about why THIS country is uniquely positioned for AI-powered education transformation. Reference specific cultural values, national ambitions, or recent initiatives. This should feel like a senior advisor explaining the opportunity to their leadership.",
  "keyStrengths": ["Strength 1 for partnership", "Strength 2", "Strength 3"],
  "localizedProgramName": "A SHORT brand name for the education program (2-4 words max, like 'Ed71' for UAE or 'Vision2030 Learning' for Saudi). Must be concise enough for a slide title. Reference something culturally meaningful. NEVER include explanations or descriptions — just the brand name itself.",
  "localLifeSkillsFocus": "What life skills matter most in this culture (e.g. entrepreneurship, civic leadership, environmental stewardship). 1-2 sentences.",
  "languageApps": "What localized AI apps would be needed (languages, religious education, cultural studies, ESL). Brief list."
}

Be specific with numbers. Return ONLY the JSON object, no markdown fences.`;

// ─── Fixed Economics (from Ed71 pages 7-8) ───────────────────────────────────

const FIXED_ECONOMICS = {
  upfront: [
    { item: "AlphaCore License", amount: "$250M", recipient: "Alpha Holdings" },
    { item: "EdTech App R&D", amount: "$250M", recipient: "Local expense" },
    { item: "Local Life-Skills R&D", amount: "$250M", recipient: "Local expense" },
    { item: "Management Fee Prepay", amount: "$250M", recipient: "Prepaid OpEx for 100k student-years" },
    { item: "TimeBack License Fee Prepay", amount: "$500M", recipient: "Prepaid OpEx for 100k student-years" },
  ],
  upfrontTotal: "$1.5B",
  ongoing: [
    { item: "Parent Edu / Launch / Guides", amount: "$25-50M / yr", recipient: "Local expense" },
    { item: "Additional School Funding", amount: "$1B / yr*", recipient: "Local expense" },
    { item: "Management Fee", amount: "10% budget", recipient: "OpEx to Alpha Holdings" },
    { item: "TimeBack License Fee", amount: "20% budget", recipient: "OpEx to Alpha Holdings" },
  ],

  costStructure: [
    { item: "Tuition", alpha: "$50,000", national: "$25,000", notes: "Budget for $25,000 school" },
    { item: "Guides", alpha: "$14,000", national: "$4,500", notes: "Alpha 11:1 ratio & higher comp; National 25:1 ratio & lower comp" },
    { item: "Timeback / Software", alpha: "$10,000", national: "$5,000", notes: "20% of Budget" },
    { item: "Programs and Life Skills", alpha: "$9,000", national: "$4,250", notes: "Alpha is 2x other National" },
    { item: "Other HC", alpha: "$1,750", national: "$1,750", notes: "-" },
    { item: "Facility / CapEx", alpha: "$8,750", national: "$3,000", notes: "Includes depreciated capex to convert locations" },
    { item: "Misc Expense", alpha: "$1,500", national: "$1,500", notes: "-" },
    { item: "Management Fee", alpha: "-", national: "$2,500", notes: "10% of Budget" },
    { item: "IP Amortization", alpha: "", national: "$2,072", notes: "Full amortization of IP costs over 5 year target" },
  ],
  scaleTargets: {
    yearOne: "2,000 students / 2 communities",
    fiveYear: "200k students / 50+ communities",
  },
};

// ─── Term Sheet HTML Generator ───────────────────────────────────────────────

function generateTermSheetHtml(ctx: CountryContext): string {
  const upfrontRows = FIXED_ECONOMICS.upfront
    .map(r => `<tr><td>${r.item.replace("EdTech App R&D", `${ctx.country} EdTech App R&D`).replace("Local Life-Skills R&D", `${ctx.localizedProgramName || ctx.country} Life-Skills R&D`)}</td><td class="amt">${r.amount}</td><td>${r.recipient}</td></tr>`)
    .join("\n");

  const ongoingRows = FIXED_ECONOMICS.ongoing
    .map(r => `<tr><td>${r.item}</td><td class="amt">${r.amount}</td><td>${r.recipient}</td></tr>`)
    .join("\n");

  const costRows = FIXED_ECONOMICS.costStructure
    .map(r => `<tr><td>${r.item}</td><td class="amt">${r.alpha}</td><td class="amt highlight">${r.national}</td><td class="notes">${r.notes}</td></tr>`)
    .join("\n");



  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ctx.localizedProgramName || ctx.country} — Term Sheet</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  
  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  @page { 
    size: A4 landscape; 
    margin: 0.5in;
  }
  
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page-break { page-break-before: always; }
  }
  
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 11px;
    color: #1a1a2e;
    line-height: 1.5;
    background: #fff;
  }
  
  .page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 40px;
  }
  
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 32px;
    padding-bottom: 20px;
    border-bottom: 3px solid #0a1628;
  }
  
  .header-left h1 {
    font-size: 24px;
    font-weight: 700;
    color: #0a1628;
    letter-spacing: -0.02em;
    margin-bottom: 4px;
  }
  
  .header-left .subtitle {
    font-size: 13px;
    color: #4a5568;
    font-weight: 400;
  }
  
  .header-right {
    text-align: right;
    font-size: 10px;
    color: #718096;
  }
  
  .header-right .brand {
    font-size: 14px;
    font-weight: 700;
    color: #1a56db;
    margin-bottom: 2px;
  }
  
  .section-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #1a56db;
    margin-bottom: 12px;
  }
  
  .section-title {
    font-size: 18px;
    font-weight: 700;
    color: #0a1628;
    margin-bottom: 16px;
  }
  
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 24px;
  }
  
  th {
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #4a5568;
    padding: 8px 12px;
    border-bottom: 2px solid #e2e8f0;
    background: #f7fafc;
  }
  
  td {
    padding: 8px 12px;
    border-bottom: 1px solid #edf2f7;
    font-size: 11px;
    vertical-align: top;
  }
  
  td.amt {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  
  td.highlight {
    background: linear-gradient(135deg, #1a56db08, #1a56db12);
    color: #1a56db;
    font-weight: 700;
  }
  
  td.notes {
    font-size: 10px;
    color: #718096;
    max-width: 280px;
  }
  
  tr.total-row td {
    font-weight: 700;
    border-top: 2px solid #0a1628;
    border-bottom: 2px solid #0a1628;
    background: #f7fafc;
  }
  
  .two-col {
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 32px;
    margin-bottom: 32px;
  }
  
  .section-box {
    margin-bottom: 24px;
  }
  
  .callout {
    background: #f0f4ff;
    border-left: 4px solid #1a56db;
    padding: 14px 18px;
    margin-bottom: 20px;
    border-radius: 0 6px 6px 0;
  }
  
  .callout p {
    font-size: 11px;
    line-height: 1.6;
    color: #2d3748;
  }
  
  .footer {
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #a0aec0;
  }
  
  .scale-badges {
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
  }
  
  .scale-badge {
    display: flex;
    flex-direction: column;
    padding: 10px 16px;
    background: #f7fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    min-width: 140px;
  }
  
  .scale-badge .label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #718096;
    margin-bottom: 2px;
  }
  
  .scale-badge .value {
    font-size: 12px;
    font-weight: 600;
    color: #0a1628;
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-left">
      <h1>${ctx.flagEmoji} ${ctx.localizedProgramName || ctx.country} — Term Sheet</h1>
      <div class="subtitle">${ctx.formalName} National Education Transformation Program</div>
    </div>
    <div class="header-right">
      <div class="brand">ALPHA</div>
      <div>Confidential & Proprietary</div>
      <div>${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" })}</div>
    </div>
  </div>

  <div class="callout">
    <p><strong>${ctx.headOfStateTitle}:</strong> ${ctx.headOfState} · <strong>Population:</strong> ${ctx.population} · <strong>GDP per Capita:</strong> ${ctx.gdpPerCapita} · <strong>School-Age Population:</strong> ${ctx.schoolAgePopulation}</p>
  </div>

  <div class="scale-badges">
    <div class="scale-badge">
      <span class="label">Year One</span>
      <span class="value">${FIXED_ECONOMICS.scaleTargets.yearOne}</span>
    </div>
    <div class="scale-badge">
      <span class="label">5-Year Plan</span>
      <span class="value">${FIXED_ECONOMICS.scaleTargets.fiveYear}</span>
    </div>
    <div class="scale-badge">
      <span class="label">Per-Student Budget</span>
      <span class="value">$25,000 / year</span>
    </div>
    <div class="scale-badge">
      <span class="label">Up-Front Investment</span>
      <span class="value">$1.5B</span>
    </div>
  </div>

  <div class="two-col">
    <div>
      <div class="section-box">
        <div class="section-label">Commercial Structure</div>
        <div class="section-title">Upfront</div>
        <table>
          <thead><tr><th>Item</th><th>Amount</th><th>Recipient</th></tr></thead>
          <tbody>
            ${upfrontRows}
            <tr class="total-row"><td>Total</td><td class="amt">${FIXED_ECONOMICS.upfrontTotal}</td><td></td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <div class="section-box">
        <div class="section-title">Ongoing</div>
        <table>
          <thead><tr><th>Item</th><th>Amount</th><th>Recipient</th></tr></thead>
          <tbody>${ongoingRows}
            <tr class="total-row"><td>Total</td><td class="amt">Scale dependent</td><td></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Page 8 Cost Structure -->
  <div class="section-box page-break">
    <div class="section-label">${ctx.localizedProgramName || ctx.country} Cost Structure</div>
    <div class="section-title">Budget like other $25k Alpha Holdings Schools</div>
    <table>
      <thead>
        <tr>
          <th>Item (per student P&L)</th>
          <th>Alpha @ $50k Tuition</th>
          <th style="background: #1a56db; color: #fff;">National @ $25k Budget</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr><td colspan="4" style="font-weight:700; font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:#718096; padding-top:14px;">FUNDING</td></tr>
        ${costRows}
      </tbody>
    </table>
  </div>

  <div class="footer">
    <span>© ${new Date().getFullYear()} Alpha Holdings. Confidential & Proprietary.</span>
    <span>${ctx.localizedProgramName || ctx.country} Term Sheet — ${ctx.formalName}</span>
  </div>
</div>
</body>
</html>`;
}

// ─── Pitch Deck HTML Generator ───────────────────────────────────────────────

function generatePitchDeckHtml(ctx: CountryContext): string {
  const strengths = (ctx.keyStrengths || [])
    .map(s => `<li>${s}</li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ctx.localizedProgramName || ctx.country} — AI-Native National Education System</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  
  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  @page { 
    size: 16in 9in;
    margin: 0;
  }
  
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .slide { page-break-after: always; break-after: page; }
    .slide:last-child { page-break-after: avoid; }
  }
  
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    color: #1a1a2e;
    background: #f0f2f8;
  }
  
  .slide {
    width: 100%;
    max-width: 1280px;
    margin: 0 auto 2px;
    aspect-ratio: 16/9;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: linear-gradient(135deg, #f8f9ff 0%, #eef1fa 100%);
  }
  
  .slide-footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 48px;
    font-size: 10px;
    color: #a0aec0;
  }
  
  .slide-footer .brand {
    font-weight: 700;
    color: #1a56db;
    font-size: 12px;
  }
  
  .slide-num {
    font-variant-numeric: tabular-nums;
  }
  
  /* ── Slide 1: Cover ── */
  .slide-cover {
    background: linear-gradient(135deg, #0a1628 0%, #1a2744 40%, #1a56db 100%);
    color: #fff;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 60px;
  }
  
  .slide-cover .flag {
    font-size: 64px;
    margin-bottom: 24px;
  }
  
  .slide-cover h1 {
    font-size: 48px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.1;
    margin-bottom: 12px;
  }
  
  .slide-cover h1 span {
    color: #60a5fa;
  }
  
  .slide-cover .tagline {
    font-size: 20px;
    font-weight: 300;
    color: #94b8ff;
    max-width: 700px;
  }
  
  .slide-cover .meta {
    position: absolute;
    bottom: 48px;
    font-size: 12px;
    color: #6b8cc7;
  }
  
  /* ── Slide: Content ── */
  .slide-content {
    padding: 48px;
  }
  
  .slide-content .label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #1a56db;
    margin-bottom: 8px;
  }
  
  .slide-content h2 {
    font-size: 32px;
    font-weight: 800;
    color: #0a1628;
    letter-spacing: -0.02em;
    line-height: 1.15;
    margin-bottom: 28px;
  }
  
  .slide-content h2 span {
    color: #1a56db;
  }
  
  /* ── Two-column grid ── */
  .two-pane {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 40px;
    flex: 1;
  }
  
  .pane {
    display: flex;
    flex-direction: column;
  }
  
  .pane-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  
  .pane-icon {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: #e8eeff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }
  
  .pane-title {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #0a1628;
  }
  
  .stack-item {
    font-size: 13px;
    padding: 8px 0;
    border-bottom: 1px solid #e8ecf4;
    color: #2d3748;
    line-height: 1.5;
  }
  
  .stack-item strong {
    color: #0a1628;
  }
  
  .scale-row {
    display: flex;
    justify-content: space-between;
    margin-top: 16px;
    gap: 12px;
  }
  
  .scale-box {
    flex: 1;
    text-align: center;
  }
  
  .scale-box .period {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #718096;
    margin-bottom: 4px;
  }
  
  .scale-box .figure {
    font-size: 14px;
    font-weight: 700;
    color: #0a1628;
  }
  
  .scale-arrow {
    display: flex;
    align-items: center;
    color: #1a56db;
    font-size: 12px;
  }
  
  /* ── Bullet lists ── */
  .bullet-list {
    list-style: none;
    padding: 0;
  }
  
  .bullet-list li {
    position: relative;
    padding: 8px 0 8px 20px;
    font-size: 14px;
    color: #2d3748;
    line-height: 1.5;
    border-bottom: 1px solid #edf2f7;
  }
  
  .bullet-list li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 14px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #1a56db;
  }
  
  /* ── Key facts row ── */
  .facts-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 24px;
  }
  
  .fact-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px;
    text-align: center;
  }
  
  .fact-card .fact-value {
    font-size: 22px;
    font-weight: 800;
    color: #0a1628;
    margin-bottom: 4px;
  }
  
  .fact-card .fact-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #718096;
  }
  
  /* ── Tables ── */
  .deck-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  
  .deck-table th {
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #4a5568;
    padding: 8px 12px;
    border-bottom: 2px solid #e2e8f0;
    background: #f7fafc;
  }
  
  .deck-table th.primary-col {
    background: #1a56db;
    color: #fff;
  }
  
  .deck-table td {
    padding: 7px 12px;
    border-bottom: 1px solid #edf2f7;
    vertical-align: top;
  }
  
  .deck-table td.amt {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  
  .deck-table td.highlight {
    background: linear-gradient(135deg, #1a56db08, #1a56db12);
    color: #1a56db;
    font-weight: 700;
  }
  
  .deck-table td.notes {
    font-size: 10px;
    color: #718096;
  }
  
  .deck-table .section-header td {
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #718096;
    padding-top: 14px;
    border-bottom: none;
  }
  
  .deck-table .total-row td {
    font-weight: 700;
    border-top: 2px solid #0a1628;
    border-bottom: 2px solid #0a1628;
    background: #f7fafc;
  }
  
  /* Results badges */
  .results-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin-top: 16px;
  }
  
  .result-badge {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 20px;
    text-align: center;
  }
  
  .result-badge .result-value {
    font-size: 32px;
    font-weight: 800;
    color: #1a56db;
    line-height: 1;
    margin-bottom: 6px;
  }
  
  .result-badge .result-label {
    font-size: 11px;
    color: #4a5568;
    line-height: 1.4;
  }
  
  .callout-box {
    background: #f0f4ff;
    border-left: 4px solid #1a56db;
    padding: 16px 20px;
    border-radius: 0 8px 8px 0;
    margin-top: 16px;
  }
  
  .callout-box p {
    font-size: 13px;
    line-height: 1.6;
    color: #2d3748;
  }
</style>
</head>
<body>

<!-- ═══ SLIDE 1: COVER ═══ -->
<div class="slide slide-cover">
  <div class="flag">${ctx.flagEmoji}</div>
  <h1>${ctx.localizedProgramName || ctx.country}<br><span>World's First AI-Native<br>National Education System</span></h1>
  <div class="tagline">${ctx.formalName}</div>
  <div class="meta">Confidential & Proprietary · ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" })} · Alpha Education</div>
  <div class="slide-footer" style="color: rgba(255,255,255,0.3);">
    <span class="brand" style="color: rgba(255,255,255,0.5);">ALPHA</span>
    <span class="slide-num">1</span>
  </div>
</div>

<!-- ═══ SLIDE 2: Country Context ═══ -->
<div class="slide slide-content">
  <div class="label">The Opportunity</div>
  <h2>${ctx.country}: <span>A Generational Investment in Human Capital</span></h2>
  
  <div class="facts-grid">
    <div class="fact-card">
      <div class="fact-value">${ctx.population}</div>
      <div class="fact-label">Population</div>
    </div>
    <div class="fact-card">
      <div class="fact-value">${ctx.gdpPerCapita}</div>
      <div class="fact-label">GDP per Capita</div>
    </div>
    <div class="fact-card">
      <div class="fact-value">${ctx.schoolAgePopulation}</div>
      <div class="fact-label">School-Age Population</div>
    </div>
    <div class="fact-card">
      <div class="fact-value">${ctx.currentEdSpendPerStudent}</div>
      <div class="fact-label">Current Ed Spend / Student</div>
    </div>
  </div>
  
  <div class="callout-box">
    <p>${ctx.culturalNarrative}</p>
  </div>
  
  <div style="margin-top: 20px;">
    <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#718096; margin-bottom:10px;">National Education Vision</div>
    <p style="font-size:14px; color:#2d3748; line-height:1.6;">${ctx.nationalEdVision}</p>
  </div>
  
  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${new Date().getFullYear()}. Confidential & Proprietary.</span>
    <span class="slide-num">2</span>
  </div>
</div>

<!-- ═══ SLIDE 3: Results + Why Alpha ═══ -->
<div class="slide slide-content">
  <div class="label">Proven Results</div>
  <h2>Alpha's students achieve <span>world-class outcomes</span></h2>
  
  <div class="results-grid">
    <div class="result-badge">
      <div class="result-value">2.2–4.9×</div>
      <div class="result-label">Academic growth vs.<br>conventional schools</div>
    </div>
    <div class="result-badge">
      <div class="result-value">1530</div>
      <div class="result-label">Average SAT score<br>(99th percentile)</div>
    </div>
    <div class="result-badge">
      <div class="result-value">97%</div>
      <div class="result-label">of students say they<br>"love school"</div>
    </div>
  </div>
  
  <div style="margin-top: 24px;">
    <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#718096; margin-bottom:12px;">Why ${ctx.country}</div>
    <ul class="bullet-list">
      ${strengths}
    </ul>
  </div>
  
  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${new Date().getFullYear()}. Confidential & Proprietary.</span>
    <span class="slide-num">3</span>
  </div>
</div>

<!-- ═══ SLIDE 4: The Complete Platform ═══ -->
<div class="slide slide-content">
  <div class="label">The Complete Platform for Regional Leadership</div>
  <h2>Launching ${ctx.localizedProgramName || ctx.country} on Alpha's <span>full education stack</span></h2>
  
  <div class="two-pane">
    <div class="pane">
      <div class="pane-header">
        <div class="pane-icon">📚</div>
        <div class="pane-title">Alpha Education Stack</div>
      </div>
      <div class="stack-item"><strong>Parent Education System:</strong> Parents demand outcomes</div>
      <div class="stack-item"><strong>Reinvented School Day:</strong> 2 hrs of academics + life skills</div>
      <div class="stack-item"><strong>Timeback®:</strong> AI platform for 10x faster mastery</div>
      <div class="stack-item"><strong>AlphaCore™:</strong> The strongest K-12 life-skills curriculum</div>
      <div class="stack-item"><strong>Guide School:</strong> Talent academy for training guides</div>
      <div class="stack-item"><strong>Incept eduLLM:</strong> Personalized content generation</div>
      <div class="scale-row">
        <div class="scale-box"><div class="period">This Year</div><div class="figure">2,500 students · 22 campuses</div></div>
        <div class="scale-arrow">→</div>
        <div class="scale-box"><div class="period">3-Year Plan</div><div class="figure">100k students · 100 campuses</div></div>
      </div>
    </div>
    
    <div class="pane">
      <div class="pane-header">
        <div class="pane-icon">${ctx.flagEmoji}</div>
        <div class="pane-title">${ctx.localizedProgramName || ctx.country}: Nationally Owned</div>
      </div>
      <div class="stack-item"><strong>Education Sovereignty:</strong> ${ctx.country} owns the critical pieces</div>
      <div class="stack-item"><strong>Infrastructure:</strong> Built to scale across 100+ schools</div>
      <div class="stack-item"><strong>Localized AI Apps:</strong> ${ctx.languageApps}</div>
      <div class="stack-item"><strong>Local Life-Skills:</strong> ${ctx.localLifeSkillsFocus}</div>
      <div class="stack-item"><strong>Talent Academy:</strong> Recruit and train ${ctx.localizedProgramName || ctx.country} Guides</div>
      <div class="stack-item"><strong>National eduLLM:</strong> Embedded local laws, values, and culture</div>
      <div class="scale-row">
        <div class="scale-box"><div class="period">This Year</div><div class="figure">${FIXED_ECONOMICS.scaleTargets.yearOne}</div></div>
        <div class="scale-arrow">→</div>
        <div class="scale-box"><div class="period">5-Year Plan</div><div class="figure">${FIXED_ECONOMICS.scaleTargets.fiveYear}</div></div>
      </div>
    </div>
  </div>
  
  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${new Date().getFullYear()}. Confidential & Proprietary.</span>
    <span class="slide-num">4</span>
  </div>
</div>

<!-- ═══ SLIDE 5: Commercial Structure ═══ -->
<div class="slide slide-content">
  <div class="label">Transaction Details</div>
  <h2>${ctx.localizedProgramName || ctx.country} <span>Commercial Structure</span></h2>
  
  <div class="two-pane">
    <div class="pane">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#718096; margin-bottom:10px;">Upfront</div>
      <table class="deck-table">
        <thead><tr><th>Item</th><th>Upfront</th><th>Recipient</th></tr></thead>
        <tbody>
          ${FIXED_ECONOMICS.upfront.map(r => `<tr><td>${r.item.replace("EdTech App R&D", `${ctx.country} EdTech App R&D`).replace("Local Life-Skills R&D", `${ctx.localizedProgramName || ctx.country} R&D`)}</td><td class="amt">${r.amount}</td><td>${r.recipient}</td></tr>`).join("\n")}
          <tr class="total-row"><td>Total</td><td class="amt">${FIXED_ECONOMICS.upfrontTotal}</td><td></td></tr>
        </tbody>
      </table>
    </div>
    
    <div class="pane">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#718096; margin-bottom:10px;">Ongoing</div>
      <table class="deck-table">
        <thead><tr><th>Item</th><th>Ongoing</th><th>Recipient</th></tr></thead>
        <tbody>
          ${FIXED_ECONOMICS.ongoing.map(r => `<tr><td>${r.item}</td><td class="amt">${r.amount}</td><td>${r.recipient}</td></tr>`).join("\n")}
          <tr class="total-row"><td>Total</td><td class="amt">Scale dependent</td><td></td></tr>
        </tbody>
      </table>
    </div>
  </div>
  
  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${new Date().getFullYear()}. Confidential & Proprietary.</span>
    <span class="slide-num">5</span>
  </div>
</div>

<!-- ═══ SLIDE 6: Cost Structure (Page 8 table) ═══ -->
<div class="slide slide-content">
  <div class="label">${ctx.localizedProgramName || ctx.country} Cost Structure</div>
  <h2>Budget like other <span>$25k Alpha Holdings Schools</span></h2>
  
  <div style="display: grid; grid-template-columns: 1fr 280px; gap: 24px;">
    <table class="deck-table">
      <thead>
        <tr>
          <th>Item (per student P&L)</th>
          <th>Alpha @ $50k Tuition</th>
          <th class="primary-col">${ctx.localizedProgramName || "National"} @ $25k Budget</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr class="section-header"><td colspan="4">FUNDING</td></tr>
        ${FIXED_ECONOMICS.costStructure.map(r => `<tr><td>${r.item}</td><td class="amt">${r.alpha}</td><td class="amt highlight">${r.national}</td><td class="notes">${r.notes}</td></tr>`).join("\n")}
      </tbody>
    </table>
    
    <div style="background: #f7fafc; border-radius: 10px; padding: 20px; border: 1px solid #e2e8f0; align-self: start; margin-top: 24px;">
      <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #0a1628; margin-bottom: 12px;">Cost to Educate</div>
      <p style="font-size: 12px; color: #4a5568; line-height: 1.6;">Conventional schools have the same cost to educate, but with close to 100% of spend on teachers.</p>
      <p style="font-size: 12px; color: #4a5568; line-height: 1.6; margin-top: 8px;">Timeback and Life Skills spend same as at gt.school and Texas Sports Academy.</p>
    </div>
  </div>
  
  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${new Date().getFullYear()}. Confidential & Proprietary.</span>
    <span class="slide-num">6</span>
  </div>
</div>

</body>
</html>`;
}

// ─── Main Generation Flow ────────────────────────────────────────────────────

async function generateDocuments(target: string): Promise<GenerationResult> {
  // Step 1: Get country context from Claude
  const message = await client.messages.create({
    model: "claude_sonnet_4_6",
    max_tokens: 2000,
    system: RESEARCH_PROMPT,
    messages: [
      { role: "user", content: `Generate the country context profile for: ${target}` },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const ctx: CountryContext = JSON.parse(cleaned);

  // Step 2: Generate both HTML documents using the fixed economics + country context
  const termSheetHtml = generateTermSheetHtml(ctx);
  const pitchDeckHtml = generatePitchDeckHtml(ctx);

  return { context: ctx, termSheetHtml, pitchDeckHtml };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerRoutes(server: Server, app: Express) {
  app.post("/api/generate", async (req, res) => {
    const { target } = req.body;
    if (!target || typeof target !== "string" || !target.trim()) {
      res.status(400).json({ error: "Target country or state is required" });
      return;
    }

    const run = storage.createRun(target.trim());
    storage.updateRun(run.id, { status: "generating" });

    generateDocuments(target.trim())
      .then((result) => {
        storage.updateRun(run.id, { status: "completed", result });
      })
      .catch((err) => {
        storage.updateRun(run.id, {
          status: "error",
          error: String(err),
        });
      });

    res.json({ id: run.id });
  });

  app.get("/api/runs/:id", (req, res) => {
    const run = storage.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json(run);
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
}
