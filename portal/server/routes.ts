import type { Express } from "express";
import type { Server } from "http";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { storage } from "./storage";
import { buildTermSheetDocx } from "./docx-builder";
import { computeFinancialModel, fmtCompact, fmtNum, fmtUsd } from "./financial-engine";
import type { CountryContext, GenerationResult, FinancialModel } from "@shared/schema";

const client = new Anthropic({
  defaultHeaders: { "anthropic-version": "2023-06-01" },
});
const openai = new OpenAI();

// ─── SYSTEM PROMPT: Country Research + Financial Data ────────────────────────

const RESEARCH_PROMPT = `You are a research assistant for Alpha Education / 2hr Learning.
Your job is to produce a country context profile AND financial research data for a sales engagement.

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
  "culturalNarrative": "2-3 compelling sentences about why THIS country is uniquely positioned for AI-powered education transformation. Reference specific cultural values, national ambitions, or recent initiatives.",
  "keyStrengths": ["Strength 1 for partnership", "Strength 2", "Strength 3"],
  "localizedProgramName": "A SHORT brand name for the education program (2-4 words max). Reference something culturally meaningful. NEVER include explanations — just the brand name itself.",
  "localLifeSkillsFocus": "What life skills matter most in this culture. 1-2 sentences.",
  "languageApps": "What localized AI apps would be needed. Brief list.",
  "financialData": {
    "gdpPerCapitaUsd": 44000,
    "schoolAgePopulationNum": 1200000,
    "currentPublicFundingPerStudent": 8000,
    "mostExpensiveNonBoardingTuitionUsd": 35000,
    "topMetros": [
      {
        "name": "City Name",
        "isCapital": true,
        "estimatedK12Children": 350000,
        "childrenInFamiliesAbove200kUsd": 45000,
        "childrenInFamiliesAbove300kUsd": 22000,
        "childrenInFamiliesAbove400kUsd": 11000,
        "childrenInFamiliesAbove500kUsd": 5500
      }
    ]
  }
}

FINANCIAL DATA INSTRUCTIONS:
- "gdpPerCapitaUsd": numeric GDP per capita in USD
- "schoolAgePopulationNum": total K-12 school-age population as a number
- "currentPublicFundingPerStudent": current government per-student education spending in USD
- "mostExpensiveNonBoardingTuitionUsd": the tuition of the MOST EXPENSIVE non-boarding K-12 school in the country/state, in USD
- "topMetros": the 3 LARGEST metropolitan areas. For each:
  - "name": city/metro name
  - "isCapital": true if this is the capital city
  - "estimatedK12Children": total K-12 age children in this metro area
  - "childrenInFamiliesAbove200kUsd": estimated K-12 children in families with household income >= $200,000 USD equivalent
  - "childrenInFamiliesAbove300kUsd": estimated K-12 children in families with household income >= $300,000 USD equivalent
  - "childrenInFamiliesAbove400kUsd": estimated K-12 children in families with household income >= $400,000 USD equivalent
  - "childrenInFamiliesAbove500kUsd": estimated K-12 children in families with household income >= $500,000 USD equivalent

For the wealthy family estimates, use the best available data on income distribution, wealth concentration, and purchasing power in that country. These are estimates — be reasonable and conservative. For US states, use IRS AGI data. For other countries, convert to USD equivalent using PPP or market exchange rates as appropriate.

Be specific with numbers. Return ONLY the JSON object, no markdown fences.`;

// ─── Term Sheet HTML Generator ───────────────────────────────────────────────

