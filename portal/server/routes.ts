import type { Express } from "express";
import type { Server } from "http";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { storage } from "./storage";
import { buildTermSheetDocx } from "./docx-builder";
import { computeFinancialModel, fmtCompact, fmtUsd, fmtNum } from "./financial-engine";
import { runLanguageQA } from "./language-qa";
import type { CountryContext, GenerationResult, FinancialResearchData, FinancialModel } from "@shared/schema";

const client = new Anthropic({
  defaultHeaders: { "anthropic-version": "2023-06-01" },
});
const openai = new OpenAI();

// ─── SYSTEM PROMPT: Country Research ─────────────────────────────────────────

const RESEARCH_PROMPT = `You are a research assistant for Alpha Holdings, Inc.
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
  "localizedProgramName": "A SHORT brand name for the country-owned, Alpha-operated SCHOOL NETWORK (2-4 words max, like 'Ed71' for UAE or 'Savoir France' for France). Must be concise enough for a slide title. Reference something culturally meaningful. NEVER include explanations or descriptions — just the brand name itself. MUST NOT contain the word 'Alpha' — these are country-owned schools and cannot carry the Alpha brand. MUST be a COMPLETELY DIFFERENT name from localizedLifeSkillsName.",
  "localizedLifeSkillsName": "A SHORT brand name for the country-specific LIFE-SKILLS CURRICULUM program (1-2 words, like 'AsasCore' for UAE or 'VivreCore' for France). This is the country's equivalent to AlphaCore — the life-skills engine. MUST be a COMPLETELY DIFFERENT name from localizedProgramName — these are two distinct products: the school network vs. the life-skills curriculum. Do NOT reuse or derive from the school network name.",
  "localLifeSkillsFocus": "What life skills matter most in this culture (e.g. entrepreneurship, civic leadership, environmental stewardship). 1-2 sentences.",
  "languageApps": "What localized AI apps would be needed (languages, religious education, cultural studies, ESL). Brief list.",
  "addressableStudentPopulation": "Estimated number of school-age children (5-18) in households with annual income > $250,000 USD (or PPP equivalent). This is the realistic addressable market for a $25,000/student program. Use known data: HNWI counts, wealth reports (Knight Frank, Henley & Partners, Credit Suisse), income distribution data, and international/premium private school enrollment as proxies. For wealthy nations (GDP per capita > $40k), this could be millions. For developing nations, it may be tens of thousands. Give a specific number like '15,000-25,000 students' or '2.1 million students'. Be realistic, not aspirational.",
  "addressableMethodology": "1-2 sentences explaining the data sources and logic behind the estimate (e.g. 'Based on 7,200 HNWIs per Henley 2024, ~3,600 households with 2-3 school-age children, plus sub-millionaire affluent segment currently enrolled in international schools.')"
}

Be specific with numbers. Return ONLY the JSON object, no markdown fences.`;

// ─── Fixed Economics (from Ed71 pages 7-8) ───────────────────────────────────

const FIXED_ECONOMICS = {
  upfront: [
    { item: "AlphaCore License", amount: "$250M", recipient: "Alpha Holdings, Inc." },
    { item: "EdTech App R&D", amount: "$250M", recipient: "Local expense" },
    { item: "Local Life-Skills R&D", amount: "$250M", recipient: "Local expense" },
    { item: "Management Fee Prepay", amount: "$250M", recipient: "Prepaid OpEx for 100k student-years" },
    { item: "TimeBack License Fee Prepay", amount: "$500M", recipient: "Prepaid OpEx for 100k student-years" },
  ],
  upfrontTotal: "$1.5B",
  ongoing: [
    { item: "Parent Edu / Launch / Guides", amount: "$25-50M / yr", recipient: "Local expense" },
    { item: "Additional School Funding", amount: "$1B / yr*", recipient: "Local expense" },
    { item: "Management Fee", amount: "10% budget", recipient: "OpEx to Alpha Holdings, Inc." },
    { item: "TimeBack License Fee", amount: "20% budget", recipient: "OpEx to Alpha Holdings, Inc." },
  ],

  costStructure: [
    { item: "Tuition", alpha: "$50,000", national: "$25,000", notes: "Budget for $25,000 school" },
    { item: "Guides", alpha: "$14,000", national: "$4,500", notes: "Alpha 11:1 ratio & higher comp; Country-owned 25:1 ratio & lower comp" },
    { item: "Timeback / Software", alpha: "$10,000", national: "$5,000", notes: "20% of Budget" },
    { item: "Programs and Life Skills", alpha: "$9,000", national: "$4,250", notes: "Alpha is 2x country-owned" },
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
  const programName = ctx.localizedProgramName || ctx.country;
  const lifeSkillsName = ctx.localizedLifeSkillsName || `${ctx.country}Core`;
  const year = new Date().getFullYear();
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // ── Fix #1: Dynamic scale targets based on addressable population ──
  function computeScaleTargets(addressable: string): { y1Students: string; y1Communities: string; y5Students: string; y5Communities: string } {
    const match = addressable?.match(/([\d,]+)/);
    const pop = match ? parseInt(match[1].replace(/,/g, '')) : 50000;
    const y1Num = Math.max(1000, Math.round(pop * 0.01 / 500) * 500);
    const y1Comm = Math.max(1, Math.round(y1Num / 800));
    const y5Num = Math.round(pop * 0.5 / 1000) * 1000;
    const y5Comm = Math.max(10, Math.round(y5Num / 4000));
    const fmtK = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}K` : n.toLocaleString();
    return {
      y1Students: y1Num.toLocaleString(),
      y1Communities: String(y1Comm),
      y5Students: fmtK(y5Num),
      y5Communities: String(y5Comm),
    };
  }
  const scale = computeScaleTargets(ctx.addressableStudentPopulation);

  // ── Fix #2: Parse ed spend to separate dollar amount from parenthetical ──
  const edSpendMatch = ctx.currentEdSpendPerStudent?.match(/^(\$[\d,.]+)(.*)$/);
  const edSpendValue = edSpendMatch ? edSpendMatch[1] : ctx.currentEdSpendPerStudent;
  const edSpendNote = edSpendMatch ? edSpendMatch[2].trim().replace(/^per student\s*/i, '') : '';

  const upfrontRows = FIXED_ECONOMICS.upfront
    .map(r => {
      const item = r.item
        .replace("EdTech App R&D", `${ctx.country} EdTech App R&D`)
        .replace("Local Life-Skills R&D", `${lifeSkillsName} Life-Skills R&D`);
      return `<tr><td>${item}</td><td class="amt">${r.amount}</td><td class="recipient">${r.recipient}</td></tr>`;
    })
    .join("\n");

  const ongoingRows = FIXED_ECONOMICS.ongoing
    .map(r => `<tr><td>${r.item}</td><td class="amt">${r.amount}</td><td class="recipient">${r.recipient}</td></tr>`)
    .join("\n");

  const costRows = FIXED_ECONOMICS.costStructure
    .map(r => `<tr><td>${r.item}</td><td class="amt">${r.alpha}</td><td class="amt hl">${r.national}</td><td class="notes">${r.notes}</td></tr>`)
    .join("\n");

  const strengths = (ctx.keyStrengths || [])
    .map(s => `<li>${s}</li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${programName} — Term Sheet | Alpha Holdings, Inc.</title>
<meta name="description" content="${programName} National Education Transformation Program — Confidential Term Sheet">
<style>
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap');

:root {
  --navy: #0a1628;
  --navy-mid: #111d30;
  --navy-light: #1a2b45;
  --blue: #0000E5;
  --blue-light: #59BBF9;
  --gold: #BF9A4A;
  --gold-light: #d4b06a;
  --cream: #fdf8f0;
  --cream-dark: #f5edd8;
  --white: #ffffff;
  --text-muted: #8a9ab5;
  --text-light: #c4cdd9;
  --text-body: #4a5568;
  --border-light: rgba(191, 154, 74, 0.15);
  --border-subtle: rgba(10, 22, 40, 0.08);
  --font-display: 'Montserrat', -apple-system, sans-serif;
  --font-body: 'Inter', -apple-system, sans-serif;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --max-w: 1200px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; }
body { font-family: var(--font-body); font-size: 16px; line-height: 1.6; color: var(--navy); background: var(--cream); overflow-x: hidden; }
img { max-width: 100%; display: block; }
a { color: inherit; text-decoration: none; }

.container { max-width: var(--max-w); margin: 0 auto; padding: 0 2rem; }

/* ─── HEADER ─── */
.site-header {
  position: sticky; top: 0; z-index: 100;
  background: rgba(10, 22, 40, 0.97);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-light);
  transition: box-shadow 0.3s var(--ease);
}
.site-header.scrolled { box-shadow: 0 2px 24px rgba(0,0,0,0.25); }
.header-inner {
  display: flex; align-items: center; justify-content: space-between;
  max-width: var(--max-w); margin: 0 auto; padding: 0 2rem; height: 64px;
}
.logo-link { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.logo-bird { width: 36px; height: 36px; }
.logo-text {
  font-family: var(--font-display); font-size: 0.8125rem; font-weight: 700;
  color: var(--white); letter-spacing: 0.18em; text-transform: uppercase;
}
.main-nav { display: flex; align-items: center; gap: 1.75rem; }
.main-nav a {
  font-size: 0.8125rem; font-weight: 500; color: var(--text-light);
  letter-spacing: 0.02em; padding: 4px 0;
  border-bottom: 2px solid transparent;
  transition: color 180ms var(--ease), border-color 180ms var(--ease);
  cursor: pointer;
}
.main-nav a:hover { color: var(--cream); }
.main-nav a.active { color: var(--gold); border-bottom-color: var(--gold); }

.nav-toggle { display: none; background: none; border: none; cursor: pointer; padding: 8px; }
.nav-toggle span { display: block; width: 24px; height: 2px; background: var(--cream); margin: 5px 0; transition: transform 0.3s var(--ease), opacity 0.3s var(--ease); }

@media (max-width: 768px) {
  .nav-toggle { display: block; z-index: 200; }
  .nav-toggle.open span:nth-child(1) { transform: rotate(45deg) translate(5px, 5px); }
  .nav-toggle.open span:nth-child(2) { opacity: 0; }
  .nav-toggle.open span:nth-child(3) { transform: rotate(-45deg) translate(5px, -5px); }
  .main-nav {
    position: fixed; top: 0; right: -100%; width: 280px; height: 100vh;
    background: var(--navy); flex-direction: column; align-items: flex-start;
    justify-content: flex-start; padding: 80px 2rem 2rem; gap: 1rem;
    transition: right 0.3s var(--ease); box-shadow: -4px 0 20px rgba(0,0,0,0.3); z-index: 150;
  }
  .main-nav.open { right: 0; }
  .main-nav a { font-size: 1rem; padding: 8px 0; }
}

/* ─── HERO ─── */
.hero {
  background: linear-gradient(160deg, var(--navy) 0%, var(--navy-mid) 50%, #0a1e3d 100%);
  color: var(--cream); padding: clamp(5rem, 12vw, 8rem) 0 clamp(4rem, 10vw, 6rem);
  position: relative; overflow: hidden;
}
.hero::before {
  content: ''; position: absolute; top: -40%; right: -15%; width: 50%; height: 180%;
  background: radial-gradient(ellipse, rgba(0, 0, 229, 0.06) 0%, transparent 70%);
  pointer-events: none;
}
.hero::after {
  content: ''; position: absolute; bottom: -20%; left: -10%; width: 40%; height: 120%;
  background: radial-gradient(ellipse, rgba(191, 154, 74, 0.04) 0%, transparent 70%);
  pointer-events: none;
}
.hero-badge {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--gold); border: 1px solid var(--gold); border-radius: 4px;
  padding: 0.3rem 0.85rem; margin-bottom: 1.5rem;
}
.hero-flag { font-size: 1.1rem; line-height: 1; }
.hero h1 {
  font-family: var(--font-display); font-weight: 800;
  font-size: clamp(2.25rem, 5vw, 3.25rem); letter-spacing: -0.03em;
  line-height: 1.1; color: var(--white); margin-bottom: 1rem;
}
.hero h1 span { color: var(--blue-light); }
.hero .subline {
  font-size: clamp(1rem, 2vw, 1.2rem); color: var(--text-light);
  max-width: 640px; line-height: 1.65; margin-bottom: 2rem;
}
.hero-meta {
  font-size: 0.75rem; color: var(--text-muted); letter-spacing: 0.04em;
}
.hero-meta strong { color: var(--text-light); }

/* ─── SECTION DIVIDERS (Fix #3) ─── */
.section-divider { position: relative; height: 80px; margin-top: -1px; overflow: hidden; }
.section-divider svg { position: absolute; width: 100%; height: 100%; left: 0; top: 0; display: block; }
.section-divider.cream-to-white svg { fill: var(--white); }
.section-divider.white-to-navy svg { fill: var(--navy); }
.section-divider.navy-to-cream svg { fill: var(--cream); }
.section-divider.cream-to-navy svg { fill: var(--navy); }
.section-divider.white-to-cream svg { fill: var(--cream); }
.section-divider.navy-to-white svg { fill: var(--white); }

/* ─── SECTIONS ─── */
.section { padding: 5rem 0; }
.section-lg { padding: 6rem 0; }
.section-cream { background: var(--cream); }
.section-white { background: var(--white); }
.section-navy { background: var(--navy); color: var(--cream); }
.section-dark { background: var(--navy-mid); color: var(--cream); }

.section-eyebrow {
  display: block; font-family: var(--font-display);
  font-size: 0.75rem; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--blue); margin-bottom: 0.5rem;
}
.section-navy .section-eyebrow,
.section-dark .section-eyebrow { color: var(--gold); }

.section-title {
  font-family: var(--font-display); font-weight: 700;
  font-size: clamp(1.75rem, 3.5vw, 2.5rem); letter-spacing: -0.02em;
  line-height: 1.15; margin-bottom: 1rem;
}
.section-navy .section-title { color: var(--cream); }

.section-subtitle {
  font-size: 1.0625rem; color: var(--text-body); line-height: 1.65;
  max-width: 700px;
}
.section-navy .section-subtitle { color: var(--text-light); }

/* ─── PULL QUOTE (Fix #5) ─── */
.pull-quote {
  background: var(--cream); padding: 4rem 0;
}
.pull-quote-inner {
  max-width: 900px; margin: 0 auto; padding: 0 2rem;
  border-left: 4px solid var(--gold); padding-left: 2.5rem;
}
.pull-quote-inner blockquote {
  font-family: var(--font-display); font-weight: 400; font-style: italic;
  font-size: clamp(1.25rem, 2.5vw, 1.625rem); line-height: 1.6;
  color: var(--navy); max-width: none;
}
.pull-quote-inner cite {
  display: block; margin-top: 1rem; font-family: var(--font-body);
  font-size: 0.8125rem; font-style: normal; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--gold);
}

