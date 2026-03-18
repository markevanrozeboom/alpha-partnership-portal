import type { Express } from "express";
import type { Server } from "http";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { storage } from "./storage";
import { buildTermSheetDocx } from "./docx-builder";
import { computeFinancialModel, fmtCompact, fmtUsd, fmtNum } from "./financial-engine";
import type { CountryContext, GenerationResult, FinancialResearchData, FinancialModel } from "@shared/schema";

const client = new Anthropic({
  defaultHeaders: { "anthropic-version": "2023-06-01" },
});
const openai = new OpenAI();

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
  "languageApps": "What localized AI apps would be needed (languages, religious education, cultural studies, ESL). Brief list.",
  "addressableStudentPopulation": "Estimated number of school-age children (5-18) in households with annual income > $250,000 USD (or PPP equivalent). This is the realistic addressable market for a $25,000/student program. Use known data: HNWI counts, wealth reports (Knight Frank, Henley & Partners, Credit Suisse), income distribution data, and international/premium private school enrollment as proxies. For wealthy nations (GDP per capita > $40k), this could be millions. For developing nations, it may be tens of thousands. Give a specific number like '15,000-25,000 students' or '2.1 million students'. Be realistic, not aspirational.",
  "addressableMethodology": "1-2 sentences explaining the data sources and logic behind the estimate (e.g. 'Based on 7,200 HNWIs per Henley 2024, ~3,600 households with 2-3 school-age children, plus sub-millionaire affluent segment currently enrolled in international schools.')"
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
    <p><strong>${ctx.headOfStateTitle}:</strong> ${ctx.headOfState} · <strong>Population:</strong> ${ctx.population} · <strong>GDP per Capita:</strong> ${ctx.gdpPerCapita} · <strong>School-Age Population:</strong> ${ctx.schoolAgePopulation}${ctx.addressableStudentPopulation ? ` · <strong>Addressable Market (AGI &gt; $250k):</strong> ${ctx.addressableStudentPopulation}` : ''}</p>
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

  <div class="section-label">Commercial Structure</div>
  <div class="two-col">
    <div>
      <div class="section-box">
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
// Modelled after the Ed71 Proposal Deck (first 8 slides)
// Slide 8 "Commercial Structure" mirrors the Ed71 per-student cost table exactly.