function generateTermSheetHtml(ctx: CountryContext, model: FinancialModel): string {
  const programName = ctx.localizedProgramName || ctx.country;

  // Flagship schools table rows
  const flagshipRows = model.flagship.schools
    .map(
      (s) =>
        `<tr>
          <td>${s.metro}${s.isCapital ? " (Capital)" : ""}</td>
          <td class="amt">${s.count}</td>
          <td class="amt">${fmtNum(model.flagship.capacityPerSchool)}</td>
          <td class="amt">${fmtUsd(model.flagship.tuitionPerYear)}</td>
          <td class="amt">${fmtCompact(s.count * model.flagship.capacityPerSchool * model.flagship.tuitionPerYear)}</td>
        </tr>`,
    )
    .join("\n");

  // Counterparty cost breakdown rows
  const costRows = model.counterparty.costBreakdown
    .map(
      (c) =>
        `<tr>
          <td>${c.item}</td>
          <td class="amt">${fmtUsd(c.amount)}</td>
          <td class="notes">${c.note}</td>
        </tr>`,
    )
    .join("\n");

  // Upfront investment rows
  const upfrontFixedRows = model.upfront.fixedItems
    .map(
      (r) =>
        `<tr><td>${r.item}</td><td class="amt">${fmtCompact(r.amountUsd)}</td><td>${r.recipient}</td><td class="notes">Paid upfront</td></tr>`,
    )
    .join("\n");

  const upfrontVariableRows = model.upfront.variableItems
    .map(
      (r) =>
        `<tr><td>${r.item}</td><td class="amt">${fmtCompact(r.amountUsd)}</td><td>${r.recipient}</td><td class="notes">${r.note || ""}</td></tr>`,
    )
    .join("\n");

  // Ongoing investment rows
  const ongoingRows = model.ongoing.items
    .map(
      (r) =>
        `<tr><td>${r.item}</td><td class="amt">${r.amount}</td><td>${r.recipient}</td></tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${programName} — Term Sheet</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  @page { size: A4 landscape; margin: 0.5in; }

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

  .page { max-width: 1100px; margin: 0 auto; padding: 40px; }

  .header {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 32px; padding-bottom: 20px; border-bottom: 3px solid #0a1628;
  }
  .header-left h1 { font-size: 24px; font-weight: 700; color: #0a1628; letter-spacing: -0.02em; margin-bottom: 4px; }
  .header-left .subtitle { font-size: 13px; color: #4a5568; font-weight: 400; }
  .header-right { text-align: right; font-size: 10px; color: #718096; }
  .header-right .brand { font-size: 14px; font-weight: 700; color: #1a56db; margin-bottom: 2px; }

  .section-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
    text-transform: uppercase; color: #1a56db; margin-bottom: 12px;
  }
  .section-title { font-size: 18px; font-weight: 700; color: #0a1628; margin-bottom: 16px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }

  th {
    text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #4a5568; padding: 8px 12px;
    border-bottom: 2px solid #e2e8f0; background: #f7fafc;
  }

  td {
    padding: 8px 12px; border-bottom: 1px solid #edf2f7;
    font-size: 11px; vertical-align: top;
  }
  td.amt { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.highlight { background: linear-gradient(135deg, #1a56db08, #1a56db12); color: #1a56db; font-weight: 700; }
  td.notes { font-size: 10px; color: #718096; max-width: 280px; }

  tr.total-row td {
    font-weight: 700; border-top: 2px solid #0a1628;
    border-bottom: 2px solid #0a1628; background: #f7fafc;
  }
  tr.section-sep td {
    font-weight: 700; font-size: 10px; letter-spacing: 0.08em;
    text-transform: uppercase; color: #718096; padding-top: 14px; border-bottom: none;
  }

  .two-col { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 32px; margin-bottom: 32px; }
  .section-box { margin-bottom: 24px; }

  .callout {
    background: #f0f4ff; border-left: 4px solid #1a56db;
    padding: 14px 18px; margin-bottom: 20px; border-radius: 0 6px 6px 0;
  }
  .callout p { font-size: 11px; line-height: 1.6; color: #2d3748; }

  .callout-warn {
    background: #fffbeb; border-left: 4px solid #d97706;
    padding: 14px 18px; margin-bottom: 20px; border-radius: 0 6px 6px 0;
  }
  .callout-warn p { font-size: 11px; line-height: 1.6; color: #78350f; }

  .footer {
    margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0;
    display: flex; justify-content: space-between; font-size: 9px; color: #a0aec0;
  }

  .scale-badges { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .scale-badge {
    display: flex; flex-direction: column; padding: 10px 16px;
    background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 6px; min-width: 140px;
  }
  .scale-badge .label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #718096; margin-bottom: 2px; }
  .scale-badge .value { font-size: 12px; font-weight: 600; color: #0a1628; }

  .prong-label {
    display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; padding: 3px 10px; border-radius: 4px; margin-bottom: 8px;
  }
  .prong-1 { background: #1a56db; color: #fff; }
  .prong-2 { background: #0a1628; color: #fff; }
</style>
</head>
<body>
<div class="page">
  <!-- ═══ HEADER ═══ -->
  <div class="header">
    <div class="header-left">
      <h1>${ctx.flagEmoji} ${programName} — Term Sheet</h1>
      <div class="subtitle">${ctx.formalName} National Education Transformation Program</div>
    </div>
    <div class="header-right">
      <div class="brand">ALPHA</div>
      <div>Confidential & Proprietary</div>
      <div>${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" })}</div>
    </div>
  </div>

  <!-- ═══ COUNTRY CONTEXT ═══ -->
  <div class="callout">
    <p><strong>${ctx.headOfStateTitle}:</strong> ${ctx.headOfState} · <strong>Population:</strong> ${ctx.population} · <strong>GDP per Capita:</strong> ${ctx.gdpPerCapita} · <strong>School-Age Population:</strong> ${ctx.schoolAgePopulation}</p>
  </div>

  <!-- ═══ KEY METRICS ═══ -->
  <div class="scale-badges">
    <div class="scale-badge">
      <span class="label">Flagship Schools</span>
      <span class="value">${model.flagship.totalSchoolCount} schools · ${fmtNum(model.flagship.totalStudents)} students</span>
    </div>
    <div class="scale-badge">
      <span class="label">National Schools</span>
      <span class="value">${fmtNum(model.counterparty.minStudentsPerYear)} students / year</span>
    </div>
    <div class="scale-badge">
      <span class="label">National Per-Student Budget</span>
      <span class="value">${fmtUsd(model.counterparty.perStudentBudget)} / year</span>
    </div>
    <div class="scale-badge">
      <span class="label">Total Up-Front Investment</span>
      <span class="value">${fmtCompact(model.upfront.totalUsd)}</span>
    </div>
  </div>

  <!-- ═══ PRONG 1: FLAGSHIP ALPHAS ═══ -->
  <div class="section-box">
    <span class="prong-label prong-1">Prong 1</span>
    <div class="section-title">Flagship Alpha Schools</div>
    <p style="font-size: 11px; color: #4a5568; margin-bottom: 14px; line-height: 1.6;">
      100% owned by Alpha. Premium "halo brand" schools in ${ctx.country}'s top metropolitan areas.
      Tuition set to exceed the most expensive non-boarding school in the country.
      <strong>25% operating margin.</strong>
      The country/state must provide a <strong>contractual 50% capacity backstop for 5 years.</strong>
    </p>
    <table>
      <thead>
        <tr>
          <th>Metro Area</th>
          <th>Schools</th>
          <th>Capacity / School</th>
          <th>Tuition / Year</th>
          <th>Annual Revenue</th>
        </tr>
      </thead>
      <tbody>
        ${flagshipRows}
        <tr class="total-row">
          <td>Total</td>
          <td class="amt">${model.flagship.totalSchoolCount}</td>
          <td></td>
          <td></td>
          <td class="amt">${fmtCompact(model.flagship.totalAnnualRevenue)}</td>
        </tr>
      </tbody>
    </table>
    ${model.flagship.scholarshipNote ? `<div class="callout-warn"><p>⚠️ ${model.flagship.scholarshipNote}</p></div>` : ""}
  </div>

  <!-- ═══ PRONG 2: COUNTERPARTY SCHOOLS ═══ -->
  <div class="section-box">
    <span class="prong-label prong-2">Prong 2</span>
    <div class="section-title">Counterparty-Owned Schools Operated by Alpha</div>
    <p style="font-size: 11px; color: #4a5568; margin-bottom: 14px; line-height: 1.6;">
      100% owned by ${ctx.country}. 0% owned by Alpha — Alpha operates the schools on behalf of the country/state.
      Can be operated as <strong>public or private schools</strong>.
      Minimum commitment: <strong>${fmtNum(model.counterparty.minStudentsPerYear)} students per year</strong>.
      Per-student funding: <strong>${fmtUsd(model.counterparty.perStudentBudget)} / year</strong>.
    </p>
    <table>
      <thead>
        <tr>
          <th>Cost Item (Per Student)</th>
          <th>Amount</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        ${costRows}
        <tr class="total-row">
          <td>Total Per Student</td>
          <td class="amt">${fmtUsd(model.counterparty.perStudentBudget)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- ═══ INVESTMENT REQUIRED ═══ -->
  <div class="section-box page-break">
    <div class="section-label">Investment Required</div>
    <div class="section-title">Upfront Investment</div>
    <p style="font-size: 10px; color: #718096; margin-bottom: 12px;">
      Indicative of ${fmtNum(model.counterparty.minStudentsPerYear)} students. Upfront development costs do not change; prepaid fees scale above ${fmtNum(model.counterparty.minStudentsPerYear)} students.
    </p>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Amount</th>
          <th>Recipient</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr class="section-sep"><td colspan="4">FIXED DEVELOPMENT COSTS</td></tr>
        ${upfrontFixedRows}
        <tr class="section-sep"><td colspan="4">PREPAID FEES (variable with student count)</td></tr>
        ${upfrontVariableRows}
        <tr class="total-row">
          <td>Total Upfront</td>
          <td class="amt">${fmtCompact(model.upfront.totalUsd)}</td>
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>

    <div class="section-title" style="margin-top: 24px;">Ongoing Annual Investment</div>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Amount</th>
          <th>Recipient</th>
        </tr>
      </thead>
      <tbody>
        ${ongoingRows}
      </tbody>
    </table>

    ${
      model.scholarshipGap.perStudentGap > 0
        ? `<div class="callout">
            <p><strong>Funding Gap:</strong> ${model.scholarshipGap.note}</p>
          </div>`
        : `<div class="callout">
            <p><strong>Funding:</strong> ${model.scholarshipGap.note}</p>
          </div>`
    }
  </div>

  <!-- ═══ DEAL STRUCTURE SUMMARY ═══ -->
  <div class="section-box">
    <div class="section-label">Deal Structure</div>
    <table>
      <thead><tr><th>Parameter</th><th>Flagship Schools (Prong 1)</th><th>National Schools (Prong 2)</th></tr></thead>
      <tbody>
        <tr><td><strong>Ownership</strong></td><td>100% Alpha</td><td>100% ${ctx.country} / 0% Alpha</td></tr>
        <tr><td><strong>Operated By</strong></td><td>Alpha</td><td>Alpha (on behalf of ${ctx.country})</td></tr>
        <tr><td><strong>Students</strong></td><td>${fmtNum(model.flagship.totalStudents)}</td><td>${fmtNum(model.counterparty.minStudentsPerYear)} minimum</td></tr>
        <tr><td><strong>Tuition / Funding</strong></td><td>${fmtUsd(model.flagship.tuitionPerYear)} / year</td><td>${fmtUsd(model.counterparty.perStudentBudget)} / year (fixed)</td></tr>
        <tr><td><strong>Operating Margin</strong></td><td>25%</td><td>Per cost structure above</td></tr>
        <tr><td><strong>Operating Fee</strong></td><td>N/A (Alpha-owned)</td><td>10% of funding (min ${fmtUsd(2500)}/student)</td></tr>
        <tr><td><strong>Timeback License</strong></td><td>N/A (Alpha-owned)</td><td>20% of funding (min ${fmtUsd(5000)}/student)</td></tr>
        <tr><td><strong>Backstop</strong></td><td>50% capacity, 5 years</td><td>N/A</td></tr>
        <tr><td><strong>Real Estate</strong></td><td>Sourced by counterparty</td><td>Sourced by counterparty</td></tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    <span>© ${new Date().getFullYear()} Alpha Holdings. Confidential & Proprietary.</span>
    <span>${programName} Term Sheet — ${ctx.formalName}</span>
  </div>
</div>
</body>
</html>`;
}

// ─── Pitch Deck HTML Generator ───────────────────────────────────────────────

function generatePitchDeckHtml(ctx: CountryContext, model: FinancialModel): string {
  const programName = ctx.localizedProgramName || ctx.country;
  const strengths = (ctx.keyStrengths || []).map((s) => `<li>${s}</li>`).join("\n");

  // Flagship details for the deck
  const flagshipMetroList = model.flagship.schools
    .map((s) => `${s.metro}${s.isCapital ? " (Capital)" : ""}: ${s.count} school${s.count > 1 ? "s" : ""}`)
    .join(", ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${programName} — AI-Native National Education System</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: 16in 9in; margin: 0; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .slide { page-break-after: always; break-after: page; }
    .slide:last-child { page-break-after: avoid; }
  }

  body { font-family: 'Inter', -apple-system, sans-serif; color: #1a1a2e; background: #f0f2f8; }

  .slide {
    width: 100%; max-width: 1280px; margin: 0 auto 2px; aspect-ratio: 16/9;
    position: relative; overflow: hidden; display: flex; flex-direction: column;
    background: linear-gradient(135deg, #f8f9ff 0%, #eef1fa 100%);
  }
  .slide-footer {
    position: absolute; bottom: 0; left: 0; right: 0;
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 48px; font-size: 10px; color: #a0aec0;
  }
  .slide-footer .brand { font-weight: 700; color: #1a56db; font-size: 12px; }
  .slide-num { font-variant-numeric: tabular-nums; }

  /* ── Slide 1: Cover ── */
  .slide-cover {
    background: linear-gradient(135deg, #0a1628 0%, #1a2744 40%, #1a56db 100%);
    color: #fff; justify-content: center; align-items: center; text-align: center; padding: 60px;
  }
  .slide-cover .flag { font-size: 64px; margin-bottom: 24px; }
  .slide-cover h1 { font-size: 48px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 12px; }
  .slide-cover h1 span { color: #60a5fa; }
  .slide-cover .tagline { font-size: 20px; font-weight: 300; color: #94b8ff; max-width: 700px; }
  .slide-cover .meta { position: absolute; bottom: 48px; font-size: 12px; color: #6b8cc7; }

  /* ── Slide: Content ── */
  .slide-content { padding: 48px; }
  .slide-content .label { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #1a56db; margin-bottom: 8px; }
  .slide-content h2 { font-size: 32px; font-weight: 800; color: #0a1628; letter-spacing: -0.02em; line-height: 1.15; margin-bottom: 28px; }
  .slide-content h2 span { color: #1a56db; }

  .two-pane { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; flex: 1; }
  .pane { display: flex; flex-direction: column; }
  .pane-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .pane-icon { width: 44px; height: 44px; border-radius: 50%; background: #e8eeff; display: flex; align-items: center; justify-content: center; font-size: 20px; }
  .pane-title { font-size: 16px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #0a1628; }

  .stack-item { font-size: 13px; padding: 8px 0; border-bottom: 1px solid #e8ecf4; color: #2d3748; line-height: 1.5; }
  .stack-item strong { color: #0a1628; }

  .bullet-list { list-style: none; padding: 0; }
  .bullet-list li {
    position: relative; padding: 8px 0 8px 20px; font-size: 14px; color: #2d3748;
    line-height: 1.5; border-bottom: 1px solid #edf2f7;
  }
  .bullet-list li::before {
    content: ""; position: absolute; left: 0; top: 14px;
    width: 8px; height: 8px; border-radius: 50%; background: #1a56db;
  }

  .facts-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  .fact-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
  .fact-card .fact-value { font-size: 22px; font-weight: 800; color: #0a1628; margin-bottom: 4px; }
  .fact-card .fact-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #718096; }

  .results-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 16px; }
  .result-badge { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; text-align: center; }
  .result-badge .result-value { font-size: 32px; font-weight: 800; color: #1a56db; line-height: 1; margin-bottom: 6px; }
  .result-badge .result-label { font-size: 11px; color: #4a5568; line-height: 1.4; }

  .callout-box { background: #f0f4ff; border-left: 4px solid #1a56db; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-top: 16px; }
  .callout-box p { font-size: 13px; line-height: 1.6; color: #2d3748; }

  /* ── Deck tables ── */
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
  .deck-table .total-row td { font-weight: 700; border-top: 2px solid #0a1628; border-bottom: 2px solid #0a1628; background: #f7fafc; }

  .prong-badge {
    display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; padding: 3px 10px; border-radius: 4px; margin-bottom: 6px;
  }
  .prong-badge.p1 { background: #1a56db; color: #fff; }
  .prong-badge.p2 { background: #0a1628; color: #fff; }
</style>
</head>
<body>

<!-- ═══ SLIDE 1: COVER ═══ -->
<div class="slide slide-cover">
  <div class="flag">${ctx.flagEmoji}</div>
  <h1>${programName}<br><span>World's First AI-Native<br>National Education System</span></h1>
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
  <h2>Launching ${programName} on Alpha's <span>full education stack</span></h2>

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
    </div>

    <div class="pane">
      <div class="pane-header">
        <div class="pane-icon">${ctx.flagEmoji}</div>
        <div class="pane-title">${programName}: Nationally Owned</div>
      </div>
      <div class="stack-item"><strong>Education Sovereignty:</strong> ${ctx.country} owns 100% of national schools</div>
      <div class="stack-item"><strong>Infrastructure:</strong> Built to scale across ${fmtNum(model.counterparty.minStudentsPerYear)}+ students</div>
      <div class="stack-item"><strong>Localized AI Apps:</strong> ${ctx.languageApps}</div>
      <div class="stack-item"><strong>Local Life-Skills:</strong> ${ctx.localLifeSkillsFocus}</div>
      <div class="stack-item"><strong>Talent Academy:</strong> Recruit and train ${programName} Guides</div>
      <div class="stack-item"><strong>National eduLLM:</strong> Embedded local laws, values, and culture</div>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${new Date().getFullYear()}. Confidential & Proprietary.</span>
    <span class="slide-num">4</span>
  </div>
</div>

<!-- ═══ SLIDE 5: Two-Prong Deal Structure ═══ -->
<div class="slide slide-content">
  <div class="label">Transaction Details</div>
  <h2>${programName} <span>Two-Prong Deal Structure</span></h2>

  <div class="two-pane">
    <div class="pane">
      <span class="prong-badge p1">Prong 1 — Flagship Alphas</span>
      <div style="font-size:13px; font-weight:700; color:#0a1628; margin-bottom:8px;">100% Owned by Alpha</div>
      <div class="stack-item"><strong>Schools:</strong> ${model.flagship.totalSchoolCount} flagship${model.flagship.totalSchoolCount > 1 ? "s" : ""} — ${flagshipMetroList}</div>
      <div class="stack-item"><strong>Capacity:</strong> ${fmtNum(model.flagship.capacityPerSchool)} students per school</div>
      <div class="stack-item"><strong>Tuition:</strong> ${fmtUsd(model.flagship.tuitionPerYear)} / year</div>
      <div class="stack-item"><strong>Total Students:</strong> ${fmtNum(model.flagship.totalStudents)}</div>
      <div class="stack-item"><strong>Annual Revenue:</strong> ${fmtCompact(model.flagship.totalAnnualRevenue)}</div>
      <div class="stack-item"><strong>Operating Margin:</strong> 25%</div>
      <div class="stack-item"><strong>Backstop:</strong> 50% capacity guaranteed for 5 years</div>
    </div>

    <div class="pane">
      <span class="prong-badge p2">Prong 2 — National Schools</span>
      <div style="font-size:13px; font-weight:700; color:#0a1628; margin-bottom:8px;">100% Owned by ${ctx.country}, Operated by Alpha</div>
      <div class="stack-item"><strong>Students:</strong> ${fmtNum(model.counterparty.minStudentsPerYear)} minimum / year</div>
      <div class="stack-item"><strong>Per-Student Budget:</strong> ${fmtUsd(model.counterparty.perStudentBudget)} / year</div>
      <div class="stack-item"><strong>Operating Fee:</strong> 10% of funding (${fmtUsd(2500)}/student)</div>
      <div class="stack-item"><strong>Timeback License:</strong> 20% of funding (${fmtUsd(5000)}/student)</div>
      <div class="stack-item"><strong>Model:</strong> Public or private school</div>
      <div class="stack-item"><strong>Real Estate:</strong> Sourced by counterparty</div>
      <div class="stack-item"><strong>Alpha Equity:</strong> 0% — operator & licensor only</div>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${new Date().getFullYear()}. Confidential & Proprietary.</span>
    <span class="slide-num">5</span>
  </div>
</div>

<!-- ═══ SLIDE 6: Cost Structure ═══ -->
<div class="slide slide-content">
  <div class="label">${programName} National School Cost Structure</div>
  <h2>Per-Student Budget: <span>${fmtUsd(model.counterparty.perStudentBudget)} / Year</span></h2>

  <div style="display: grid; grid-template-columns: 1fr 280px; gap: 24px;">
    <table class="deck-table">
      <thead>
        <tr>
          <th>Cost Item (Per Student)</th>
          <th class="primary-col">Amount</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        ${model.counterparty.costBreakdown
          .map(
            (c) =>
              `<tr><td>${c.item}</td><td class="amt highlight">${fmtUsd(c.amount)}</td><td class="notes">${c.note}</td></tr>`,
          )
          .join("\n")}
        <tr class="total-row">
          <td>Total Per Student</td>
          <td class="amt">${fmtUsd(model.counterparty.perStudentBudget)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>

    <div style="background: #f7fafc; border-radius: 10px; padding: 20px; border: 1px solid #e2e8f0; align-self: start; margin-top: 24px;">
      <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #0a1628; margin-bottom: 12px;">National Schools</div>
      <p style="font-size: 12px; color: #4a5568; line-height: 1.6;">${ctx.country} owns 100% of national schools. Alpha operates them as exclusive operator & licensor.</p>
      <p style="font-size: 12px; color: #4a5568; line-height: 1.6; margin-top: 8px;">Timeback and Operating Fee are non-negotiable minimums per the Alpha Holdings license agreement.</p>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${new Date().getFullYear()}. Confidential & Proprietary.</span>
    <span class="slide-num">6</span>
  </div>
</div>

<!-- ═══ SLIDE 7: Investment Required ═══ -->
<div class="slide slide-content">
  <div class="label">Investment Required</div>
  <h2>Total Upfront: <span>${fmtCompact(model.upfront.totalUsd)}</span></h2>

  <div class="two-pane">
    <div class="pane">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#718096; margin-bottom:10px;">Upfront Investment</div>
      <table class="deck-table">
        <thead><tr><th>Item</th><th>Amount</th><th>Recipient</th></tr></thead>
        <tbody>
          ${model.upfront.fixedItems
            .map(
              (r) =>
                `<tr><td>${r.item}</td><td class="amt">${fmtCompact(r.amountUsd)}</td><td>${r.recipient}</td></tr>`,
            )
            .join("\n")}
          ${model.upfront.variableItems
            .map(
              (r) =>
                `<tr><td>${r.item}</td><td class="amt">${fmtCompact(r.amountUsd)}</td><td>${r.recipient}</td></tr>`,
            )
            .join("\n")}
          <tr class="total-row"><td>Total</td><td class="amt">${fmtCompact(model.upfront.totalUsd)}</td><td></td></tr>
        </tbody>
      </table>
    </div>

    <div class="pane">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#718096; margin-bottom:10px;">Ongoing Annual</div>
      <table class="deck-table">
        <thead><tr><th>Item</th><th>Amount</th><th>Recipient</th></tr></thead>
        <tbody>
          ${model.ongoing.items
            .map(
              (r) =>
                `<tr><td>${r.item}</td><td class="amt">${r.amount}</td><td>${r.recipient}</td></tr>`,
            )
            .join("\n")}
        </tbody>
      </table>
    </div>
  </div>

  <div class="callout-box" style="margin-top: 8px; display: flex; align-items: center; gap: 16px;">
    <div style="font-size: 28px; font-weight: 800; color: #1a56db; white-space: nowrap;">${ctx.schoolAgePopulation}</div>
    <div>
      <p style="font-size: 13px; line-height: 1.5; color: #2d3748;">
        <strong>Significant room to scale.</strong> The initial commitment of ${fmtNum(model.counterparty.minStudentsPerYear)} national school students is a fraction of ${ctx.country}'s school-age population. As the program proves results, there is substantial opportunity to expand well beyond the initial cohort.
      </p>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA</span>
    <span>© ${new Date().getFullYear()}. Confidential & Proprietary.</span>
    <span class="slide-num">7</span>
  </div>
</div>

</body>
</html>`;
}

// ─── Main Generation Flow ────────────────────────────────────────────────────

async function generateDocuments(target: string): Promise<GenerationResult> {
  // Step 1: Get country context + financial data from Claude / OpenAI
  let text = "";
  try {
    const message = await client.messages.create({
      model: "claude_sonnet_4_6",
      max_tokens: 4000,
      system: RESEARCH_PROMPT,
      messages: [
        { role: "user", content: `Generate the country context profile and financial research data for: ${target}` },
      ],
    });
    text = message.content[0].type === "text" ? message.content[0].text : "";
  } catch (e: any) {
    console.error("Claude failed, trying OpenAI:", e.message);
    const response = await openai.responses.create({
      model: "gpt_5_1",
      input: `${RESEARCH_PROMPT}\n\nGenerate the country context profile and financial research data for: ${target}`,
    });
    text = typeof response.output_text === "string" ? response.output_text : "";
  }

  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const ctx: CountryContext = JSON.parse(cleaned);

  // Step 2: Compute financial model from the rules in financial_rules_v1
  const financialModel = computeFinancialModel(ctx.financialData, ctx.country);

  // Step 3: Generate both HTML documents using computed financial model
  const termSheetHtml = generateTermSheetHtml(ctx, financialModel);
  const pitchDeckHtml = generatePitchDeckHtml(ctx, financialModel);

  return { context: ctx, financialModel, termSheetHtml, pitchDeckHtml };
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
        console.error("Generation error:", err);
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
      const model = run.result.financialModel;
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