/* ─── METRICS GRID ─── */
.metrics-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1.25rem;
}
.metric {
  text-align: center; padding: 1.5rem 1rem; background: var(--white);
  border: 1px solid var(--border-subtle); border-radius: 8px;
  transition: transform 180ms var(--ease), box-shadow 180ms var(--ease);
}
.metric:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
.metric-value {
  font-family: var(--font-display); font-weight: 800;
  font-size: clamp(1.25rem, 2vw, 1.5rem); color: var(--gold); margin-bottom: 0.35rem; line-height: 1.2;
}
.metric-label { font-size: 0.8125rem; color: var(--text-body); line-height: 1.4; }

/* ─── STATS STRIP ─── */
.stats-strip { background: var(--navy); padding: 3.5rem 0; }
.stats-grid {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 1.5rem; text-align: center;
}
.stat-item { color: var(--cream); }
.stat-number {
  font-family: var(--font-display); font-weight: 800;
  font-size: clamp(1.5rem, 3vw, 2.25rem); color: var(--gold); margin-bottom: 0.35rem; line-height: 1.15;
}
.stat-label { font-size: 0.8125rem; color: var(--text-light); line-height: 1.4; }
.stat-sub { font-size: 0.6875rem; color: var(--text-muted); margin-top: 0.15rem; }

@media (max-width: 768px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 2rem; }
}

/* ─── CARDS ─── */
.card-grid { display: grid; gap: 1.5rem; }
.card-grid-2 { grid-template-columns: repeat(2, 1fr); }
.card-grid-3 { grid-template-columns: repeat(3, 1fr); }
@media (max-width: 768px) { .card-grid-2, .card-grid-3 { grid-template-columns: 1fr; } }
@media (min-width: 769px) and (max-width: 1024px) { .card-grid-3 { grid-template-columns: repeat(2, 1fr); } }

.card {
  background: var(--white); border: 1px solid var(--border-subtle);
  border-radius: 8px; padding: 2rem;
  transition: transform 180ms var(--ease), box-shadow 180ms var(--ease), border-color 180ms var(--ease);
}
.card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.08); border-color: var(--gold); }
.card-dark {
  background: var(--navy-light); border-color: var(--border-light);
}
.card-dark:hover { box-shadow: 0 8px 32px rgba(0,0,0,0.25); border-color: var(--gold); }
.card-dark h4, .card-dark h3 { color: var(--cream); }
.card-dark p { color: var(--text-light); }
.card-blue { border-left: 3px solid var(--blue); }

.card-label {
  display: block; font-family: var(--font-display);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--gold); margin-bottom: 0.5rem;
}
.card-icon {
  width: 48px; height: 48px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 1.25rem;
}
.card-icon.icon-gold { background: rgba(191, 154, 74, 0.12); }
.card-icon.icon-blue { background: rgba(0, 0, 229, 0.08); }
.card-icon svg { width: 24px; height: 24px; }

.card h3, .card h4 {
  font-family: var(--font-display); font-weight: 700;
  font-size: 1.125rem; margin-bottom: 0.75rem; line-height: 1.3;
}
.card p { color: var(--text-body); font-size: 0.9375rem; line-height: 1.6; }

/* ─── TABLES ─── */
.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0 -0.5rem; padding: 0 0.5rem; }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.data-table th {
  text-align: left; font-family: var(--font-display);
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--text-muted);
  padding: 0.75rem 1rem; border-bottom: 2px solid var(--navy);
  background: var(--cream-dark);
}
.data-table th.primary-col { background: var(--blue); color: var(--white); }
.data-table td {
  padding: 0.65rem 1rem; border-bottom: 1px solid rgba(10,22,40,0.06);
  vertical-align: top;
}
.data-table td.amt { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.data-table td.hl {
  background: linear-gradient(135deg, rgba(0,0,229,0.04), rgba(0,0,229,0.08));
  color: var(--blue); font-weight: 700;
}
.data-table td.recipient { font-size: 0.8125rem; color: var(--text-body); }
.data-table td.notes { font-size: 0.75rem; color: var(--text-muted); max-width: 260px; }
.data-table tr.total-row td {
  font-weight: 700; border-top: 2px solid var(--navy);
  border-bottom: 2px solid var(--navy); background: var(--cream-dark);
}
.data-table tr.section-header td {
  font-family: var(--font-display); font-weight: 700; font-size: 0.65rem;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted);
  padding-top: 1rem; border-bottom: none;
}

/* ─── TWO COL ─── */
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; align-items: start; }
@media (max-width: 768px) { .two-col { grid-template-columns: 1fr; gap: 2rem; } }

/* ─── CONTENT LISTS ─── */
.content-list { display: flex; flex-direction: column; gap: 1rem; list-style: none; }
.content-list li {
  position: relative; padding-left: 1.25rem;
  font-size: 0.9375rem; color: var(--text-body); line-height: 1.65;
}
.content-list li::before {
  content: ''; position: absolute; left: 0; top: 0.6em;
  width: 6px; height: 6px; border-radius: 50%; background: var(--blue);
}
.content-list li strong { color: var(--navy); }

.numbered-list { display: flex; flex-direction: column; gap: 1.25rem; list-style: none; }
.numbered-list li {
  display: flex; align-items: flex-start; gap: 1rem;
  font-size: 0.9375rem; color: var(--text-body); line-height: 1.6;
}
.num-circle {
  flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%;
  background: rgba(0,0,229,0.08); display: flex; align-items: center;
  justify-content: center; font-family: var(--font-display);
  font-size: 0.875rem; font-weight: 700; color: var(--blue);
}

/* ─── CALLOUT ─── */
.callout {
  background: rgba(0,0,229,0.04); border-left: 4px solid var(--blue);
  padding: 1.25rem 1.5rem; border-radius: 0 8px 8px 0; margin-top: 1.5rem;
}
.callout p { font-size: 0.9375rem; line-height: 1.65; color: var(--navy); max-width: none; }
.callout strong { color: var(--blue); }

/* ─── DIVIDER ─── */
.divider { height: 1px; background: var(--border-subtle); margin: 0; }
.divider-gold { width: 60px; height: 2px; background: var(--gold); margin-bottom: 1.5rem; }

/* ─── CTA ─── */
.cta-section { background: var(--navy); padding: 4rem 0; text-align: center; }
.cta-section h2 {
  font-family: var(--font-display); font-weight: 700; color: var(--cream);
  font-size: clamp(1.5rem, 3vw, 2rem); margin-bottom: 1rem;
}
.cta-section p { color: var(--text-light); margin: 0 auto 2rem; max-width: 50ch; }
.cta-btn {
  display: inline-flex; align-items: center; gap: 0.5rem;
  background: var(--gold); color: var(--navy); font-family: var(--font-display);
  font-weight: 700; font-size: 0.875rem; padding: 0.75rem 1.75rem; border-radius: 6px;
  letter-spacing: 0.02em;
  transition: background 180ms var(--ease), transform 180ms var(--ease);
}
.cta-btn:hover { background: var(--gold-light); transform: translateY(-1px); }