function generatePitchDeckHtml(ctx: CountryContext, model: FinancialModel): string {
  const programName = ctx.localizedProgramName || ctx.country;
  const year = new Date().getFullYear();
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" });

  const strengths = (ctx.keyStrengths || [])
    .map(s => `<li>${s}</li>`)
    .join("\n");

  // ── Build upfront investment rows from the financial model ──
  const allUpfrontItems = [...model.upfront.fixedItems, ...model.upfront.variableItems];
  const upfrontRows = allUpfrontItems
    .map(r => `<tr><td>${r.item}</td><td class="amt">${fmtCompact(r.amountUsd)}</td><td>${r.recipient}</td></tr>`)
    .join("\n");

  // ── Build ongoing investment rows from the financial model ──
  const ongoingRows = model.ongoing.items
    .map(r => `<tr><td>${r.item}</td><td class="amt">${r.amount}</td><td>${r.recipient}</td></tr>`)
    .join("\n");

  // ── Investment structure panel items (right side of slide 8) ──
  const investmentItems = [
    ...model.upfront.fixedItems.map(r => ({ item: r.item, amount: fmtCompact(r.amountUsd), detail: r.recipient })),
    ...model.upfront.variableItems.map(r => ({ item: r.item, amount: fmtCompact(r.amountUsd), detail: r.note || r.recipient })),
  ];
  const investmentRows = investmentItems
    .map(r => `<div class="invest-row"><div class="invest-item">${r.item}</div><div class="invest-amt">${r.amount}</div><div class="invest-detail">${r.detail}</div></div>`)
    .join("\n");

  // ── Scholarship gap callout (if applicable) ──
  const gapCallout = model.scholarshipGap.perStudentGap > 0
    ? `<div class="callout-box" style="margin-top:16px;"><p><strong>Scholarship Gap:</strong> ${model.scholarshipGap.note}</p></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${programName} — Proposal Deck</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  @page { size: 16in 9in; margin: 0; }
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

  /* ── Slide chrome ── */
  .slide {
    width: 100%; max-width: 1280px;
    margin: 0 auto 2px;
    aspect-ratio: 16/9;
    position: relative; overflow: hidden;
    display: flex; flex-direction: column;
    background: linear-gradient(135deg, #f8f9ff 0%, #eef1fa 100%);
  }
  .slide-footer {
    position: absolute; bottom: 0; left: 0; right: 0;
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 48px; font-size: 10px; color: #a0aec0;
  }
  .slide-footer .brand { font-weight: 700; color: #1a56db; font-size: 12px; }
  .slide-num { font-variant-numeric: tabular-nums; }

  /* ── Cover ── */
  .slide-cover {
    background: linear-gradient(135deg, #0a1628 0%, #1a2744 40%, #1a56db 100%);
    color: #fff; justify-content: center; align-items: center; text-align: center; padding: 60px;
  }
  .slide-cover .flag { font-size: 64px; margin-bottom: 24px; }
  .slide-cover h1 { font-size: 48px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 12px; }
  .slide-cover h1 span { color: #60a5fa; }
  .slide-cover .tagline { font-size: 20px; font-weight: 300; color: #94b8ff; max-width: 700px; }
  .slide-cover .meta { position: absolute; bottom: 48px; font-size: 12px; color: #6b8cc7; }

  /* ── Content slides ── */
  .slide-content { padding: 48px; }
  .slide-content .label {
    font-size: 11px; font-weight: 700; letter-spacing: 0.14em;
    text-transform: uppercase; color: #1a56db; margin-bottom: 8px;
  }
  .slide-content h2 {
    font-size: 32px; font-weight: 800; color: #0a1628;
    letter-spacing: -0.02em; line-height: 1.15; margin-bottom: 28px;
  }
  .slide-content h2 span { color: #1a56db; }

  /* ── Two-column grid ── */
  .two-pane { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; flex: 1; }
  .pane { display: flex; flex-direction: column; }
  .pane-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .pane-icon {
    width: 44px; height: 44px; border-radius: 50%; background: #e8eeff;
    display: flex; align-items: center; justify-content: center; font-size: 20px;
  }
  .pane-title { font-size: 16px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #0a1628; }
  .stack-item { font-size: 13px; padding: 8px 0; border-bottom: 1px solid #e8ecf4; color: #2d3748; line-height: 1.5; }
  .stack-item strong { color: #0a1628; }

  .scale-row { display: flex; justify-content: space-between; margin-top: 16px; gap: 12px; }
  .scale-box { flex: 1; text-align: center; }
  .scale-box .period { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #718096; margin-bottom: 4px; }
  .scale-box .figure { font-size: 14px; font-weight: 700; color: #0a1628; }
  .scale-arrow { display: flex; align-items: center; color: #1a56db; font-size: 12px; }

  /* ── Bullet lists ── */
  .bullet-list { list-style: none; padding: 0; }
  .bullet-list li {
    position: relative; padding: 8px 0 8px 20px; font-size: 14px;
    color: #2d3748; line-height: 1.5; border-bottom: 1px solid #edf2f7;
  }
  .bullet-list li::before {
    content: ""; position: absolute; left: 0; top: 14px;
    width: 8px; height: 8px; border-radius: 50%; background: #1a56db;
  }

  /* ── Key facts row ── */
  .facts-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  .fact-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
  .fact-card .fact-value { font-size: 22px; font-weight: 800; color: #0a1628; margin-bottom: 4px; }
  .fact-card .fact-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #718096; }

  /* ── Results badges ── */
  .results-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 16px; }
  .result-badge { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; text-align: center; }
  .result-badge .result-value { font-size: 32px; font-weight: 800; color: #1a56db; line-height: 1; margin-bottom: 6px; }
  .result-badge .result-label { font-size: 11px; color: #4a5568; line-height: 1.4; }

  /* ── Callout boxes ── */
  .callout-box {
    background: #f0f4ff; border-left: 4px solid #1a56db;
    padding: 16px 20px; border-radius: 0 8px 8px 0; margin-top: 16px;
  }
  .callout-box p { font-size: 13px; line-height: 1.6; color: #2d3748; }

  /* ── Tables ── */
  .deck-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .deck-table th {
    text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #4a5568; padding: 8px 12px;
    border-bottom: 2px solid #e2e8f0; background: #f7fafc;
  }
  .deck-table th.primary-col { background: #1a56db; color: #fff; }
  .deck-table td { padding: 7px 12px; border-bottom: 1px solid #edf2f7; vertical-align: top; }
  .deck-table td.amt { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .deck-table td.highlight { background: linear-gradient(135deg, #1a56db08, #1a56db12); color: #1a56db; font-weight: 700; }
  .deck-table td.notes { font-size: 10px; color: #718096; }
  .deck-table .section-header td { font-weight: 700; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #718096; padding-top: 14px; border-bottom: none; }
  .deck-table .total-row td { font-weight: 700; border-top: 2px solid #0a1628; border-bottom: 2px solid #0a1628; background: #f7fafc; }

  /* ── Day comparison ── */
  .day-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 16px; }
  .day-col { border-radius: 10px; padding: 20px; }
  .day-col.traditional { background: #fef2f2; border: 1px solid #fecaca; }
  .day-col.alpha { background: #f0f4ff; border: 1px solid #c7d2fe; }
  .day-col h4 { font-size: 14px; font-weight: 700; margin-bottom: 10px; }
  .day-col .day-item { font-size: 12px; padding: 4px 0; color: #4a5568; }
  .day-col .day-item strong { color: #0a1628; }

  /* ── Partnership cards ── */
  .partner-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 16px; }
  .partner-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; }
  .partner-card .partner-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #1a56db; margin-bottom: 8px; }
  .partner-card .partner-value { font-size: 14px; font-weight: 600; color: #0a1628; line-height: 1.4; }
  .partner-card .partner-detail { font-size: 11px; color: #718096; margin-top: 4px; line-height: 1.4; }

  /* ── Commercial Structure slide (Ed71-style) ── */
  .comm-panel {
    border: 2px solid #1a56db; border-radius: 4px; overflow: hidden;
  }
  .comm-header {
    background: #1a56db; color: #fff; text-align: center;
    font-size: 16px; font-weight: 700; padding: 8px 16px;
  }
  .comm-sub-header {
    background: #4a5568; color: #fff; text-align: center;
    font-size: 13px; font-weight: 700; padding: 5px 16px;
  }
  .comm-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .comm-table th {
    text-align: left; font-size: 10px; font-weight: 700;
    padding: 5px 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568;
  }
  .comm-table td { padding: 5px 10px; border-bottom: 1px solid #edf2f7; }
  .comm-table td.amt { font-weight: 700; text-align: center; white-space: nowrap; }
  .comm-table .total-row td {
    font-weight: 700; border-top: 2px solid #0a1628; background: #f7fafc;
  }
  .comm-footnote { font-size: 9px; color: #718096; padding: 4px 10px; font-style: italic; }

  /* ── Investment Structure panel ── */
  .invest-panel {
    border: 2px solid #1a56db; border-radius: 4px; overflow: hidden;
  }
  .invest-row {
    display: grid; grid-template-columns: 1fr auto;
    padding: 5px 12px; border-bottom: 1px solid #edf2f7; font-size: 11px;
  }
  .invest-item { color: #2d3748; font-weight: 500; }
  .invest-amt { font-weight: 700; color: #0a1628; text-align: right; }
  .invest-detail { grid-column: 1 / -1; font-size: 10px; color: #718096; margin-top: 1px; }
  .invest-total {
    display: flex; justify-content: space-between;
    padding: 6px 12px; font-weight: 700; font-size: 13px;
    background: #f7fafc; border-top: 2px solid #0a1628;
  }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 1 — COVER
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-cover">
  <div class="flag">${ctx.flagEmoji}</div>
  <h1>${programName}<br><span>The World's First AI-Native<br>National Education System</span></h1>
  <div class="tagline">${ctx.formalName}</div>
  <div class="meta">Confidential &amp; Proprietary · ${dateStr} · Alpha Education</div>
  <div class="slide-footer" style="color: rgba(255,255,255,0.3);">
    <span class="brand" style="color: rgba(255,255,255,0.5);">ALPHA</span>
    <span class="slide-num">1</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 2 — THE OPPORTUNITY
     ═══════════════════════════════════════════════════════════════════════════ -->
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
    <span>© ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">2</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 3 — ALPHA'S PROVEN RESULTS
     ═══════════════════════════════════════════════════════════════════════════ -->
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
    <span>© ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">3</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 4 — THE 2HR LEARNING MODEL
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">The 2hr Learning Model</div>
  <h2>AI-powered education that <span>compresses and elevates</span></h2>

  <ul class="bullet-list" style="margin-bottom: 20px;">
    <li><strong>The Core Insight:</strong> Children can master academics in 2 hours/day — this has been proven for 40 years (Bloom's 2-Sigma). AI makes 1:1 tutoring possible at scale for the first time.</li>
    <li><strong>Timeback®:</strong> AI + learning science platform delivering 10× faster mastery. 90% mastery floor — no gaps, no "Swiss cheese" learning.</li>
    <li><strong>AlphaCore™:</strong> The strongest K-12 life-skills curriculum — leadership, teamwork, communication, resilience.</li>
    <li><strong>Guide School:</strong> 12-month talent academy transforming teachers into Guides — coaches &amp; mentors focused on mindset, not lecturing.</li>
  </ul>

  <div class="day-compare">
    <div class="day-col traditional">
      <h4 style="color: #991b1b;">Traditional School Day</h4>
      <div class="day-item"><strong>6 hours</strong> of classroom instruction</div>
      <div class="day-item">Teacher lectures to 30 students</div>
      <div class="day-item">One-size-fits-all curriculum</div>
      <div class="day-item">Results: stagnant outcomes nationwide</div>
    </div>
    <div class="day-col alpha">
      <h4 style="color: #1a56db;">Alpha School Day</h4>
      <div class="day-item"><strong>2 hours</strong> AI-powered academic mastery</div>
      <div class="day-item"><strong>4 hours</strong> life skills, STEM, sports, arts</div>
      <div class="day-item">Personalised AI tutor for every student</div>
      <div class="day-item">Results: 2–5× faster learning, 97% love school</div>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">4</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 5 — THE COMPLETE PLATFORM
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">The Complete Platform</div>
  <h2>Launching ${programName} on Alpha's <span>full education stack</span></h2>

  <div class="two-pane">
    <div class="pane">
      <div class="pane-header">
        <div class="pane-icon">📚</div>
        <div class="pane-title">Alpha Education Stack</div>
      </div>
      <div class="stack-item"><strong>Parent Education System:</strong> Parents demand outcomes</div>
      <div class="stack-item"><strong>Reinvented School Day:</strong> 2 hrs of academics + life skills</div>
      <div class="stack-item"><strong>Timeback®:</strong> AI platform for 10× faster mastery</div>
      <div class="stack-item"><strong>AlphaCore™:</strong> The strongest K-12 life-skills curriculum</div>
      <div class="stack-item"><strong>Guide School:</strong> Talent academy for training Guides</div>
      <div class="stack-item"><strong>Incept eduLLM:</strong> Personalised content generation engine</div>
      <div class="scale-row">
        <div class="scale-box"><div class="period">This Year</div><div class="figure">2,500 students · 22 campuses</div></div>
        <div class="scale-arrow">→</div>
        <div class="scale-box"><div class="period">3-Year Plan</div><div class="figure">100k students · 100 campuses</div></div>
      </div>
    </div>

    <div class="pane">
      <div class="pane-header">
        <div class="pane-icon">${ctx.flagEmoji}</div>
        <div class="pane-title">${programName}: Nationally Owned</div>
      </div>
      <div class="stack-item"><strong>Education Sovereignty:</strong> ${ctx.country} owns 100% of the local entity</div>
      <div class="stack-item"><strong>Infrastructure:</strong> Built to scale across 100+ schools</div>
      <div class="stack-item"><strong>Localised AI Apps:</strong> ${ctx.languageApps}</div>
      <div class="stack-item"><strong>Local Life-Skills:</strong> ${ctx.localLifeSkillsFocus}</div>
      <div class="stack-item"><strong>Talent Academy:</strong> Recruit and train ${programName} Guides</div>
      <div class="stack-item"><strong>National eduLLM:</strong> Embedded local laws, values, and culture</div>
      <div class="scale-row">
        <div class="scale-box"><div class="period">Year 1</div><div class="figure">${fmtNum(model.counterparty.minStudentsPerYear / 50)} students</div></div>
        <div class="scale-arrow">→</div>
        <div class="scale-box"><div class="period">5-Year Plan</div><div class="figure">${fmtNum(model.counterparty.minStudentsPerYear)}+ students</div></div>
      </div>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">5</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 6 — PARTNERSHIP MODEL
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">Partnership Model</div>
  <h2>${programName}: <span>${ctx.country} Owns 100% · Alpha Operates &amp; Licenses</span></h2>

  <div class="partner-grid">
    <div class="partner-card">
      <div class="partner-label">Structure</div>
      <div class="partner-value">Operator &amp; Licensor</div>
      <div class="partner-detail">Modelled after the Marriott hotel management model. ${ctx.country} owns 100% of the local entity; Alpha is the exclusive operator and licensor.</div>
    </div>
    <div class="partner-card">
      <div class="partner-label">Flagship Schools</div>
      <div class="partner-value">${model.flagship.totalSchoolCount} School${model.flagship.totalSchoolCount !== 1 ? 's' : ''} · ${fmtUsd(model.flagship.tuitionPerYear)}/yr</div>
      <div class="partner-detail">${model.flagship.schools.map(s => `${s.metro} (${s.count})`).join(', ')}. ${model.flagship.scholarshipNote ? model.flagship.scholarshipNote : `${fmtNum(model.flagship.capacityPerSchool)} students per school.`}</div>
    </div>
    <div class="partner-card">
      <div class="partner-label">National Schools</div>
      <div class="partner-value">${fmtNum(model.counterparty.minStudentsPerYear)} Student-Year Min</div>
      <div class="partner-detail">Fixed $${model.counterparty.perStudentBudget.toLocaleString("en-US")} per-student annual budget. ${ctx.country} funds 100% of local entity operations.</div>
    </div>
  </div>

  <div style="margin-top: 24px;">
    <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#718096; margin-bottom:12px;">What Alpha Retains (IP)</div>
    <ul class="bullet-list">
      <li><strong>Timeback®</strong> — AI learning platform (licensed to local entity)</li>
      <li><strong>AlphaCore™</strong> — Life-skills curriculum (licensed)</li>
      <li><strong>Guide School</strong> — Teacher training IP (licensed)</li>
      <li><strong>Incept eduLLM</strong> — Personalised content engine (licensed)</li>
    </ul>
  </div>

  <div class="callout-box" style="margin-top: 16px;">
    <p><strong>Education Sovereignty:</strong> ${ctx.country} owns 100% of the national identity, cultural values, local curriculum, and all locally developed content. Alpha provides the engine; ${ctx.country} owns the car.</p>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">6</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 7 — ADDRESSABLE MARKET & SCALE
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">Addressable Market</div>
  <h2>${programName}: <span>Massive Scale Opportunity</span></h2>

  <div class="two-pane">
    <div class="pane">
      <div class="callout-box" style="margin-top: 0; margin-bottom: 16px; display: flex; align-items: center; gap: 16px;">
        <div style="min-width: 140px;">
          <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #718096; margin-bottom: 4px;">Addressable Market</div>
          <div style="font-size: 28px; font-weight: 800; color: #1a56db; line-height: 1.1;">${ctx.addressableStudentPopulation || ctx.schoolAgePopulation}</div>
          <div style="font-size: 10px; color: #718096; margin-top: 2px;">families with AGI &gt; $250k</div>
        </div>
        <div>
          <p style="font-size: 12px; line-height: 1.5; color: #2d3748;"><strong>Significant room to scale.</strong> The initial commitment targets ${fmtNum(model.counterparty.minStudentsPerYear)} students.${ctx.addressableMethodology ? ` <span style="font-size: 10px; color: #718096;">(${ctx.addressableMethodology})</span>` : ''}</p>
        </div>
      </div>

      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#718096; margin-bottom:10px;">Per-Student Economics ($${model.counterparty.perStudentBudget.toLocaleString("en-US")} Budget)</div>
      <table class="deck-table">
        <thead><tr><th>Cost Item</th><th>Per Student</th><th>Notes</th></tr></thead>
        <tbody>
          ${model.counterparty.costBreakdown.map(c => `<tr><td>${c.item}</td><td class="amt">$${c.amount.toLocaleString("en-US")}</td><td class="notes">${c.note || '—'}</td></tr>`).join("\n          ")}
          <tr class="total-row"><td>Total</td><td class="amt">$${model.counterparty.perStudentBudget.toLocaleString("en-US")}</td><td></td></tr>
        </tbody>
      </table>
    </div>

    <div class="pane">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#718096; margin-bottom:10px;">Scale Trajectory</div>
      <div class="scale-row" style="margin-top: 0;">
        <div class="scale-box" style="background: #f0f4ff; border-radius: 8px; padding: 16px; border: 1px solid #c7d2fe;">
          <div class="period">Year 1</div>
          <div class="figure">${fmtNum(Math.round(model.counterparty.minStudentsPerYear / 50))} students</div>
        </div>
        <div class="scale-arrow" style="font-size: 20px;">→</div>
        <div class="scale-box" style="background: #e8eeff; border-radius: 8px; padding: 16px; border: 1px solid #93a9ff;">
          <div class="period">5-Year Plan</div>
          <div class="figure">${fmtNum(model.counterparty.minStudentsPerYear)}+ students</div>
        </div>
      </div>

      <div style="margin-top: 20px;">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#718096; margin-bottom:10px;">Flagship Schools (Revenue-Optimized)</div>
        ${model.flagship.schools.map(s => `<div class="stack-item"><strong>${s.metro}</strong>: ${s.count} school${s.count !== 1 ? 's' : ''}</div>`).join("\n        ")}
        <div class="stack-item"><strong>Tuition:</strong> ${fmtUsd(model.flagship.tuitionPerYear)} / year</div>
        <div class="stack-item"><strong>Capacity:</strong> ${fmtNum(model.flagship.capacityPerSchool)} students per school</div>
        ${model.flagship.scholarshipNote ? `<div class="callout-box" style="margin-top: 8px;"><p style="font-size: 11px;">${model.flagship.scholarshipNote}</p></div>` : ''}
      </div>

      ${gapCallout}
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">7</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 8 — COMMERCIAL & INVESTMENT STRUCTURE  (exact Ed71 layout)
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">Publicly Funded, Privately Operated Schools</div>
  <h2>${programName} <span>Commercial &amp; Investment Structure</span></h2>

  <div style="display: grid; grid-template-columns: 3fr 2fr; gap: 24px; flex: 1;">

    <!-- LEFT: Commercial Structure -->
    <div class="comm-panel">
      <div class="comm-header">Commercial Structure</div>

      <div class="comm-sub-header">Upfront</div>
      <table class="comm-table">
        <thead><tr><th style="width:40%">Item</th><th style="width:20%; text-align:center;">Upfront</th><th style="width:40%">Recipient</th></tr></thead>
        <tbody>
          ${allUpfrontItems.map(r => `<tr><td>${r.item}</td><td class="amt">${fmtCompact(r.amountUsd)}</td><td>${r.recipient}</td></tr>`).join("\n          ")}
          <tr class="total-row"><td>Total ${programName} Schools</td><td class="amt">${fmtCompact(model.upfront.totalUsd)}</td><td></td></tr>
        </tbody>
      </table>

      <div class="comm-sub-header">Ongoing</div>
      <table class="comm-table">
        <thead><tr><th style="width:40%">Item</th><th style="width:20%; text-align:center;">Ongoing</th><th style="width:40%">Recipient</th></tr></thead>
        <tbody>
          ${ongoingRows}
          <tr class="total-row"><td>Total ${programName} Schools</td><td class="amt">Scale dependent</td><td></td></tr>
        </tbody>
      </table>
      <div class="comm-footnote">* per ${fmtNum(model.counterparty.minStudentsPerYear)} students</div>
    </div>

    <!-- RIGHT: Investment Structure -->
    <div class="invest-panel">
      <div class="comm-header">Investment Structure</div>

      ${investmentRows}

      <div class="invest-total">
        <span>Total</span>
        <span>${fmtCompact(model.upfront.totalUsd)}</span>
      </div>
    </div>

  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">8</span>
  </div>
</div>

</body>
</html>`;
}