/* ─── FOOTER (Fix #6) ─── */
.site-footer {
  background: #070e19; color: var(--text-light); padding: 2rem 0;
  border-top: 1px solid var(--border-light);
}
.footer-inner {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 1rem;
}
.footer-brand { display: flex; align-items: center; gap: 10px; }
.footer-bird { width: 28px; height: 28px; flex-shrink: 0; opacity: 0.7; }
.footer-brand-text { display: flex; flex-direction: column; gap: 2px; }
.footer-brand-text strong {
  font-family: var(--font-display); font-size: 0.875rem;
  color: var(--cream); letter-spacing: 0.04em;
}
.footer-brand-text span { font-size: 0.75rem; color: var(--text-muted); }
.footer-center { font-size: 0.75rem; color: var(--text-muted); }
.footer-center a { color: var(--text-light); transition: color 180ms var(--ease); }
.footer-center a:hover { color: var(--cream); }
.footer-links { display: flex; gap: 2rem; font-size: 0.75rem; }
.footer-links a { color: var(--text-muted); transition: color 180ms var(--ease); }
.footer-links a:hover { color: var(--cream); }

@media (max-width: 600px) {
  .footer-inner { flex-direction: column; align-items: flex-start; }
}

/* ─── ANIMATIONS ─── */
.fade-in { opacity: 0; transform: translateY(16px); transition: opacity 0.8s var(--ease), transform 0.8s var(--ease); }
.fade-in.visible { opacity: 1; transform: translateY(0); }

/* ─── PRINT ─── */
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .site-header, .nav-toggle { display: none; }
  .hero { padding: 2rem 0; }
  .section, .section-lg { padding: 2rem 0; }
  .fade-in { opacity: 1; transform: none; }
  .section-divider { display: none; }
}

/* ─── RESPONSIVE UTILS ─── */
@media (max-width: 768px) {
  .section { padding: 3rem 0; }
  .section-lg { padding: 4rem 0; }
  .container { padding: 0 1rem; }
  .card { padding: 1.5rem; }
  .section-divider { height: 50px; }
  .pull-quote-inner { padding-left: 1.5rem; }
}
</style>
</head>
<body>

<!-- ═══════ HEADER ═══════ -->
<header class="site-header">
  <div class="header-inner">
    <span class="logo-link" onclick="document.getElementById('hero').scrollIntoView({behavior:'smooth'})">
      <svg class="logo-bird" viewBox="0 0 200 60" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="28,4 18,18 8,32 28,26 48,32 38,18" fill="white" opacity="0.9"/>
        <polygon points="8,32 28,26 20,40" fill="white" opacity="0.6"/>
        <polygon points="48,32 28,26 36,40" fill="white" opacity="0.6"/>
        <polygon points="20,40 28,26 36,40 28,48" fill="white" opacity="0.4"/>
        <text x="58" y="34" font-family="Montserrat, sans-serif" font-weight="700" font-size="14" fill="white" letter-spacing="3">ALPHA HOLDINGS</text>
      </svg>
    </span>

    <button class="nav-toggle" aria-label="Toggle navigation">
      <span></span><span></span><span></span>
    </button>

    <nav class="main-nav">
      <a onclick="document.getElementById('profile').scrollIntoView({behavior:'smooth'})">Profile</a>
      <a onclick="document.getElementById('vision').scrollIntoView({behavior:'smooth'})">Vision</a>
      <a onclick="document.getElementById('scale').scrollIntoView({behavior:'smooth'})">Scale</a>
      <a onclick="document.getElementById('commercial').scrollIntoView({behavior:'smooth'})">Commercial</a>
      <a onclick="document.getElementById('costs').scrollIntoView({behavior:'smooth'})">Cost Structure</a>
      <a onclick="document.getElementById('program').scrollIntoView({behavior:'smooth'})">Program</a>
    </nav>
  </div>
</header>

<!-- ═══════ HERO ═══════ -->
<section class="hero" id="hero">
  <div class="container">
    <div class="hero-badge">
      <span class="hero-flag">${ctx.flagEmoji}</span>
      ${ctx.formalName}
    </div>
    <h1>${programName}<br><span>National Education Transformation</span></h1>
    <p class="subline">${ctx.culturalNarrative}</p>
    <p class="hero-meta"><strong>Confidential &amp; Proprietary</strong> · ${dateStr} · Alpha Holdings, Inc.</p>
  </div>
</section>

<!-- Curved divider: navy hero → cream profile -->
<div class="section-divider" style="background: var(--navy);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C360,80 1080,80 1440,0 L1440,80 L0,80 Z" fill="var(--cream)"/>
  </svg>
</div>

<!-- ═══════ COUNTRY PROFILE ═══════ -->
<section class="section section-cream" id="profile">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">Country Profile</span>
      <h2 class="section-title">${ctx.formalName}</h2>
      <p class="section-subtitle">${ctx.headOfStateTitle}: ${ctx.headOfState}</p>
    </div>

    <!-- Fix #2: Ed spend metric separated into value + note -->
    <div class="metrics-grid fade-in" style="margin-top: 2.5rem;">
      <div class="metric">
        <div class="metric-value">${ctx.population}</div>
        <div class="metric-label">Population</div>
      </div>
      <div class="metric">
        <div class="metric-value">${ctx.gdpPerCapita}</div>
        <div class="metric-label">GDP per Capita</div>
      </div>
      <div class="metric">
        <div class="metric-value">${ctx.schoolAgePopulation}</div>
        <div class="metric-label">School-Age Population</div>
      </div>
      <div class="metric">
        <div class="metric-value">${edSpendValue}</div>
        <div class="metric-label">Ed. Spend / Student${edSpendNote ? `<br><span style="font-size:0.7rem;opacity:0.7">${edSpendNote}</span>` : ''}</div>
      </div>
      ${ctx.addressableStudentPopulation ? `<div class="metric">
        <div class="metric-value">${ctx.addressableStudentPopulation}</div>
        <div class="metric-label">Addressable Market (AGI &gt; $250K)</div>
      </div>` : ''}
    </div>

    <div class="two-col fade-in" style="margin-top: 3rem;">
      <div>
        <span class="section-eyebrow">National Education Vision</span>
        <p style="font-size: 1.0625rem; line-height: 1.7; color: var(--text-body); margin-top: 0.5rem;">${ctx.nationalEdVision}</p>
      </div>
      <div>
        <span class="section-eyebrow">Key Strengths for Partnership</span>
        <ul class="content-list" style="margin-top: 0.5rem;">
          ${strengths}
        </ul>
      </div>
    </div>

    ${ctx.addressableMethodology ? `<div class="callout fade-in" style="margin-top: 2rem;">
      <p><strong>Addressable Market Methodology:</strong> ${ctx.addressableMethodology}</p>
    </div>` : ''}
  </div>
</section>

<!-- ═══════ FIX #5: PULL QUOTE — Why This Country ═══════ -->
<section class="pull-quote fade-in">
  <div class="pull-quote-inner">
    <blockquote>${ctx.culturalNarrative}</blockquote>
    <cite>The Case for ${ctx.country}</cite>
  </div>
</section>

<!-- Curved divider: cream → white vision -->
<div class="section-divider" style="background: var(--cream);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C480,80 960,80 1440,0 L1440,80 L0,80 Z" fill="var(--white)"/>
  </svg>
</div>

<!-- ═══════ VISION ═══════ -->
<section class="section section-white" id="vision">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">The Vision</span>
      <h2 class="section-title">'Educated in ${ctx.country}' as a Global Credential</h2>
    </div>

    <div class="two-col fade-in" style="margin-top: 2rem;">
      <div>
        <ol class="numbered-list">
          <li>
            <span class="num-circle">1</span>
            <span>The only <strong>AI-native education system</strong>, purposefully designed for national scale — merging cutting-edge technology with proven learning science.</span>
          </li>
          <li>
            <span class="num-circle">2</span>
            <span>Students <strong>master academics in 2 hours per day</strong>, freeing the remaining time for life skills, creativity, and real-world application — learning 2× faster.</span>
          </li>
          <li>
            <span class="num-circle">3</span>
            <span>Creating the next generation of <strong>global leaders</strong> through ${lifeSkillsName} — the life-skills engine for the AI age.</span>
          </li>
        </ol>
      </div>
      <div>
        <div class="card card-blue" style="border-left-width: 4px;">
          <h4 style="color: var(--blue);">Partnership Structure</h4>
          <p><strong>${programName}</strong> is a ${ctx.country}-owned national education platform, with Alpha as exclusive operating partner.</p>
          <p style="margin-top: 0.75rem;">Together we design <strong style="color: var(--blue);">${lifeSkillsName}</strong> — ${ctx.country}'s life-skills engine, the local equivalent to AlphaCore.</p>
          <p style="margin-top: 0.75rem; font-size: 0.875rem; color: var(--text-muted);">${ctx.localLifeSkillsFocus || ''}</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- Curved divider: white → navy stats -->
<div class="section-divider" style="background: var(--white);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C360,80 1080,80 1440,0 L1440,80 L0,80 Z" fill="var(--navy)"/>
  </svg>
</div>

<!-- ═══════ SCALE TARGETS (Fix #1: Dynamic) ═══════ -->
<section class="stats-strip fade-in" id="scale">
  <div class="container">
    <div style="text-align: center; margin-bottom: 2rem;">
      <span class="section-eyebrow" style="color: var(--gold);">Scale Targets</span>
      <h2 class="section-title" style="color: var(--cream); margin-bottom: 0;">Tailored for ${ctx.country}</h2>
    </div>
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-number">${scale.y1Students}</div>
        <div class="stat-label">Students — Year 1</div>
        <div class="stat-sub">${scale.y1Communities} communit${scale.y1Communities === '1' ? 'y' : 'ies'}</div>
      </div>
      <div class="stat-item">
        <div class="stat-number">${scale.y5Students}</div>
        <div class="stat-label">Students — 5-Year</div>
        <div class="stat-sub">${scale.y5Communities}+ communities</div>
      </div>
      <div class="stat-item">
        <div class="stat-number">$25,000</div>
        <div class="stat-label">Per-Student Annual Budget</div>
        <div class="stat-sub">${programName} network</div>
      </div>
      <div class="stat-item">
        <div class="stat-number">${FIXED_ECONOMICS.upfrontTotal}</div>
        <div class="stat-label">Up-Front Investment</div>
        <div class="stat-sub">Total program launch</div>
      </div>
    </div>
  </div>
</section>

<!-- Curved divider: navy → cream commercial -->
<div class="section-divider" style="background: var(--navy);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C480,80 960,80 1440,0 L1440,80 L0,80 Z" fill="var(--cream)"/>
  </svg>
</div>

<!-- ═══════ COMMERCIAL STRUCTURE ═══════ -->
<section class="section-lg section-cream" id="commercial">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">Commercial Structure</span>
      <h2 class="section-title">Investment Framework</h2>
      <p class="section-subtitle">The ${programName} program requires an upfront investment of ${FIXED_ECONOMICS.upfrontTotal} alongside ongoing operational commitments.</p>
    </div>

    <div class="two-col fade-in" style="margin-top: 2.5rem;">
      <!-- Upfront -->
      <div>
        <h3 style="font-family: var(--font-display); font-weight: 700; font-size: 1.125rem; margin-bottom: 1.25rem;">Upfront Investment</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Item</th><th>Amount</th><th>Recipient</th></tr></thead>
            <tbody>
              ${upfrontRows}
              <tr class="total-row"><td>Total</td><td class="amt">${FIXED_ECONOMICS.upfrontTotal}</td><td></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <!-- Ongoing -->
      <div>
        <h3 style="font-family: var(--font-display); font-weight: 700; font-size: 1.125rem; margin-bottom: 1.25rem;">Ongoing Annual Investment</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Item</th><th>Amount</th><th>Recipient</th></tr></thead>
            <tbody>
              ${ongoingRows}
              <tr class="total-row"><td>Total</td><td class="amt">Scale-dependent</td><td></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- Curved divider: cream → white costs -->
<div class="section-divider" style="background: var(--cream);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C360,80 1080,80 1440,0 L1440,80 L0,80 Z" fill="var(--white)"/>
  </svg>
</div>

<!-- ═══════ COST STRUCTURE ═══════ -->
<section class="section section-white" id="costs">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">${programName} Cost Structure</span>
      <h2 class="section-title">Per-Student Economics at $25K Budget</h2>
    </div>

    <div class="callout fade-in" style="margin-bottom: 2rem;">
      <p>We propose implementation through a national network of privately-operated, government-funded schools — and are equally open to other structures.</p>
    </div>

    <div class="table-wrap fade-in">
      <table class="data-table">
        <thead>
          <tr>
            <th>Item (Per Student P&amp;L)</th>
            <th>Alpha @ $50K Tuition</th>
            <th class="primary-col">${programName} @ $25K Budget</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr class="section-header"><td colspan="4">FUNDING</td></tr>
          ${costRows}
        </tbody>
      </table>
    </div>
  </div>
</section>

<!-- ═══════ PROGRAM (Fix #4: Icons on Cards + Dynamic Scale) ═══════ -->
<section class="section section-dark" id="program">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">The ${lifeSkillsName} Engine</span>
      <h2 class="section-title" style="color: var(--cream);">Purpose-built for ${ctx.country}</h2>
    </div>

    <div class="card-grid card-grid-3 fade-in" style="margin-top: 2rem;">
      <div class="card card-dark">
        <div class="card-icon icon-gold">
          <svg viewBox="0 0 24 24" fill="none" stroke="#BF9A4A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
          </svg>
        </div>
        <span class="card-label">Life Skills</span>
        <h4>${lifeSkillsName}</h4>
        <p>${ctx.localLifeSkillsFocus || ctx.country + "'s equivalent to AlphaCore — the life-skills engine tailored for local culture and values."}</p>
      </div>
      <div class="card card-dark">
        <div class="card-icon icon-blue">
          <svg viewBox="0 0 24 24" fill="none" stroke="#59BBF9" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <span class="card-label">Localized AI</span>
        <h4>Language &amp; Culture</h4>
        <p>${ctx.languageApps || 'Localized AI-powered educational apps built specifically for ' + ctx.country + "'s linguistic and cultural context."}</p>
      </div>
      <div class="card card-dark">
        <div class="card-icon icon-gold">
          <svg viewBox="0 0 24 24" fill="none" stroke="#BF9A4A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
          </svg>
        </div>
        <span class="card-label">National Scale</span>
        <h4>From ${scale.y1Communities} to ${scale.y5Communities}+ Communities</h4>
        <p>Beginning with ${scale.y1Students} students in Year 1, scaling to ${scale.y5Students} within five years — building a credential recognized worldwide.</p>
      </div>
    </div>
  </div>
</section>

<!-- ═══════ CTA ═══════ -->
<section class="cta-section">
  <div class="container">
    <h2>Start the Conversation</h2>
    <p>${programName} represents a generational opportunity to build ${ctx.country}'s education legacy. We welcome the opportunity to discuss this partnership.</p>
    <a href="mailto:joe.liemandt@alpha.school" class="cta-btn" target="_blank" rel="noopener noreferrer">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
      joe.liemandt@alpha.school
    </a>
  </div>
</section>

<!-- ═══════ FOOTER (Fix #6: Logo + 3-column) ═══════ -->
<footer class="site-footer">
  <div class="container">
    <div class="footer-inner">
      <div class="footer-brand">
        <svg class="footer-bird" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <polygon points="24,4 16,16 8,28 24,22 40,28 32,16" fill="#c4cdd9" opacity="0.7"/>
          <polygon points="8,28 24,22 18,36" fill="#c4cdd9" opacity="0.4"/>
          <polygon points="40,28 24,22 30,36" fill="#c4cdd9" opacity="0.4"/>
          <polygon points="18,36 24,22 30,36 24,44" fill="#c4cdd9" opacity="0.25"/>
        </svg>
        <div class="footer-brand-text">
          <strong>Alpha Holdings, Inc.</strong>
          <span>&copy; ${year}. Confidential &amp; Proprietary.</span>
        </div>
      </div>
      <div class="footer-center">
        <a href="mailto:joe.liemandt@alpha.school" target="_blank" rel="noopener noreferrer">joe.liemandt@alpha.school</a>
      </div>
      <div class="footer-links">
        <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer">Created with Perplexity Computer</a>
      </div>
    </div>
  </div>
</footer>

<script>
document.addEventListener('DOMContentLoaded', function() {
  // Mobile nav toggle
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function() {
      toggle.classList.toggle('open');
      nav.classList.toggle('open');
    });
    nav.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        toggle.classList.remove('open');
        nav.classList.remove('open');
      });
    });
  }

  // Header scroll shadow
  var header = document.querySelector('.site-header');
  if (header) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 10) header.classList.add('scrolled');
      else header.classList.remove('scrolled');
    }, { passive: true });
  }

  // Scroll reveal
  var fadeEls = document.querySelectorAll('.fade-in');
  if (fadeEls.length > 0 && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });
    fadeEls.forEach(function(el) { observer.observe(el); });
  } else {
    fadeEls.forEach(function(el) { el.classList.add('visible'); });
  }
});
</script>
</body>
</html>`;
}

// ─── Pitch Deck HTML Generator ───────────────────────────────────────────────
// Modelled after the Ed71 Proposal Deck (first 8 slides)
// Slide 8 "Commercial Structure" mirrors the Ed71 per-student cost table exactly.

function generatePitchDeckHtml(ctx: CountryContext, model: FinancialModel): string {
  const programName = ctx.localizedProgramName || ctx.country;
  const lifeSkillsName = ctx.localizedLifeSkillsName || `${ctx.country}Core`;
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

  // ── Cost structure rows from FIXED_ECONOMICS ──
  const costRows = FIXED_ECONOMICS.costStructure
    .map(r => `<tr><td>${r.item}</td><td class="amt">${r.alpha}</td><td class="amt highlight">${r.national}</td><td class="notes">${r.notes}</td></tr>`)
    .join("\n");

  // ── Slide numbering helper ──
  let slideNum = 0;
  const nextSlide = () => String(++slideNum);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${programName} — Proposal Deck</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700;800&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --blue: #0000E5;
    --blue-light: #59BBF9;
    --navy: #0a1628;
    --navy-mid: #111d30;
    --gold: #BF9A4A;
    --cream: #fdf8f0;
    --white: #ffffff;
    --font-display: 'Montserrat', -apple-system, sans-serif;
    --font-body: 'Inter', -apple-system, sans-serif;
  }

  @page { size: 16in 9in; margin: 0; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .slide { page-break-after: always; break-after: page; }
    .slide:last-child { page-break-after: avoid; }
  }

  body {
    font-family: var(--font-body);
    color: #1a1a2e;
    background: #f0f2f8;
    -webkit-font-smoothing: antialiased;
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
  .slide-footer .brand {
    font-family: var(--font-display); font-weight: 700;
    color: var(--blue); font-size: 11px; letter-spacing: 0.08em;
  }
  .slide-footer .copy { font-size: 9px; color: #a0aec0; }
  .slide-num { font-variant-numeric: tabular-nums; font-size: 10px; }

  /* ── Cover slide ── */
  .slide-cover {
    background: linear-gradient(135deg, var(--navy) 0%, var(--navy-mid) 40%, var(--blue) 100%);
    color: #fff; justify-content: center; align-items: center; text-align: center; padding: 60px;
  }
  .slide-cover .flag { font-size: 64px; margin-bottom: 24px; }
  .slide-cover h1 {
    font-family: var(--font-display); font-size: 48px; font-weight: 800;
    letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 12px;
  }
  .slide-cover h1 span { color: var(--blue-light); }
  .slide-cover .tagline { font-size: 20px; font-weight: 300; color: #94b8ff; max-width: 700px; }
  .slide-cover .meta { position: absolute; bottom: 48px; font-size: 12px; color: #6b8cc7; }
  .slide-cover .cover-stats {
    display: flex; justify-content: center; gap: 48px;
    margin-top: 32px; padding-top: 24px;
    border-top: 1px solid rgba(255,255,255,0.12);
  }
  .cover-stat { text-align: center; }
  .cover-stat .cv { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--gold); }
  .cover-stat .cl { font-size: 10px; color: rgba(255,255,255,0.5); letter-spacing: 0.06em; text-transform: uppercase; margin-top: 2px; }

  /* ── Content slides ── */
  .slide-content { padding: 48px; }
  .slide-content .label {
    font-family: var(--font-display);
    font-size: 11px; font-weight: 700; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--blue); margin-bottom: 8px;
  }
  .slide-content h2 {
    font-family: var(--font-display);
    font-size: 32px; font-weight: 800; color: var(--navy);
    letter-spacing: -0.02em; line-height: 1.15; margin-bottom: 24px;
  }
  .slide-content h2 span { color: var(--blue); }

  /* ── Proof points slide (blue bg) ── */
  .slide-proof {
    background: var(--blue); color: var(--white);
    padding: 48px; display: flex; flex-direction: column;
  }
  .slide-proof .label {
    font-family: var(--font-display);
    font-size: 11px; font-weight: 700; letter-spacing: 0.14em;
    text-transform: uppercase; color: rgba(255,255,255,0.6); margin-bottom: 8px;
  }
  .slide-proof h2 {
    font-family: var(--font-display);
    font-size: 30px; font-weight: 800; color: var(--white);
    letter-spacing: -0.02em; line-height: 1.2; margin-bottom: 32px;
  }
  .slide-proof h2 span { color: var(--blue-light); }
  .proof-grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;
    margin-bottom: 24px;
  }
  .proof-card {
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 10px; padding: 24px; text-align: center;
  }
  .proof-card .pv {
    font-family: var(--font-display); font-size: 42px; font-weight: 800;
    color: var(--white); line-height: 1; margin-bottom: 6px;
  }
  .proof-card .pl { font-size: 12px; color: rgba(255,255,255,0.7); line-height: 1.4; }
  .proof-divider {
    border: none; border-top: 1px solid rgba(255,255,255,0.2);
    margin: 8px 0 16px;
  }
  .proof-note {
    font-size: 14px; color: rgba(255,255,255,0.8); line-height: 1.6;
    text-align: center; font-style: italic;
  }

  /* ── Opportunity slide (cream) ── */
  .slide-cream { background: var(--cream); }

  /* ── Two-column grid ── */
  .two-pane { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; flex: 1; }
  .pane { display: flex; flex-direction: column; }
  .pane-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .pane-icon {
    width: 44px; height: 44px; border-radius: 50%; background: #e8eeff;
    display: flex; align-items: center; justify-content: center; font-size: 20px;
  }
  .pane-title {
    font-family: var(--font-display);
    font-size: 16px; font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--navy);
  }
  .stack-item { font-size: 13px; padding: 8px 0; border-bottom: 1px solid #e8ecf4; color: #2d3748; line-height: 1.5; }
  .stack-item strong { color: var(--navy); }

  .scale-row { display: flex; justify-content: space-between; margin-top: 16px; gap: 12px; }
  .scale-box { flex: 1; text-align: center; }
  .scale-box .period { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #718096; margin-bottom: 4px; }
  .scale-box .figure { font-size: 14px; font-weight: 700; color: var(--navy); }
  .scale-arrow { display: flex; align-items: center; color: var(--blue); font-size: 12px; }

  /* ── Bullet lists ── */
  .bullet-list { list-style: none; padding: 0; }
  .bullet-list li {
    position: relative; padding: 8px 0 8px 20px; font-size: 14px;
    color: #2d3748; line-height: 1.5; border-bottom: 1px solid #edf2f7;
  }
  .bullet-list li::before {
    content: ""; position: absolute; left: 0; top: 14px;
    width: 8px; height: 8px; border-radius: 50%; background: var(--blue);
  }

  /* ── Key facts row ── */
  .facts-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  .fact-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
  .fact-card .fact-value {
    font-family: var(--font-display); font-size: 20px; font-weight: 800;
    color: var(--navy); margin-bottom: 4px; line-height: 1.2;
  }
  .fact-card .fact-label {
    font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.08em; color: #718096;
  }

  /* ── Results badges ── */
  .results-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 16px; }
  .result-badge { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; text-align: center; }
  .result-badge .result-value {
    font-family: var(--font-display); font-size: 32px; font-weight: 800;
    color: var(--blue); line-height: 1; margin-bottom: 6px;
  }
  .result-badge .result-label { font-size: 11px; color: #4a5568; line-height: 1.4; }

  /* ── Callout boxes ── */
  .callout-box {
    background: #f0f4ff; border-left: 4px solid var(--blue);
    padding: 16px 20px; border-radius: 0 8px 8px 0; margin-top: 16px;
  }
  .callout-box p { font-size: 13px; line-height: 1.6; color: #2d3748; }

  /* ── Tables ── */
  .deck-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .deck-table th {
    text-align: left; font-family: var(--font-display);
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #4a5568; padding: 8px 12px;
    border-bottom: 2px solid #e2e8f0; background: #f7fafc;
  }
  .deck-table th.primary-col { background: var(--blue); color: var(--white); }
  .deck-table td { padding: 7px 12px; border-bottom: 1px solid #edf2f7; vertical-align: top; }
  .deck-table td.amt { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .deck-table td.highlight { background: linear-gradient(135deg, rgba(0,0,229,0.04), rgba(0,0,229,0.08)); color: var(--blue); font-weight: 700; }
  .deck-table td.notes { font-size: 10px; color: #718096; }
  .deck-table .section-header td {
    font-family: var(--font-display); font-weight: 700; font-size: 10px;
    letter-spacing: 0.08em; text-transform: uppercase; color: #718096;
    padding-top: 14px; border-bottom: none;
  }
  .deck-table .total-row td { font-weight: 700; border-top: 2px solid var(--navy); border-bottom: 2px solid var(--navy); background: #f7fafc; }

  /* ── Day comparison ── */
  .day-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 16px; }
  .day-col { border-radius: 10px; padding: 20px; }
  .day-col.traditional { background: #fef2f2; border: 1px solid #fecaca; }
  .day-col.alpha { background: #f0f4ff; border: 1px solid #c7d2fe; }
  .day-col h4 { font-family: var(--font-display); font-size: 14px; font-weight: 700; margin-bottom: 10px; }
  .day-col .day-item { font-size: 12px; padding: 4px 0; color: #4a5568; }
  .day-col .day-item strong { color: var(--navy); }

  /* ── Partnership cards ── */
  .partner-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 16px; }
  .partner-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; }
  .partner-card .partner-label {
    font-family: var(--font-display); font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.1em; color: var(--blue); margin-bottom: 8px;
  }
  .partner-card .partner-value { font-size: 14px; font-weight: 600; color: var(--navy); line-height: 1.4; }
  .partner-card .partner-detail { font-size: 11px; color: #718096; margin-top: 4px; line-height: 1.4; }

  /* ── Commercial Structure slide (Ed71-style) ── */
  .comm-panel { border: 2px solid var(--blue); border-radius: 4px; overflow: hidden; }
  .comm-header { background: var(--blue); color: #fff; text-align: center; font-family: var(--font-display); font-size: 16px; font-weight: 700; padding: 8px 16px; }
  .comm-sub-header { background: #4a5568; color: #fff; text-align: center; font-size: 13px; font-weight: 700; padding: 5px 16px; }
  .comm-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .comm-table th { text-align: left; font-size: 10px; font-weight: 700; padding: 5px 10px; border-bottom: 1px solid #e2e8f0; color: #4a5568; }
  .comm-table td { padding: 5px 10px; border-bottom: 1px solid #edf2f7; }
  .comm-table td.amt { font-weight: 700; text-align: center; white-space: nowrap; }
  .comm-table .total-row td { font-weight: 700; border-top: 2px solid var(--navy); background: #f7fafc; }
  .comm-footnote { font-size: 9px; color: #718096; padding: 4px 10px; font-style: italic; }

  /* ── Investment Structure panel ── */
  .invest-panel { border: 2px solid var(--blue); border-radius: 4px; overflow: hidden; }
  .invest-row {
    display: grid; grid-template-columns: 1fr auto;
    padding: 5px 12px; border-bottom: 1px solid #edf2f7; font-size: 11px;
  }
  .invest-item { color: #2d3748; font-weight: 500; }
  .invest-amt { font-weight: 700; color: var(--navy); text-align: right; }
  .invest-detail { grid-column: 1 / -1; font-size: 10px; color: #718096; margin-top: 1px; }
  .invest-total {
    display: flex; justify-content: space-between;
    padding: 6px 12px; font-weight: 700; font-size: 13px;
    background: #f7fafc; border-top: 2px solid var(--navy);
  }

  /* ── Opportunity slide metrics ── */
  .opp-metrics {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  }
  .opp-metric {
    background: var(--white); border: 1px solid rgba(10,22,40,0.08);
    border-radius: 8px; padding: 14px 16px; text-align: center;
  }
  .opp-metric .om-value {
    font-family: var(--font-display); font-size: 18px; font-weight: 800;
    color: var(--blue); margin-bottom: 2px; line-height: 1.2;
  }
  .opp-metric .om-label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #718096; }

  /* ── Opportunity bullet list ── */
  .opp-bullet {
    display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px;
  }
  .opp-bullet .ob-dot {
    flex-shrink: 0; width: 8px; height: 8px; border-radius: 50%;
    background: var(--blue); margin-top: 5px;
  }
  .opp-bullet .ob-text { font-size: 14px; color: #2d3748; line-height: 1.55; }
  .opp-bullet .ob-text strong { color: var(--navy); }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 1 — COVER (Fix #3: country stats at bottom)
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-cover">
  <div class="flag">${ctx.flagEmoji}</div>
  <h1>${programName}<br><span>The World's First AI-Native<br>National Education System</span></h1>
  <div class="tagline">${ctx.formalName}</div>
  <div class="cover-stats">
    <div class="cover-stat">
      <div class="cv">${ctx.population}</div>
      <div class="cl">Population</div>
    </div>
    <div class="cover-stat">
      <div class="cv">${ctx.schoolAgePopulation}</div>
      <div class="cl">School-Age Children</div>
    </div>
    ${ctx.addressableStudentPopulation ? `<div class="cover-stat">
      <div class="cv">${ctx.addressableStudentPopulation}</div>
      <div class="cl">Addressable Market</div>
    </div>` : ''}
  </div>
  <div class="meta">Confidential &amp; Proprietary · ${dateStr} · Alpha Holdings, Inc.</div>
  <div class="slide-footer" style="color: rgba(255,255,255,0.3);">
    <span class="brand" style="color: rgba(255,255,255,0.5);">ALPHA HOLDINGS, INC.</span>
    <span class="copy" style="color: rgba(255,255,255,0.3);">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num" style="color: rgba(255,255,255,0.3);">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 2 — THE [COUNTRY] OPPORTUNITY (NEW — Fix #2)
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content slide-cream">
  <div class="label">The Opportunity</div>
  <h2>Why ${ctx.country} — <span>Why Now</span></h2>

  <div style="display:grid; grid-template-columns:1.5fr 1fr; gap:40px; margin-top:8px; align-items:start;">
    <div>
      <p style="font-size:14px; color:#2d3748; line-height:1.65; margin-bottom:20px;">${ctx.culturalNarrative}</p>

      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:var(--blue); margin-bottom:14px;">Key Strengths for Partnership</div>
      ${(ctx.keyStrengths || []).map(s => `
      <div class="opp-bullet">
        <div class="ob-dot"></div>
        <div class="ob-text">${s}</div>
      </div>`).join('')}

      <div style="margin-top:16px; background:rgba(0,0,229,0.04); border-left:4px solid var(--blue); padding:12px 16px; border-radius:0 8px 8px 0;">
        <p style="font-size:13px; color:var(--navy); line-height:1.6; margin:0;"><strong>National Education Vision:</strong> ${ctx.nationalEdVision}</p>
      </div>
    </div>

    <div>
      <div class="opp-metrics">
        <div class="opp-metric">
          <div class="om-value">${ctx.population}</div>
          <div class="om-label">Population</div>
        </div>
        <div class="opp-metric">
          <div class="om-value">${ctx.schoolAgePopulation}</div>
          <div class="om-label">School-Age</div>
        </div>
        <div class="opp-metric">
          <div class="om-value">${ctx.gdpPerCapita}</div>
          <div class="om-label">GDP per Capita</div>
        </div>
        ${ctx.addressableStudentPopulation ? `<div class="opp-metric">
          <div class="om-value">${ctx.addressableStudentPopulation}</div>
          <div class="om-label">Addressable Market</div>
        </div>` : ''}
      </div>
      <div style="margin-top:16px; text-align:center; padding:14px; background:var(--white); border:1px solid rgba(10,22,40,0.08); border-radius:8px;">
        <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--gold); margin-bottom:4px;">${ctx.headOfStateTitle}</div>
        <div style="font-family:var(--font-display); font-size:15px; font-weight:700; color:var(--navy);">${ctx.headOfState}</div>
      </div>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA HOLDINGS, INC.</span>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 3 — VISION (Fix #1: richer, less whitespace)
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">Vision</div>
  <h2>'Educated in ${ctx.country}' <span>as a Global Credential</span></h2>

  <div style="display:grid; grid-template-columns:1fr 1.2fr; gap:36px; align-items:start;">
    <div>
      <div style="text-align:center; padding:12px 0 16px;">
        <div style="font-size:48px; margin-bottom:8px;">${ctx.flagEmoji}</div>
        <div style="font-family:var(--font-display); font-size:22px; font-weight:800; color:var(--blue); letter-spacing:0.02em;">ALPHA HOLDINGS, INC.</div>
        <div style="font-size:12px; font-weight:600; color:#4a5568; margin-top:6px;">The "Stanford of K-12 Education"</div>
      </div>
      <div style="background:var(--cream); border-radius:8px; padding:14px 16px; margin-top:12px;">
        <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--gold); margin-bottom:6px;">National Education Vision</div>
        <p style="font-size:12px; color:#2d3748; line-height:1.55; margin:0;">${ctx.nationalEdVision}</p>
      </div>
    </div>
    <div>
      <ul style="list-style:none; padding:0; margin:0;">
        <li style="display:flex; align-items:flex-start; gap:12px; margin-bottom:16px;">
          <span style="flex-shrink:0; width:28px; height:28px; background:#f0f4ff; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:var(--font-display); font-size:14px; color:var(--blue); font-weight:700;">1</span>
          <span style="font-size:14px; color:#2d3748; line-height:1.6;">Only <strong style="color:var(--blue);">AI-native education system</strong>, purposefully designed for national scale — merging cutting-edge technology with proven learning science.</span>
        </li>
        <li style="display:flex; align-items:flex-start; gap:12px; margin-bottom:16px;">
          <span style="flex-shrink:0; width:28px; height:28px; background:#f0f4ff; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:var(--font-display); font-size:14px; color:var(--blue); font-weight:700;">2</span>
          <span style="font-size:14px; color:#2d3748; line-height:1.6;">Students <strong style="color:var(--blue);">master academics in 2 hours/day</strong>, freeing the remaining time for life skills, creativity, and real-world application — learning 2× faster.</span>
        </li>
        <li style="display:flex; align-items:flex-start; gap:12px; margin-bottom:16px;">
          <span style="flex-shrink:0; width:28px; height:28px; background:#f0f4ff; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:var(--font-display); font-size:14px; color:var(--blue); font-weight:700;">3</span>
          <span style="font-size:14px; color:#2d3748; line-height:1.6;">Creating the next generation of <strong style="color:var(--blue);">global leaders</strong> through ${lifeSkillsName} — the life-skills engine for the AI age.</span>
        </li>
      </ul>

      <div style="background:#f0f4ff; border-radius:8px; padding:14px 18px; margin-top:8px;">
        <p style="font-size:13px; color:var(--navy); line-height:1.6; margin:0;">
          <strong>Our mission:</strong> <strong>${programName}</strong> is a ${ctx.country}-owned national education platform, with Alpha as exclusive operating partner. Together we design <strong style="color:var(--blue);">${lifeSkillsName}</strong> — ${ctx.country}'s life-skills engine.
        </p>
      </div>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA HOLDINGS, INC.</span>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 4 — THE KEY TO SUCCESS
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">The Key to Success</div>
  <h2>We have reinvented <span>the school day</span></h2>

  <div style="display:grid; grid-template-columns:1fr 1.5fr; gap:36px; margin-top:16px; align-items:start;">
    <div>
      <div style="display:inline-block; background:var(--blue); color:#fff; font-family:var(--font-display); font-size:11px; font-weight:700; padding:6px 14px; border-radius:20px; margin-bottom:20px;">Core truths of transformation</div>
      <div style="display:flex; align-items:flex-start; gap:12px; margin-bottom:18px;">
        <span style="flex-shrink:0; color:var(--blue); font-size:18px; margin-top:1px;">✓</span>
        <span style="font-size:14px; color:#2d3748; line-height:1.5;">Children should <strong style="color:var(--blue);">love school</strong> more than vacation</span>
      </div>
      <div style="display:flex; align-items:flex-start; gap:12px; margin-bottom:18px;">
        <span style="flex-shrink:0; color:var(--blue); font-size:18px; margin-top:1px;">✓</span>
        <span style="font-size:14px; color:#2d3748; line-height:1.5;">Children can <strong style="color:var(--blue);">master academics</strong> in 2 hours per day</span>
      </div>
      <div style="display:flex; align-items:flex-start; gap:12px; margin-bottom:18px;">
        <span style="flex-shrink:0; color:var(--blue); font-size:18px; margin-top:1px;">✓</span>
        <span style="font-size:14px; color:#2d3748; line-height:1.5;">The key to your children's happiness is <strong style="color:var(--blue);">high standards</strong></span>
      </div>
    </div>
    <div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px;">
        <div style="text-align:center;">
          <div style="font-family:var(--font-display); font-size:14px; font-weight:700; color:#4a5568; margin-bottom:12px;">Traditional</div>
          <div style="width:100px; height:100px; border-radius:50%; border:4px solid #a0aec0; margin:0 auto 10px; display:flex; align-items:center; justify-content:center; background:#f7fafc;">
            <span style="font-family:var(--font-display); font-size:22px; font-weight:800; color:#4a5568;">6 hrs</span>
          </div>
          <div style="font-size:12px; color:#4a5568; line-height:1.4;">6 hours of<br><strong>classroom instruction</strong></div>
        </div>
        <div style="text-align:center;">
          <div style="font-family:var(--font-display); font-size:14px; font-weight:700; color:var(--blue); margin-bottom:12px;">Alpha Model</div>
          <div style="display:flex; gap:8px; justify-content:center; margin-bottom:10px;">
            <div style="width:60px; height:60px; border-radius:50%; border:4px solid var(--blue); display:flex; align-items:center; justify-content:center; background:#f0f4ff;">
              <span style="font-family:var(--font-display); font-size:14px; font-weight:800; color:var(--blue);">2 hrs</span>
            </div>
            <div style="font-family:var(--font-display); font-size:18px; font-weight:700; color:var(--blue); align-self:center;">+</div>
            <div style="width:60px; height:60px; border-radius:50%; border:4px solid var(--blue); display:flex; align-items:center; justify-content:center; background:#f0f4ff;">
              <span style="font-family:var(--font-display); font-size:14px; font-weight:800; color:var(--blue);">4 hrs</span>
            </div>
          </div>
          <div style="font-size:12px; color:#2d3748; line-height:1.4;"><strong style="color:var(--blue);">2 hours</strong> academic mastery<br><strong style="color:var(--blue);">4 hours</strong> life-skills development</div>
        </div>
      </div>
      <div style="border-top:1px solid #e2e8f0; padding-top:14px;">
        <p style="font-size:12px; color:#2d3748; line-height:1.5; margin:0 0 8px;">
          <strong style="color:var(--navy);">Timeback:</strong> the AI and learning science platform delivering academic mastery 10× faster than traditional schooling
        </p>
        <p style="font-size:12px; color:#2d3748; line-height:1.5; margin:0;">
          <strong style="color:var(--navy);">AlphaCore:</strong> an AI-age life-skills curriculum developing student leadership, teamwork, communication, resilience, and other non-academic capabilities
        </p>
      </div>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA HOLDINGS, INC.</span>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 5 — THE 2HR LEARNING MODEL
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">The Alpha Model</div>
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
      <h4 style="color: var(--blue);">Alpha School Day</h4>
      <div class="day-item"><strong>2 hours</strong> AI-powered academic mastery</div>
      <div class="day-item"><strong>4 hours</strong> life skills, STEM, sports, arts</div>
      <div class="day-item">Personalized AI tutor for every student</div>
      <div class="day-item">Results: 2–5× faster learning, 97% love school</div>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA HOLDINGS, INC.</span>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 6 — PROOF POINTS (NEW — Fix #2: Blue slide with big metrics)
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-proof">
  <div class="label">Proof Points</div>
  <h2>We have proven that we have the <span>best K-12 product</span> on the planet.</h2>

  <div class="proof-grid">
    <div class="proof-card">
      <div class="pv">1470</div>
      <div class="pl">Average SAT Score<br><span style="opacity:0.5;">(vs. 1028 national avg.)</span></div>
    </div>
    <div class="proof-card">
      <div class="pv">Top 1%</div>
      <div class="pl">Performance on NWEA<br>MAP standardized tests</div>
    </div>
    <div class="proof-card">
      <div class="pv">90%</div>
      <div class="pl">Of HS students score<br>4 or 5 on AP exams</div>
    </div>
    <div class="proof-card">
      <div class="pv">6.5×</div>
      <div class="pl">Growth among the<br>top 20% of students</div>
    </div>
  </div>

  <hr class="proof-divider">
  <p class="proof-note">The learning science has been proven for 40 years. Alpha has made it work at scale.</p>

  <div class="slide-footer" style="color: rgba(255,255,255,0.3);">
    <span class="brand" style="color: rgba(255,255,255,0.5);">ALPHA HOLDINGS, INC.</span>
    <span class="copy" style="color: rgba(255,255,255,0.3);">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num" style="color: rgba(255,255,255,0.3);">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 7 — OUR RESULTS (detailed)
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">Our Results</div>
  <h2>The learning science has been known for 40 years… <span>we have made it work</span></h2>

  <div style="display:grid; grid-template-columns:1.2fr 1fr; gap:32px; margin-top:12px;">
    <div>
      <div style="margin-bottom:16px;">
        <div style="font-family:var(--font-display); font-size:12px; font-weight:700; color:#4a5568; margin-bottom:8px;">Bloom's 2-Sigma Problem (1984)</div>
        <div style="background:#f7fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px;">
          <p style="font-size:11px; color:#4a5568; line-height:1.5; margin:0;">1:1 tutoring produces <strong style="color:var(--blue);">2 standard deviations</strong> of improvement — moving an average student to the 98th percentile. AI makes this possible at national scale for the first time.</p>
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-family:var(--font-display); font-size:12px; font-weight:700; color:#4a5568; margin-bottom:8px;">Exceptional Growth (vs. 1× "expected")</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div style="background:#f0f4ff; border-radius:6px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11px; color:#4a5568;">Avg all students growth</span>
            <span style="font-family:var(--font-display); font-size:16px; font-weight:800; color:var(--blue);">2.2×</span>
          </div>
          <div style="background:#f0f4ff; border-radius:6px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11px; color:#4a5568;">Top 20% growth</span>
            <span style="font-family:var(--font-display); font-size:16px; font-weight:800; color:var(--blue);">3.9×</span>
          </div>
          <div style="background:#f0f4ff; border-radius:6px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11px; color:#4a5568;">Top ⅓ growth</span>
            <span style="font-family:var(--font-display); font-size:16px; font-weight:800; color:var(--blue);">2.6×</span>
          </div>
          <div style="background:#f0f4ff; border-radius:6px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11px; color:#4a5568;">2 years behind growth</span>
            <span style="font-family:var(--font-display); font-size:16px; font-weight:800; color:var(--blue);">4.9×</span>
          </div>
        </div>
      </div>
      <div>
        <div style="font-family:var(--font-display); font-size:12px; font-weight:700; color:#4a5568; margin-bottom:8px;">World-Class College Admissions</div>
        <div style="display:flex; gap:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; flex:1; text-align:center;">
            <div style="font-size:11px; color:#718096;">Avg. SAT</div>
            <div style="font-family:var(--font-display); font-size:20px; font-weight:800; color:var(--navy);">1530</div>
            <div style="font-size:9px; color:#a0aec0;">vs. 1063 national</div>
          </div>
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; flex:1; text-align:center;">
            <div style="font-size:11px; color:#718096;">AP Scores</div>
            <div style="font-family:var(--font-display); font-size:20px; font-weight:800; color:var(--navy);">94%</div>
            <div style="font-size:9px; color:#a0aec0;">students with 4 or 5</div>
          </div>
        </div>
      </div>
    </div>
    <div>
      <div style="margin-bottom:16px;">
        <div style="font-family:var(--font-display); font-size:28px; font-weight:800; color:var(--blue); margin-bottom:6px;">97% <span style="font-size:18px; color:var(--navy);">love school</span></div>
        <ul style="list-style:none; padding:0; margin:0;">
          <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:6px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#4a5568; line-height:1.4;">High School students voted to keep school open over summer</span></li>
          <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:6px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#4a5568; line-height:1.4;">Over 60% of students would rather go to school than go on vacation</span></li>
          <li style="display:flex; align-items:flex-start; gap:8px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#4a5568; line-height:1.4;">80% of older students say their Guide is one of the most influential people in their life</span></li>
        </ul>
      </div>
      <div>
        <div style="font-family:var(--font-display); font-size:28px; font-weight:800; color:var(--blue); margin-bottom:6px;">100+ <span style="font-size:18px; color:var(--navy);">life skills projects</span></div>
        <ul style="list-style:none; padding:0; margin:0;">
          <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:5px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#4a5568; line-height:1.4;">All <strong>Third Graders</strong> can solve the Rubik's cube</span></li>
          <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:5px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#4a5568; line-height:1.4;"><strong>Fifth Graders</strong> presented TED-style talks at NYC open mic nights</span></li>
          <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:5px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#4a5568; line-height:1.4;"><strong>Middle Schoolers</strong> placed 2nd in the world and 1st in the U.S. in the Global AI Debates</span></li>
          <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:5px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#4a5568; line-height:1.4;"><strong>High Schoolers</strong> traveled to Ukraine on a humanitarian mission</span></li>
          <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:5px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#4a5568; line-height:1.4;"><strong>Maddie</strong> created the first teen-produced Broadway musical</span></li>
          <li style="display:flex; align-items:flex-start; gap:8px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#4a5568; line-height:1.4;"><strong>Grace</strong> produced a documentary on cancer with 5M views, testified at U.S. Senate</span></li>
        </ul>
      </div>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA HOLDINGS, INC.</span>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 8 — THE COMPLETE PLATFORM
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">The Complete Platform</div>
  <h2>Launching <span>${programName}</span> on Alpha's full education stack</h2>

  <p style="font-size:13px; color:#2d3748; line-height:1.6; margin:0 0 16px 0;"><strong>${programName}</strong> licenses Alpha's complete infrastructure and adapts it with <strong style="color:var(--blue);">${lifeSkillsName}</strong>, the ${ctx.country}-specific life-skills program — ${ctx.country}'s equivalent to AlphaCore.</p>

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
      <div class="stack-item"><strong>Incept eduLLM:</strong> Personalized content generation engine</div>
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
      <div class="stack-item"><strong>Localized AI Apps:</strong> ${ctx.languageApps}</div>
      <div class="stack-item"><strong>${lifeSkillsName}:</strong> ${ctx.localLifeSkillsFocus}</div>
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
    <span class="brand">ALPHA HOLDINGS, INC.</span>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 9 — DEPLOYMENT & INVESTMENT OVERVIEW
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">Deployment Plan</div>
  <h2>Launching ${ctx.country}'s ${programName} on <span>Alpha's full education stack</span></h2>

  <div class="two-pane" style="margin-top:12px;">
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
      <div class="stack-item"><strong>Incept eduLLM:</strong> Personalized content generation engine</div>
      <div class="scale-row">
        <div class="scale-box"><div class="period">This Year</div><div class="figure">2,500 students · 22 campuses</div></div>
        <div class="scale-arrow">→</div>
        <div class="scale-box"><div class="period">3-Year Target</div><div class="figure">100k students · 100 campuses</div></div>
      </div>
    </div>

    <div class="pane">
      <div class="pane-header">
        <div class="pane-icon">${ctx.flagEmoji}</div>
        <div class="pane-title">${programName}: ${ctx.country} Owned</div>
      </div>
      <div class="stack-item"><strong>Education Sovereignty:</strong> ${ctx.country} owns the critical pieces</div>
      <div class="stack-item"><strong>Infrastructure:</strong> Built to scale across 100+ schools</div>
      <div class="stack-item"><strong>Localized AI Apps:</strong> ${ctx.languageApps}</div>
      <div class="stack-item"><strong>${lifeSkillsName}:</strong> ${ctx.localLifeSkillsFocus}</div>
      <div class="stack-item"><strong>Talent Academy:</strong> Recruit and train ${programName} Guides</div>
      <div class="stack-item"><strong>National eduLLM:</strong> Embedded local laws, values, and culture</div>
      <div class="scale-row">
        <div class="scale-box"><div class="period">Next Year</div><div class="figure">${fmtNum(Math.round(model.counterparty.minStudentsPerYear / 50))} students · 2 communities</div></div>
        <div class="scale-arrow">→</div>
        <div class="scale-box"><div class="period">5-Year Target</div><div class="figure">${fmtNum(model.counterparty.minStudentsPerYear)}+ students · 50+ communities</div></div>
      </div>

      <div style="margin-top:14px; background:#f0f4ff; border-radius:6px; padding:12px 14px;">
        <ul style="list-style:none; padding:0; margin:0; font-size:11px; color:#2d3748; line-height:1.6;">
          <li style="margin-bottom:4px;">• <strong>${fmtUsd(model.counterparty.perStudentBudget)}</strong> per student annual budget — ~2× current public funding</li>
          <li style="margin-bottom:4px;">• <strong>${fmtCompact(model.upfront.totalUsd)}</strong> up-front spend</li>
          <li style="margin-bottom:4px;">• ${ctx.country} asset and infrastructure development</li>
          <li style="margin-bottom:4px;">• Prepaid fees to Alpha (for first ${fmtNum(model.counterparty.minStudentsPerYear)} student-years)</li>
          <li>• <strong>First schools open ${(() => { const n = new Date(); const readyBy = new Date(n.getFullYear(), n.getMonth() + 16, 1); let ly = readyBy.getFullYear(); if (readyBy.getMonth() > 8) ly++; return `SY${String(ly).slice(-2)}-${String(ly + 1).slice(-2)}`; })()}</strong> — start with Alpha Flagship school</li>
        </ul>
      </div>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA HOLDINGS, INC.</span>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 10 — PARTNERSHIP MODEL
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
      <div class="partner-label">Alpha Flagship Schools</div>
      <div class="partner-value">${model.flagship.totalSchoolCount} School${model.flagship.totalSchoolCount !== 1 ? 's' : ''} · ${(() => { const t = Array.from(new Set(model.flagship.schools.map(s => s.tuitionPerYear))); return t.length === 1 ? fmtUsd(t[0]) : `${fmtUsd(Math.min(...t))} – ${fmtUsd(Math.max(...t))}`; })()}/yr</div>
      <div class="partner-detail">${model.flagship.schools.map(s => `${s.metro} (${s.count} @ ${fmtUsd(s.tuitionPerYear)})`).join(', ')}. ${(() => { const backstopTotal = model.flagship.schools.reduce((sum, s) => sum + s.count * s.capacityPerSchool * s.tuitionPerYear * 0.50 * 5, 0); return `50% capacity backstop for 5 years (${fmtCompact(backstopTotal)}).`; })()}${model.flagship.scholarshipNote ? ' ' + model.flagship.scholarshipNote : ''}</div>
    </div>
    <div class="partner-card">
      <div class="partner-label">${programName} Schools</div>
      <div class="partner-value">${fmtNum(model.counterparty.minStudentsPerYear)} Student-Years Min</div>
      <div class="partner-detail">Fixed $${model.counterparty.perStudentBudget.toLocaleString("en-US")} per-student annual budget. Powered by <strong>${lifeSkillsName}</strong> life-skills program. ${ctx.country} funds 100% of local entity operations.</div>
    </div>
  </div>

  <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:16px;">
    <div>
      <div style="font-family:var(--font-display); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:var(--blue); margin-bottom:10px;">Why Alpha Flagship Schools Are Essential</div>
      <ul style="list-style:none; padding:0; margin:0;">
        <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:8px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#2d3748; line-height:1.4;"><strong>Marketing &amp; Validation Engine:</strong> Establishes an unassailable benchmark for excellence that legitimizes the brand's entire presence in ${ctx.country}.</span></li>
        <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:8px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#2d3748; line-height:1.4;"><strong>Premium Positioning:</strong> Creates a brand halo that justifies premium pricing across the entire portfolio, including ${programName} schools.</span></li>
        <li style="display:flex; align-items:flex-start; gap:8px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#2d3748; line-height:1.4;"><strong>Strategic Anchor:</strong> Provides the proof of concept required for national-scale education transformation.</span></li>
      </ul>
    </div>
    <div>
      <div style="font-family:var(--font-display); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:var(--blue); margin-bottom:10px;">What Alpha Holdings, Inc. Retains (IP)</div>
      <ul style="list-style:none; padding:0; margin:0;">
        <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:8px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#2d3748; line-height:1.4;"><strong>Timeback®</strong> — AI learning platform (licensed)</span></li>
        <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:8px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#2d3748; line-height:1.4;"><strong>AlphaCore™</strong> — Life-skills curriculum (licensed)</span></li>
        <li style="display:flex; align-items:flex-start; gap:8px; margin-bottom:8px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#2d3748; line-height:1.4;"><strong>Guide School</strong> — Teacher training IP (licensed)</span></li>
        <li style="display:flex; align-items:flex-start; gap:8px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:6px;"></span><span style="font-size:11px; color:#2d3748; line-height:1.4;"><strong>Incept eduLLM</strong> — Content engine (licensed)</span></li>
      </ul>
    </div>
  </div>

  <div class="callout-box" style="margin-top: 10px;">
    <p><strong>Education Sovereignty:</strong> ${ctx.country} owns 100% of the national identity, cultural values, local curriculum, and all locally developed content. Alpha provides the engine; ${ctx.country} owns the car.</p>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA HOLDINGS, INC.</span>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 11 — FUTURE OPPORTUNITIES & SEQUENCING
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">Roadmap</div>
  <h2>Future Regional Opportunities &amp; <span>Sequencing Plan</span></h2>

  <div style="display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-top:24px;">
    <div>
      <div style="font-family:var(--font-display); font-size:15px; font-weight:700; color:var(--navy); margin-bottom:12px;">Future Regional Opportunities</div>
      <p style="font-size:13px; color:#2d3748; line-height:1.6;">Regional expansion to neighboring countries and territories represents a significant follow-on opportunity. These can be structured as separate arrangements and are not required for <strong>${programName}</strong> to succeed.</p>
    </div>
    <div>
      <div style="font-family:var(--font-display); font-size:15px; font-weight:700; color:var(--navy); margin-bottom:12px;">High-level Sequencing Plan</div>
      <ul style="list-style:none; padding:0; margin:0;">
        ${(() => {
          const n = new Date();
          const readyBy = new Date(n.getFullYear(), n.getMonth() + 16, 1);
          let ly = readyBy.getFullYear();
          if (readyBy.getMonth() > 8) ly++;
          const p1 = `SY${String(ly).slice(-2)}-${String(ly + 1).slice(-2)}`;
          const p2 = `SY${String(ly + 1).slice(-2)}-${String(ly + 2).slice(-2)}`;
          return [
            { bold: `Phase 0 (Now – Summer ${ly})`, rest: `IP Transfer, ${lifeSkillsName} design, and eduLLM model training.` },
            { bold: `Phase 1 (${p1})`, rest: `Launch of Alpha Flagship school.` },
            { bold: `Phase 2 (${p2})`, rest: `National rollout of the ${programName} school network.` },
          ].map(p => `<li style="display:flex; align-items:flex-start; gap:10px; margin-bottom:12px;">
            <span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span>
            <span style="font-size:13px; color:#2d3748; line-height:1.5;"><strong>${p.bold}:</strong> ${p.rest}</span>
          </li>`).join('\n        ');
        })()}
      </ul>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA HOLDINGS, INC.</span>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 12 — COUNTRY-OWNED SCHOOLS & INVESTMENT (Fix #3: program name in labels)
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">${programName} Schools</div>
  <h2>${programName}: <span>${ctx.country} Owned, Alpha Operated</span></h2>
  <p style="font-size:12px; font-style:italic; color:#4a5568; margin:4px 0 0 0;">We are proposing to implement through a national network of privately-operated, government-funded schools, but are equally open to other structures.</p>

  <div style="display:grid; grid-template-columns:1fr 1.6fr; gap:28px; margin-top:12px;">
    <div>
      <ul style="list-style:none; padding:0; margin:0;">
        <li style="display:flex; align-items:flex-start; gap:10px; margin-bottom:10px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span><span style="font-size:13px; color:#2d3748; line-height:1.5;">100% ${ctx.country} owned, 0% Alpha owned. Alpha operates on behalf of the Country/State.</span></li>
        <li style="display:flex; align-items:flex-start; gap:10px; margin-bottom:10px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span><span style="font-size:13px; color:#2d3748; line-height:1.5;">Per student funding/tuition: <strong>${fmtUsd(model.counterparty.perStudentBudget)}/year.</strong></span></li>
        <li style="display:flex; align-items:flex-start; gap:10px; margin-bottom:10px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span><span style="font-size:13px; color:#2d3748; line-height:1.5;">Minimum <strong>${fmtNum(model.counterparty.minStudentsPerYear)}</strong> student-years commitment.</span></li>
        <li style="display:flex; align-items:flex-start; gap:10px; margin-bottom:10px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span><span style="font-size:13px; color:#2d3748; line-height:1.5;">Every ${programName} school runs on Alpha's Timeback with <strong>${lifeSkillsName}</strong>.</span></li>
        <li style="display:flex; align-items:flex-start; gap:10px; margin-bottom:10px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span><span style="font-size:13px; color:#2d3748; line-height:1.5;">Schools can be operated as either public or private schools.</span></li>
        <li style="display:flex; align-items:flex-start; gap:10px;"><span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span><span style="font-size:13px; color:#2d3748; line-height:1.5;">${ctx.country} is responsible for sourcing real estate; schools pay rent.</span></li>
      </ul>
    </div>
    <div>
      <div style="font-family:var(--font-display); font-size:15px; font-weight:700; color:var(--navy); margin-bottom:10px;">Investment Required</div>
      <table class="deck-table" style="font-size:11px;">
        <thead>
          <tr>
            <th>Investment Item</th>
            <th style="text-align:right;">Upfront ($M)</th>
            <th style="text-align:right;">Ongoing ($M/yr)</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr class="section-header"><td colspan="4">Upfront Development Costs</td></tr>
          ${model.upfront.fixedItems.map(r => `<tr><td>${r.item}</td><td class="amt" style="text-align:right;">${fmtCompact(r.amountUsd)}</td><td></td><td class="notes">Paid upfront${r.recipient === 'Alpha Holdings, Inc.' ? ' to Alpha Holdings, Inc.' : ''}</td></tr>`).join("\n          ")}
          <tr class="section-header"><td colspan="4">Prepaid Fees</td></tr>
          ${model.upfront.variableItems.map(r => `<tr><td>${r.item}</td><td class="amt" style="text-align:right;">${fmtCompact(r.amountUsd)}</td><td></td><td class="notes">${r.note || r.recipient}</td></tr>`).join("\n          ")}
          <tr class="section-header"><td colspan="4">Ongoing Annual Costs (per ${fmtNum(model.counterparty.minStudentsPerYear)} students)</td></tr>
          ${model.ongoing.items.map(r => `<tr><td>${r.item}</td><td></td><td class="amt" style="text-align:right;">${r.amount}</td><td class="notes">${r.recipient}</td></tr>`).join("\n          ")}
          <tr class="total-row">
            <td>TOTAL UPFRONT</td>
            <td class="amt" style="text-align:right;">${fmtCompact(model.upfront.totalUsd)}</td>
            <td></td>
            <td class="notes"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA HOLDINGS, INC.</span>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 13 — COST STRUCTURE (Fix #3: programName in column header)
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">${programName} Cost Structure</div>
  <h2>Per-Student Economics at <span>$25K Budget</span></h2>

  <div style="margin-top:8px;">
    <table class="deck-table">
      <thead>
        <tr>
          <th>Item (Per Student P&amp;L)</th>
          <th>Alpha @ $50K Tuition</th>
          <th class="primary-col">${programName} @ $25K Budget</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr class="section-header"><td colspan="4">FUNDING</td></tr>
        ${costRows}
      </tbody>
    </table>
  </div>

  <div class="callout-box" style="margin-top:12px;">
    <p>We propose implementation through a national network of privately-operated, government-funded schools — and are equally open to other structures.</p>
  </div>

  <div class="slide-footer">
    <span class="brand">ALPHA HOLDINGS, INC.</span>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 14 — THANK YOU / CLOSING
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-cover" style="background: linear-gradient(135deg, var(--navy) 0%, var(--navy-mid) 40%, var(--blue) 100%);">
  <div>
    <div style="font-family:var(--font-display); font-size:24px; font-weight:600; color:var(--blue-light); margin-bottom:16px; font-style:italic;">Thank You</div>
    <h1 style="font-family:var(--font-display); font-size:44px; font-weight:800; color:var(--white); line-height:1.2; margin:0 0 32px;">${programName}<br><span style="color:var(--blue-light);">Transforming Education<br>in ${ctx.country}</span></h1>
    <div style="display:inline-block; border:2px solid var(--blue-light); border-radius:4px; padding:8px 24px; font-family:var(--font-display); font-size:12px; font-weight:700; color:var(--blue-light); letter-spacing:0.1em;">CONFIDENTIAL</div>
  </div>
  <div class="slide-footer" style="color: rgba(255,255,255,0.3);">
    <span class="brand" style="color: rgba(255,255,255,0.5);">ALPHA HOLDINGS, INC.</span>
    <span class="copy" style="color: rgba(255,255,255,0.3);">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num" style="color: rgba(255,255,255,0.3);">${nextSlide()}</span>
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
      model: "claude-sonnet-4-20250514",
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
      model: "gpt-5.4",
      input: `${RESEARCH_PROMPT}\n\nGenerate the country context profile for: ${target}`,
    });
    text = typeof response.output_text === "string" ? response.output_text : "";
  }

  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const ctx: CountryContext = JSON.parse(cleaned);

  // Guardrail: country-owned school program name must not contain "Alpha"
  if (ctx.localizedProgramName && /\balpha\b/i.test(ctx.localizedProgramName)) {
    ctx.localizedProgramName = ctx.localizedProgramName.replace(/\s*\bAlpha\b\s*/gi, " ").trim() || `${ctx.country} Education`;
    console.warn(`Stripped 'Alpha' from localizedProgramName -> ${ctx.localizedProgramName}`);
  }

  // Guardrail: ensure localizedLifeSkillsName exists and differs from localizedProgramName
  if (!ctx.localizedLifeSkillsName) {
    ctx.localizedLifeSkillsName = `${ctx.country}Core`;
    console.warn(`localizedLifeSkillsName missing, defaulting to ${ctx.localizedLifeSkillsName}`);
  }
  const schoolNorm = (ctx.localizedProgramName || "").toLowerCase().trim();
  const lifeSkillsNorm = ctx.localizedLifeSkillsName.toLowerCase().trim();
  if (schoolNorm === lifeSkillsNorm || schoolNorm.startsWith(lifeSkillsNorm) || lifeSkillsNorm.startsWith(schoolNorm)) {
    ctx.localizedLifeSkillsName = `${ctx.country}Core`;
    console.warn(`School network and life-skills names overlapped; reset localizedLifeSkillsName -> ${ctx.localizedLifeSkillsName}`);
  }

  // Step 2: Build financial research data from context and compute the model
  const financialData = buildFinancialResearchData(ctx);
  const financialModel = computeFinancialModel(financialData, ctx.country);

  // Step 3: Generate both HTML documents using the fixed economics + country context
  let termSheetHtml = generateTermSheetHtml(ctx);
  let pitchDeckHtml = generatePitchDeckHtml(ctx, financialModel);

  // Step 4: Language QA — enforce US English spelling and USD currency
  const tsQA = runLanguageQA(termSheetHtml);
  termSheetHtml = tsQA.text;
  const pdQA = runLanguageQA(pitchDeckHtml);
  pitchDeckHtml = pdQA.text;
  if (tsQA.report.totalIssues + pdQA.report.totalIssues > 0) {
    console.log(`Language QA: ${tsQA.report.totalIssues} term sheet fix(es), ${pdQA.report.totalIssues} deck fix(es)`);
  }

  // Step 5: Generate DOCX and base64-encode it for client-side download
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
    res.json({ status: "ok", version: "2.5.0-world-class", slides: 14 });
  });


}