// ─── Financial Research Data Helper ──────────────────────────────────────────

function parseUsdString(s: string): number {
  // Parse strings like "$47,000" or "47000" → 47000
  const cleaned = s.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function buildFinancialResearchData(ctx: CountryContext): FinancialResearchData {
  const gdpPerCapita = parseUsdString(ctx.gdpPerCapita);
  const currentPublicFunding = parseUsdString(ctx.currentEdSpendPerStudent);

  // Estimate most expensive non-boarding tuition from GDP per capita
  // Typically 50-80% of GDP per capita for elite schools
  const estimatedMaxTuition = Math.round(gdpPerCapita * 0.6 / 1000) * 1000;

  return {
    topMetros: [],  // No metro data from basic LLM context — flagship optimizer will use fallback
    mostExpensiveNonBoardingTuitionUsd: Math.max(estimatedMaxTuition, 20_000),
    currentPublicFundingPerStudent: currentPublicFunding,
    gdpPerCapitaUsd: gdpPerCapita,
  };
}

// ─── Main Generation Flow ────────────────────────────────────────────────────

async function generateDocuments(target: string): Promise<GenerationResult> {
  // Step 1: Get country context from Claude
  // Try Claude first, fallback to OpenAI Responses API
  let text = "";
  try {
    const message = await client.messages.create({
      model: "claude_sonnet_4_6",
      max_tokens: 2000,
      system: RESEARCH_PROMPT,
      messages: [
        { role: "user", content: `Generate the country context profile for: ${target}` },
      ],
    });
    text = message.content[0].type === "text" ? message.content[0].text : "";
  } catch (e: any) {
    console.error("Claude failed, trying OpenAI:", e.message);
    const response = await openai.responses.create({
      model: "gpt_5_1",
      input: `${RESEARCH_PROMPT}\n\nGenerate the country context profile for: ${target}`,
    });
    text = typeof response.output_text === "string" ? response.output_text : "";
  }

  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const ctx: CountryContext = JSON.parse(cleaned);

  // Step 2: Build financial research data from context and compute the model
  const financialData = buildFinancialResearchData(ctx);
  const financialModel = computeFinancialModel(financialData, ctx.country);

  // Step 3: Generate both HTML documents using the fixed economics + country context
  const termSheetHtml = generateTermSheetHtml(ctx);
  const pitchDeckHtml = generatePitchDeckHtml(ctx, financialModel);

  // Step 4: Generate DOCX and base64-encode it for client-side download
  const docxBuffer = await buildTermSheetDocx(ctx, financialModel);
  const termSheetDocxBase64 = docxBuffer.toString("base64");

  return { context: ctx, termSheetHtml, pitchDeckHtml, termSheetDocxBase64 };
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

  // DOCX download endpoint
  app.get("/api/runs/:id/docx", async (req, res) => {
    const run = storage.getRun(req.params.id);
    if (!run || run.status !== "completed" || !run.result) {
      res.status(404).json({ error: "Run not found or not complete" });
      return;
    }

    try {
      const ctx = run.result.context;
      const financialData = buildFinancialResearchData(ctx);
      const model = computeFinancialModel(financialData, ctx.country);
      const buffer = await buildTermSheetDocx(ctx, model);
      const programName = ctx.localizedProgramName || ctx.country;
      const filename = `${programName}-Term-Sheet.docx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (err) {
      console.error("DOCX generation error:", err);
      res.status(500).json({ error: "Failed to generate DOCX" });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
}
