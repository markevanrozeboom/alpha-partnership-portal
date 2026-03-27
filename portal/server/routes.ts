import type { Express } from "express";
import type { Server } from "http";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { storage } from "./storage";
import { buildTermSheetDocx } from "./docx-builder";
import { computeFinancialModel, fmtCompact, fmtUsd, fmtNum } from "./financial-engine";
import { runLanguageQA } from "./language-qa";
import type { CountryContext, GenerationResult, FullGenerationResult, FinancialResearchData, FinancialModel, PipelineStatus } from "@shared/schema";

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
  "localizedProgramName": "An EXCITING, ASPIRATIONAL brand name for the country-owned, Alpha-operated SCHOOL NETWORK (1-3 words max, like 'Ed71' for UAE or 'Savoir France' for France). Must be concise enough for a slide title. Draw from the local language, national vision, cultural heritage, or aspirational concepts — NOT generic English. NEVER include explanations or descriptions — just the brand name itself. MUST NOT contain the word 'Alpha'. MUST NOT be generic like '[Country] Education', '[Country] Education Company', or '[Country] Learning'. MUST be a COMPLETELY DIFFERENT name from localizedLifeSkillsName. Examples: 'Ed71' (UAE — founding year), 'Savoir France' (knowledge in French), 'Ru'ya 2030' (Saudi — vision in Arabic), 'Ilm Singapore' (knowledge in Malay).",
  "localizedLifeSkillsName": "An EXCITING, ASPIRATIONAL brand name for the country-specific LIFE-SKILLS CURRICULUM program (1-2 words, like 'AsasCore' for UAE or 'VivreCore' for France). This is the country's equivalent to AlphaCore — the life-skills engine. MUST be a COMPLETELY DIFFERENT name from localizedProgramName — these are two distinct products. MUST NOT be derived from localizedProgramName (NO '[ProgramName]Skills'). MUST NOT be generic like '[Country]Core', '[Country]Skills', or 'NationalCore'. Use a different local-language word tied to life, growth, foundation, spirit, or path. Examples: 'AsasCore' (UAE — asas = foundation), 'VivreCore' (France — vivre = to live), 'HayatSkills' (Saudi — hayat = life).",
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
    { item: "Country-Specific Incept EdLLM", amount: "$250M", recipient: "Local expense" },
    { item: "Country-Specific Programs & Life Skills", amount: "$250M", recipient: "Local expense" },
    { item: "Country-Specific EdTech Apps", amount: "$250M", recipient: "Local expense" },
    { item: "Timeback License Prepay", amount: "$500M", recipient: "100,000 student-years x $5,000" },
    { item: "Operating Fee Prepay", amount: "$250M", recipient: "100,000 student-years x $2,500" },
  ],
  upfrontTotal: "$1.75B",
  ongoing: [
    { item: "Parent Education / Launch / Guides", amount: "$50M / yr", recipient: "Per year, ongoing" },
    { item: "Scholarships / Increased Public Funding", amount: "$1B / yr", recipient: "Assumed public funding/student of $25,000" },
    { item: "Timeback (20% of funding/tuition)", amount: "$500M / yr", recipient: "Min $5,000/student/year, ongoing" },
    { item: "Operating Fee (10% of funding/tuition)", amount: "$250M / yr", recipient: "Min $2,500/student/year, ongoing" },
  ],

  costStructure: [
    { item: "Funding/Tuition", traditional: "$25,000", alpha: "$25,000" },
    { item: "Teachers / Guides", traditional: "$12,500", alpha: "$4,500" },
    { item: "Programs and Life Skills", traditional: "$2,000", alpha: "$4,250" },
    { item: "Other Headcount", traditional: "$3,000", alpha: "$1,750" },
    { item: "Facility / CapEx", traditional: "$5,000", alpha: "$3,000" },
    { item: "Miscellaneous Expenses", traditional: "$2,500", alpha: "$1,500" },
    { item: "Timeback (Software)", traditional: "$0", alpha: "$5,000" },
    { item: "Operating Fee (10%)", traditional: "$0", alpha: "$2,500" },
    { item: "Operating Margin / IP Amort", traditional: "$0", alpha: "$2,500" },
  ],
  scaleTargets: {
    yearOne: "2,000 students / 2 communities",
    fiveYear: "200k students / 50+ communities",
  },
};

// ─── Term Sheet HTML Generator ───────────────────────────────────────────────

function generateTermSheetHtml(ctx: CountryContext): string {
  const programName = ctx.localizedProgramName || ctx.country;
  let lifeSkillsName = ctx.localizedLifeSkillsName || `${ctx.country}Vita`;
  const year = new Date().getFullYear();
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const genericPatterns = [
    new RegExp(`^${ctx.country}\\s*(Core|Skills)$`, 'i'),
    new RegExp(`^${programName}\\s*Skills$`, 'i'),
    /^National\s*Core$/i,
  ];
  if (genericPatterns.some(p => p.test(lifeSkillsName))) {
    lifeSkillsName = `${ctx.country}Vita`;
  }

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
        .replace("Country-Specific Incept EdLLM", `${ctx.country}-Specific Incept EdLLM`)
        .replace("Country-Specific Programs & Life Skills", `${ctx.country}-Specific Programs & Life Skills (${lifeSkillsName})`)
        .replace("Country-Specific EdTech Apps", `${ctx.country}-Specific EdTech Apps`);
      return `<tr><td>${item}</td><td class="amt">${r.amount}</td><td class="recipient">${r.recipient}</td></tr>`;
    })
    .join("\n");

  const ongoingRows = FIXED_ECONOMICS.ongoing
    .map(r => `<tr><td>${r.item}</td><td class="amt">${r.amount}</td><td class="recipient">${r.recipient}</td></tr>`)
    .join("\n");

  const costRows = FIXED_ECONOMICS.costStructure
    .map(r => `<tr><td>${r.item}</td><td class="amt">${r.traditional}</td><td class="amt hl">${r.alpha}</td></tr>`)
    .join("\n")
    + `\n<tr class="total-row"><td><strong>Total</strong></td><td class="amt"><strong>$25,000</strong></td><td class="amt hl"><strong>$25,000</strong></td></tr>`
    + `\n<tr class="outcome-row"><td><strong>Education Outcomes</strong></td><td class="amt">Current Baseline</td><td class="amt hl"><strong>World Class (2x faster, +93 NPS)</strong></td></tr>`;

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
  --navy: #0000E5;
  --navy-mid: #1a33ff;
  --navy-light: #3355ff;
  --blue: #0000E5;
  --blue-light: #59BBF9;
  --gold: #0000E5;
  --gold-light: #59BBF9;
  --cream: #f0f4f8;
  --cream-dark: #e4eaf2;
  --white: #ffffff;
  --text-muted: #6b7280;
  --text-light: rgba(255,255,255,0.85);
  --text-body: #1a1a2e;
  --border-light: rgba(0, 0, 229, 0.15);
  --border-subtle: rgba(0, 0, 229, 0.08);
  --font-display: 'Montserrat', -apple-system, sans-serif;
  --font-body: 'Inter', -apple-system, sans-serif;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --max-w: 1200px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; }
body { font-family: var(--font-body); font-size: 16px; line-height: 1.6; color: #1a1a2e; background: var(--cream); overflow-x: hidden; }
img { max-width: 100%; display: block; }
a { color: inherit; text-decoration: none; }

.container { max-width: var(--max-w); margin: 0 auto; padding: 0 2rem; }

/* ─── HEADER ─── */
.site-header {
  position: sticky; top: 0; z-index: 100;
  background: rgba(0, 0, 229, 0.97);
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
.main-nav a.active { color: var(--blue-light); border-bottom-color: var(--blue-light); }

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
  background: linear-gradient(135deg, #0000E5 0%, #59BBF9 100%);
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
  background: radial-gradient(ellipse, rgba(89, 187, 249, 0.08) 0%, transparent 70%);
  pointer-events: none;
}
.hero-badge {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--white); border: 1px solid rgba(255,255,255,0.4); border-radius: 4px;
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
.hero-subtitle {
  font-family: var(--font-display); font-size: clamp(1rem, 2vw, 1.25rem);
  font-weight: 400; color: rgba(255,255,255,0.7); letter-spacing: 0.04em;
  margin-bottom: 1.5rem;
}
.hero-confidential {
  display: inline-block; font-size: 0.6875rem; font-weight: 600;
  letter-spacing: 0.15em; text-transform: uppercase;
  color: rgba(255,255,255,0.5); margin-top: 1rem;
}

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
.section-dark .section-eyebrow { color: var(--blue-light); }

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
  border-left: 4px solid var(--blue); padding-left: 2.5rem;
}
.pull-quote-inner blockquote {
  font-family: var(--font-display); font-weight: 400; font-style: italic;
  font-size: clamp(1.25rem, 2.5vw, 1.625rem); line-height: 1.6;
  color: #1a1a2e; max-width: none;
}
.pull-quote-inner cite {
  display: block; margin-top: 1rem; font-family: var(--font-body);
  font-size: 0.8125rem; font-style: normal; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--blue);
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
  font-size: clamp(1.5rem, 3vw, 2.25rem); color: var(--white); margin-bottom: 0.35rem; line-height: 1.15;
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
.card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,229,0.12); border-color: var(--blue); }
.card-dark {
  background: var(--navy-light); border-color: var(--border-light);
}
.card-dark:hover { box-shadow: 0 8px 32px rgba(0,0,229,0.3); border-color: var(--blue-light); }
.card-dark h4, .card-dark h3 { color: var(--cream); }
.card-dark p { color: var(--text-light); }
.card-blue { border-left: 3px solid var(--blue); }

.card-label {
  display: block; font-family: var(--font-display);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--blue); margin-bottom: 0.5rem;
}
.card-icon {
  width: 48px; height: 48px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 1.25rem;
}
.card-icon.icon-gold { background: rgba(0, 0, 229, 0.08); }
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
  text-transform: uppercase; color: var(--white);
  padding: 0.75rem 1rem; border-bottom: 2px solid var(--navy);
  background: var(--blue);
}
.data-table th.primary-col { background: var(--blue); color: var(--white); }
.data-table tr:nth-child(even) td { background: #f8f9fc; }
.data-table td {
  padding: 0.65rem 1rem; border-bottom: 1px solid rgba(0,0,229,0.06);
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
.content-list li strong { color: #1a1a2e; }

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
.callout p { font-size: 0.9375rem; line-height: 1.65; color: #1a1a2e; max-width: none; }
.callout strong { color: var(--blue); }

/* ─── DIVIDER ─── */
.divider { height: 1px; background: var(--border-subtle); margin: 0; }
.divider-gold { width: 60px; height: 2px; background: var(--blue); margin-bottom: 1.5rem; }

/* ─── CTA ─── */
.cta-section { background: var(--navy); padding: 4rem 0; text-align: center; }
.cta-section h2 {
  font-family: var(--font-display); font-weight: 700; color: var(--cream);
  font-size: clamp(1.5rem, 3vw, 2rem); margin-bottom: 1rem;
}
.cta-section p { color: var(--text-light); margin: 0 auto 2rem; max-width: 50ch; }
.cta-btn {
  display: inline-flex; align-items: center; gap: 0.5rem;
  background: var(--white); color: var(--blue); font-family: var(--font-display);
  font-weight: 700; font-size: 0.875rem; padding: 0.75rem 1.75rem; border-radius: 6px;
  letter-spacing: 0.02em;
  transition: background 180ms var(--ease), transform 180ms var(--ease);
}
.cta-btn:hover { background: #f0f4f8; transform: translateY(-1px); }

/* ─── FOOTER (Fix #6) ─── */
.site-footer {
  background: #0000E5; color: var(--text-light); padding: 2rem 0;
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

/* ─── OVERVIEW ─── */
.overview-text { max-width: 800px; }
.overview-text p { font-size: 15px; line-height: 1.8; color: #2d3748; margin-bottom: 1.25rem; }

/* ─── TRANSFORMATION / THREE TRUTHS ─── */
.three-truths { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-top: 1.5rem; }
.truth-card { background: white; border-radius: 8px; padding: 1.5rem; border-left: 4px solid var(--blue); }
.truth-card h3 { font-family: var(--font-display); font-size: 1rem; font-weight: 700; margin-bottom: 0.5rem; color: #1a1a2e; }
.truth-card p { font-size: 0.875rem; color: #4a5568; line-height: 1.6; }

.capability-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.25rem; margin-top: 1rem; }
.capability { background: white; border-radius: 8px; padding: 1.25rem; border: 1px solid #e2e8f0; }
.capability strong { display: block; font-family: var(--font-display); color: var(--blue); margin-bottom: 0.25rem; }
.capability p { font-size: 0.8125rem; color: #4a5568; line-height: 1.5; margin: 0; }

/* ─── LIFE-SKILLS PROGRAM ─── */
.asset-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; margin: 1.5rem 0; }
.asset-card { background: white; border-radius: 8px; padding: 1.25rem; border: 1px solid #e2e8f0; }
.asset-card strong { display: block; font-family: var(--font-display); color: var(--blue); margin-bottom: 0.5rem; }
.asset-card p { font-size: 0.8125rem; color: #4a5568; line-height: 1.5; margin: 0; }

.sovereignty-note { font-size: 15px; color: #2d3748; line-height: 1.7; margin-top: 1rem; padding: 1rem 1.25rem; background: #eef2ff; border-radius: 8px; border-left: 4px solid var(--blue); }

/* ─── FLAGSHIP SCHOOLS ─── */
.flagship-points { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; margin: 1.5rem 0; }
.flagship-point { text-align: center; }
.flagship-point strong { display: block; font-family: var(--font-display); color: #1a1a2e; margin-bottom: 0.5rem; }
.flagship-point p { font-size: 0.8125rem; color: #4a5568; line-height: 1.5; }

.flagship-metrics { display: flex; gap: 2rem; justify-content: center; margin-top: 1.5rem; padding: 1rem; background: #f8f9fc; border-radius: 8px; font-size: 0.875rem; color: #2d3748; }

/* ─── PHASED ROLLOUT TIMELINE ─── */
.rollout-timeline { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-top: 2rem; }
.rollout-phase { background: white; border-radius: 8px; padding: 1.5rem; border-top: 4px solid var(--blue); text-align: center; }
.rollout-phase .phase-label { font-family: var(--font-display); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--blue); margin-bottom: 0.5rem; }
.rollout-phase h4 { font-family: var(--font-display); font-size: 1rem; font-weight: 700; color: #1a1a2e; margin-bottom: 0.5rem; }
.rollout-phase p { font-size: 0.8125rem; color: #4a5568; line-height: 1.5; }

@media (max-width: 768px) {
  .three-truths, .capability-grid, .asset-grid, .flagship-points, .rollout-timeline { grid-template-columns: 1fr; }
  .flagship-metrics { flex-direction: column; gap: 0.5rem; }
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
      <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:32px;object-fit:contain;"/>
    </span>

    <button class="nav-toggle" aria-label="Toggle navigation">
      <span></span><span></span><span></span>
    </button>

    <nav class="main-nav">
      <a onclick="document.getElementById('profile').scrollIntoView({behavior:'smooth'})">Profile</a>
      <a onclick="document.getElementById('overview').scrollIntoView({behavior:'smooth'})">Overview</a>
      <a onclick="document.getElementById('transformation').scrollIntoView({behavior:'smooth'})">Capabilities</a>
      <a onclick="document.getElementById('vision').scrollIntoView({behavior:'smooth'})">Vision</a>
      <a onclick="document.getElementById('flagship').scrollIntoView({behavior:'smooth'})">Flagship</a>
      <a onclick="document.getElementById('scale').scrollIntoView({behavior:'smooth'})">Scale</a>
      <a onclick="document.getElementById('commercial').scrollIntoView({behavior:'smooth'})">Commercial</a>
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
    <p class="hero-subtitle">Strategic Education Partnership</p>
    <p class="subline">${ctx.culturalNarrative}</p>
    <p class="hero-meta"><strong>Indicative Term Sheet</strong> · ${dateStr} · Alpha Holdings, Inc.</p>
    <span class="hero-confidential">Confidential &amp; Non-Binding</span>
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

<!-- ═══════ OVERVIEW — Rich narrative from Qatar term sheet ═══════ -->
<section class="section section-cream" id="overview">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">Overview</span>
      <h2 class="section-title">Why This Partnership</h2>
    </div>
    <div class="overview-text fade-in" style="margin-top: 1.5rem;">
      <p>The AI world that is coming requires us to reinvent the educational system if we want to prepare our children and society to thrive. Alpha is the only company in the world building a national-scale system that will transform every aspect of a student's educational journey from the ground up — including the student day, the teachers, the curriculum, and all of the technology.</p>

      <p>The same way that Alpha has become known as the "Stanford of K-12", via our partnership, we are dedicated to making <strong>"Educated in ${ctx.country}"</strong> the most valuable credential for the next generation of global leaders.</p>

      <p><strong>${programName}</strong> is a multi-billion-dollar partnership between ${ctx.country} and Alpha Holdings to build the world's first AI-native K-12 system at national scale. Our promise is clear and proven: <strong>students will love school, learn 2× faster, and develop life skills for the AI age.</strong></p>

      <p>Together we will design <strong>${lifeSkillsName}</strong>, the life-skills engine that ensures every student loves school and thrives in the AI age. ${lifeSkillsName} is intended to be ${ctx.country}'s most valuable education asset, designed as ${ctx.country}'s equivalent to AlphaCore.</p>

      <p>The ${programName} architecture is implemented through a national network of privately-operated, government-funded schools on the Alpha education system, with Alpha as exclusive initial operating partner.</p>

      <p>${programName} launches immediately. Superior outcomes create unstoppable parent demand, and ${ctx.country} inherits a proven model for national transformation.</p>
    </div>
  </div>
</section>

<!-- ═══════ PULL QUOTE — Why This Country ═══════ -->
<section class="pull-quote fade-in">
  <div class="pull-quote-inner">
    <blockquote>${ctx.culturalNarrative}</blockquote>
    <cite>The Case for ${ctx.country}</cite>
  </div>
</section>

<!-- Curved divider: cream → white transformation -->
<div class="section-divider" style="background: var(--cream);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C480,80 960,80 1440,0 L1440,80 L0,80 Z" fill="var(--white)"/>
  </svg>
</div>

<!-- ═══════ TRANSFORMATION STEPS & ALPHA'S PROVEN CAPABILITIES ═══════ -->
<section class="section section-white" id="transformation">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">Alpha's Proven Capabilities</span>
      <h2 class="section-title">Transformation Starts with Three Core Truths</h2>
    </div>

    <div class="three-truths fade-in">
      <div class="truth-card">
        <h3>Children Should Love School</h3>
        <p>More than vacation. More than weekends. A school day designed to inspire, not endure.</p>
      </div>
      <div class="truth-card">
        <h3>Academic Mastery in 2 Hours</h3>
        <p>Children can master the full academic curriculum in just 2 hours per day — freeing 4 hours for life-skills development.</p>
      </div>
      <div class="truth-card">
        <h3>High Standards = Happiness</h3>
        <p>The key to children's happiness is not lower expectations — it is high standards, delivered with love and the right tools.</p>
      </div>
    </div>

    <p class="section-subtitle fade-in" style="margin-top: 2rem;">Alpha brings a complete, already-operating capability stack:</p>

    <div class="capability-grid fade-in" style="margin-top: 0.5rem;">
      <div class="capability">
        <strong>Timeback</strong>
        <p>The AI and learning-science platform that delivers academic mastery 10× faster than conventional classrooms.</p>
      </div>
      <div class="capability">
        <strong>AlphaCore</strong>
        <p>An AI-age life-skills curriculum — leadership, teamwork, communication, resilience. Alpha students love school with a +93 NPS.</p>
      </div>
      <div class="capability">
        <strong>Guide School</strong>
        <p>The talent academy that converts traditional teachers into Guides — coaches and mentors focused on mindset, not lecturing.</p>
      </div>
      <div class="capability">
        <strong>Incept eduLLM</strong>
        <p>A custom large language model adapted to local curriculum, language, and cultural context — ensuring the AI layer is authentically ${ctx.country}.</p>
      </div>
    </div>
  </div>
</section>

<!-- Curved divider: white → cream life-skills -->
<div class="section-divider" style="background: var(--white);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C360,80 1080,80 1440,0 L1440,80 L0,80 Z" fill="var(--cream)"/>
  </svg>
</div>

<!-- ═══════ LIFE-SKILLS PROGRAM ═══════ -->
<section class="section section-cream" id="lifeskills">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">${lifeSkillsName}</span>
      <h2 class="section-title">${ctx.country}'s Most Valuable Education Asset</h2>
      <p class="section-subtitle">A country's most valuable educational asset is its K-12 life-skills program; whoever designs it is effectively writing the operating system for the next generation of leaders.</p>
    </div>

    <div class="asset-grid fade-in" style="margin-top: 1.5rem;">
      <div class="asset-card">
        <strong>${lifeSkillsName} Design</strong>
        <p>Starting from the AlphaCore base, we co-create ${lifeSkillsName} — the life-skills system fully under ${ctx.country}'s control, encoding local values, traditions, and aspirations.</p>
      </div>
      <div class="asset-card">
        <strong>${ctx.country}-Specific EdTech Apps</strong>
        <p>Applications that integrate into Timeback: ${ctx.languageApps || 'language, cultural studies, and locally relevant curriculum'}.</p>
      </div>
      <div class="asset-card">
        <strong>${ctx.country} eduLLM</strong>
        <p>A specialized configuration trained on ${ctx.country}'s language, laws, customs, culture, and values — built on top of Incept's base eduLLM.</p>
      </div>
    </div>

    <div class="sovereignty-note fade-in">
      With ${lifeSkillsName}, ${ctx.country}-specific apps, and the specialized eduLLM layered on top, <strong>${ctx.country} gains true educational sovereignty</strong> over what students learn.
    </div>
  </div>
</section>

<!-- Curved divider: cream → white flagship -->
<div class="section-divider" style="background: var(--cream);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C480,80 960,80 1440,0 L1440,80 L0,80 Z" fill="var(--white)"/>
  </svg>
</div>

<!-- ═══════ ALPHA FLAGSHIP SCHOOLS ═══════ -->
<section class="section section-white" id="flagship">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">Alpha Flagship Schools</span>
      <h2 class="section-title">The Premium "Halo Brand"</h2>
      <p class="section-subtitle">Alpha Flagship Schools are 100% owned by Alpha Holdings and serve as the premium benchmark — demonstrating the full Alpha experience at the highest level of execution.</p>
    </div>

    <div class="flagship-points fade-in" style="margin-top: 1.5rem;">
      <div class="flagship-point">
        <strong>Marketing &amp; Validation Engine</strong>
        <p>These schools establish an unassailable benchmark for excellence, legitimizing the brand's entire presence in ${ctx.country}.</p>
      </div>
      <div class="flagship-point">
        <strong>Premium Positioning</strong>
        <p>The flagship schools create a brand halo that justifies premium positioning across the entire portfolio.</p>
      </div>
      <div class="flagship-point">
        <strong>Strategic Anchor</strong>
        <p>Essential to the entire proposal's success — anchoring the system and providing the proof of concept for national-scale transformation.</p>
      </div>
    </div>

    <div class="flagship-metrics fade-in">
      <div><strong>Tuition:</strong> $40,000 – $45,000/year</div>
      <div><strong>Capacity:</strong> 500 – 1,000 students per school</div>
      <div><strong>Backstop:</strong> ${ctx.country} provides 50% capacity backstop for 5 years</div>
    </div>
  </div>
</section>

<!-- Curved divider: white → cream national schools -->
<div class="section-divider" style="background: var(--white);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C360,80 1080,80 1440,0 L1440,80 L0,80 Z" fill="var(--cream)"/>
  </svg>
</div>

<!-- ═══════ COUNTRY-OWNED SCHOOLS ═══════ -->
<section class="section section-cream" id="national-schools">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">${programName} Schools</span>
      <h2 class="section-title">${ctx.country} Owned, Alpha Operated</h2>
      <p class="section-subtitle">100% owned by ${ctx.country}, with Alpha Holdings as the exclusive operating partner. We propose implementation through a national network of privately-operated, government-funded schools — and are equally open to other structures.</p>
    </div>

    <div class="card-grid card-grid-2 fade-in" style="margin-top: 2rem;">
      <div class="card">
        <h4 style="color: var(--blue); font-family: var(--font-display); margin-bottom: 1rem;">Ownership &amp; Operations</h4>
        <ul style="list-style: none; padding: 0; margin: 0;">
          <li style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 0.75rem;">
            <span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span>
            <span>100% owned by ${ctx.country}, 0% owned by Alpha. Alpha operates as exclusive operator and licensor on behalf of ${ctx.country}.</span>
          </li>
          <li style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 0.75rem;">
            <span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span>
            <span>Schools can be operated as either <strong>public or private</strong> schools.</span>
          </li>
          <li style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 0.75rem;">
            <span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span>
            <span>${ctx.country} is responsible for sourcing real estate; schools pay rent.</span>
          </li>
        </ul>
      </div>
      <div class="card">
        <h4 style="color: var(--blue); font-family: var(--font-display); margin-bottom: 1rem;">Scale &amp; Economics</h4>
        <ul style="list-style: none; padding: 0; margin: 0;">
          <li style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 0.75rem;">
            <span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span>
            <span>Per-student budget: <strong>$25,000/year</strong> (fixed).</span>
          </li>
          <li style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 0.75rem;">
            <span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span>
            <span>Minimum commitment to scale to <strong>100,000 students</strong>.</span>
          </li>
          <li style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 0.75rem;">
            <span style="flex-shrink:0; width:6px; height:6px; background:var(--blue); border-radius:50%; margin-top:7px;"></span>
            <span>Every ${programName} school runs on Alpha's <strong>Timeback</strong> with <strong>${lifeSkillsName}</strong>.</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</section>

<!-- Curved divider: cream → white vision -->
<div class="section-divider" style="background: var(--cream);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C360,80 1080,80 1440,0 L1440,80 L0,80 Z" fill="var(--white)"/>
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
          <p><strong>${programName}</strong> is 100% owned by ${ctx.country}, with Alpha Holdings as the exclusive operating partner.</p>
          <p style="margin-top: 0.75rem;">Together we design <strong style="color: var(--blue);">${lifeSkillsName}</strong> — ${ctx.country}'s life-skills engine, the local equivalent to AlphaCore.</p>
          <p style="margin-top: 0.75rem; font-size: 0.875rem; color: var(--text-muted);">${ctx.localLifeSkillsFocus || ''}</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- Curved divider: cream → navy stats -->
<div class="section-divider" style="background: var(--cream);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C360,80 1080,80 1440,0 L1440,80 L0,80 Z" fill="var(--navy)"/>
  </svg>
</div>

<!-- ═══════ SCALE TARGETS (Fix #1: Dynamic) ═══════ -->
<section class="stats-strip fade-in" id="scale">
  <div class="container">
    <div style="text-align: center; margin-bottom: 2rem;">
      <span class="section-eyebrow" style="color: var(--blue-light);">Scale Targets</span>
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

<!-- Curved divider: navy → cream rollout -->
<div class="section-divider" style="background: var(--navy);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C480,80 960,80 1440,0 L1440,80 L0,80 Z" fill="var(--cream)"/>
  </svg>
</div>

<!-- ═══════ PHASED ROLLOUT ═══════ -->
<section class="section section-cream" id="rollout">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">Phased Deployment</span>
      <h2 class="section-title">${programName} School Network Rollout</h2>
      <p class="section-subtitle">${ctx.country}-owned platform with Alpha as exclusive operating partner. Staged scaling plan designed for sustainable, high-quality growth.</p>
    </div>

    <div class="rollout-timeline fade-in">
      ${(() => {
        const n = new Date();
        const readyBy = new Date(n.getFullYear(), n.getMonth() + 16, 1);
        let ly = readyBy.getFullYear();
        if (readyBy.getMonth() > 8) ly++;
        const p1 = `SY${String(ly).slice(-2)}\u2013${String(ly + 1).slice(-2)}`;
        const p2 = `SY${String(ly + 1).slice(-2)}\u2013${String(ly + 2).slice(-2)}`;
        return `
      <div class="rollout-phase">
        <div class="phase-label">Phase 0 — Foundation</div>
        <h4>Now \u2013 Summer ${ly}</h4>
        <p>IP transfer, ${lifeSkillsName} design, and eduLLM model training.</p>
      </div>
      <div class="rollout-phase">
        <div class="phase-label">Phase 1 — Launch</div>
        <h4>${p1}</h4>
        <p>Launch of Alpha Flagship school.</p>
      </div>
      <div class="rollout-phase">
        <div class="phase-label">Phase 2 — National Scale</div>
        <h4>${p2}</h4>
        <p>National rollout of the ${programName} school network.</p>
      </div>`;
      })()}
    </div>
  </div>
</section>

<!-- Curved divider: cream → cream commercial -->
<div class="section-divider" style="background: var(--cream);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C480,80 960,80 1440,0 L1440,80 L0,80 Z" fill="var(--white)"/>
  </svg>
</div>

<!-- ═══════ COMMERCIAL STRUCTURE ═══════ -->
<section class="section-lg section-white" id="commercial">
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

<!-- Curved divider: white → cream costs -->
<div class="section-divider" style="background: var(--white);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C360,80 1080,80 1440,0 L1440,80 L0,80 Z" fill="var(--cream)"/>
  </svg>
</div>

<!-- ═══════ COST STRUCTURE ═══════ -->
<section class="section section-cream" id="costs">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">School Cost Comparison</span>
      <h2 class="section-title">Per-Student Economics at $25K Budget</h2>
      <p class="section-subtitle">Illustrative "cost to educate" per student for ${programName} school vs. traditional school at $25K annual budget.</p>
    </div>

    <div class="table-wrap fade-in">
      <table class="data-table">
        <thead>
          <tr>
            <th>Cost Item (Per Student)</th>
            <th>Traditional $25K School</th>
            <th class="primary-col">Alpha/Timeback $25K School</th>
          </tr>
        </thead>
        <tbody>
          ${costRows}
        </tbody>
      </table>
    </div>
  </div>
</section>

<!-- Curved divider: cream → white program -->
<div class="section-divider" style="background: var(--cream);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C480,80 960,80 1440,0 L1440,80 L0,80 Z" fill="var(--white)"/>
  </svg>
</div>

<!-- ═══════ PROGRAM ═══════ -->
<section class="section section-white" id="program">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">${lifeSkillsName}</span>
      <h2 class="section-title">Purpose-built for ${ctx.country}</h2>
      <p class="section-subtitle">The complete education engine — life skills, localized AI, and national-scale deployment — designed specifically for ${ctx.country}.</p>
    </div>

    <div class="card-grid card-grid-3 fade-in" style="margin-top: 2rem;">
      <div class="card">
        <div class="card-icon icon-gold">
          <svg viewBox="0 0 24 24" fill="none" stroke="#0000E5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
          </svg>
        </div>
        <span class="card-label">Life Skills</span>
        <h4>${lifeSkillsName}</h4>
        <p>${ctx.localLifeSkillsFocus || ctx.country + "'s equivalent to AlphaCore — the life-skills engine tailored for local culture and values."}</p>
      </div>
      <div class="card">
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
      <div class="card">
        <div class="card-icon icon-gold">
          <svg viewBox="0 0 24 24" fill="none" stroke="#0000E5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
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

<!-- Curved divider: white → navy CTA -->
<div class="section-divider" style="background: var(--white);">
  <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,0 C480,80 960,80 1440,0 L1440,80 L0,80 Z" fill="var(--navy)"/>
  </svg>
</div>

<!-- ═══════ CTA ═══════ -->
<section class="section section-navy" id="cta" style="text-align: center;">
  <div class="container">
    <div class="fade-in">
      <span class="section-eyebrow">Next Steps</span>
      <h2 class="section-title" style="color: var(--cream);">Start the Conversation</h2>
      <p class="section-subtitle" style="color: var(--text-light); max-width: 50ch; margin: 0 auto 2rem;">${programName} represents a generational opportunity to build ${ctx.country}'s education legacy. We welcome the opportunity to discuss this partnership.</p>
      <a href="mailto:joe.liemandt@alpha.school" class="cta-btn" target="_blank" rel="noopener noreferrer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        joe.liemandt@alpha.school
      </a>
    </div>
  </div>
</section>

<!-- ═══════ FOOTER ═══════ -->
<footer class="site-footer">
  <div class="container">
    <div class="footer-inner">
      <div class="footer-brand">
        <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" class="footer-bird" style="height:24px;object-fit:contain;opacity:0.7;"/>
        <div class="footer-brand-text">
          <strong>Alpha Holdings, Inc.</strong>
          <span style="font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7;">Confidential &amp; Non-Binding</span>
          <span>&copy; ${year}. All rights reserved.</span>
        </div>
      </div>
      <div class="footer-center">
        <a href="mailto:joe.liemandt@alpha.school" target="_blank" rel="noopener noreferrer">joe.liemandt@alpha.school</a>
      </div>
      <div class="footer-links">
        <a href="https://alpha.school" target="_blank" rel="noopener noreferrer">alpha.school</a>
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
  let lifeSkillsName = ctx.localizedLifeSkillsName || `${ctx.country}Vita`;
  const year = new Date().getFullYear();
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" });

  const genericPatterns = [
    new RegExp(`^${ctx.country}\\s*(Core|Skills)$`, 'i'),
    new RegExp(`^${programName}\\s*Skills$`, 'i'),
    /^National\s*Core$/i,
  ];
  if (genericPatterns.some(p => p.test(lifeSkillsName))) {
    lifeSkillsName = `${ctx.country}Vita`;
  }

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
    .map(r => `<tr><td>${r.item}</td><td class="amt">${r.traditional}</td><td class="amt highlight">${r.alpha}</td></tr>`)
    .join("\n")
    + `\n<tr class="total-row"><td><strong>Total</strong></td><td class="amt"><strong>$25,000</strong></td><td class="amt highlight"><strong>$25,000</strong></td></tr>`
    + `\n<tr class="outcome-row"><td><strong>Education Outcomes</strong></td><td class="amt">Current Baseline</td><td class="amt highlight"><strong>World Class (2x faster, +93 NPS)</strong></td></tr>`;

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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;opacity:0.5;"/>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
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
        <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha Holdings" style="height:40px;object-fit:contain;margin:0 auto;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;opacity:0.5;"/>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
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
        <div class="scale-box"><div class="period">3-Year Plan</div><div class="figure">100k student-years · 100+ campuses</div></div>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
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
        <div class="scale-box"><div class="period">3-Year Target</div><div class="figure">100k student-years · 100+ campuses</div></div>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
    <span class="copy">&copy; ${year}. Confidential &amp; Proprietary.</span>
    <span class="slide-num">${nextSlide()}</span>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SLIDE 13 — COST STRUCTURE (School Cost Comparison)
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="slide slide-content">
  <div class="label">School Cost Comparison</div>
  <h2>Per-Student Economics at <span>$25K Budget</span></h2>
  <p style="font-size:11px; font-style:italic; color:#4a5568; margin:4px 0 0 0;">Illustrative "cost to educate" per student for ${programName} school vs. traditional school at $25K annual budget.</p>

  <div style="margin-top:8px;">
    <table class="deck-table">
      <thead>
        <tr>
          <th>Cost Item (Per Student)</th>
          <th>Traditional $25K School</th>
          <th class="primary-col">Alpha/Timeback $25K School</th>
        </tr>
      </thead>
      <tbody>
        ${costRows}
      </tbody>
    </table>
  </div>

  <div class="callout-box" style="margin-top:12px;">
    <p>We propose implementation through a national network of privately-operated, government-funded schools — and are equally open to other structures.</p>
  </div>

  <div class="slide-footer">
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;filter:brightness(0) saturate(100%) invert(9%) sepia(100%) saturate(7487%) hue-rotate(247deg) brightness(89%) contrast(146%);"/>
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
    <img src="https://alpha.school/wp-content/uploads/2024/03/logowhite-2.svg" alt="Alpha" style="height:16px;object-fit:contain;opacity:0.5;"/>
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
      model: "claude-sonnet-4-6",
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
    ctx.localizedProgramName = ctx.localizedProgramName.replace(/\s*\bAlpha\b\s*/gi, " ").trim() || `${ctx.country} Futures`;
    console.warn(`Stripped 'Alpha' from localizedProgramName -> ${ctx.localizedProgramName}`);
  }

  // Guardrail: ensure localizedLifeSkillsName exists and differs from localizedProgramName
  if (!ctx.localizedLifeSkillsName) {
    ctx.localizedLifeSkillsName = `${ctx.country}Vita`;
    console.warn(`localizedLifeSkillsName missing, defaulting to ${ctx.localizedLifeSkillsName}`);
  }
  const schoolNorm = (ctx.localizedProgramName || "").toLowerCase().trim();
  const lifeSkillsNorm = ctx.localizedLifeSkillsName.toLowerCase().trim();
  if (schoolNorm === lifeSkillsNorm || schoolNorm.startsWith(lifeSkillsNorm) || lifeSkillsNorm.startsWith(schoolNorm)) {
    ctx.localizedLifeSkillsName = `${ctx.country}Vita`;
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

// ─── FastAPI Pipeline Integration ────────────────────────────────────────────

const BACKEND_URL = process.env.BACKEND_URL || "https://alpha-pipeline-api.onrender.com";

// ─── Map FastAPI CountryProfile → Portal CountryContext ──────────────────────
function mapBackendProfile(profile: any): CountryContext {
  const t = profile?.target || {};
  const d = profile?.demographics || {};
  const e = profile?.economy || {};
  const ed = profile?.education || {};
  const p = profile?.political_context || {};
  const fmkt = profile?.flagship_market_data || {};

  const fmtPop = (n: number | null) => {
    if (!n) return "Unknown";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} million`;
    return n.toLocaleString();
  };
  const fmtCurrency = (n: number | null) => {
    if (!n) return "Unknown";
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };

  return {
    country: t.name || "Unknown",
    formalName: t.name || "Unknown",
    headOfState: p.head_of_state || "Unknown",
    headOfStateTitle: p.government_type || "Head of State",
    flagEmoji: "",
    population: fmtPop(d.total_population),
    gdpPerCapita: fmtCurrency(e.gdp_per_capita),
    schoolAgePopulation: d.population_0_18 ? `${fmtPop(d.population_0_18)} children aged 0–18` : "Unknown",
    currentEdSpendPerStudent: ed.avg_public_spend_per_student ? `${fmtCurrency(ed.avg_public_spend_per_student)} per student annually` : "Unknown",
    nationalEdVision: [p.national_vision_plan, p.education_reform_priority, p.reform_themes].filter(Boolean).join(". ") || "National education reform underway.",
    culturalNarrative: "",  // Will be populated from strategy report if available
    keyStrengths: [],
    localizedProgramName: "",
    localizedLifeSkillsName: "",
    localLifeSkillsFocus: "",
    languageApps: "",
    addressableStudentPopulation: fmkt.addressable_students ? `${fmtPop(fmkt.addressable_students)} students` : (d.population_0_18 ? `${fmtPop(Math.round(d.population_0_18 * 0.05))} students` : "Unknown"),
    addressableMethodology: fmkt.addressable_methodology || "",
  };
}

const STAGE_LABELS: Record<string, string> = {
  pending: "Initializing...",
  researching_country: "Researching country profile...",
  review_country_report: "Processing country research...",
  researching_education: "Analyzing education system...",
  review_education_report: "Processing education analysis...",
  strategizing: "Developing partnership strategy...",
  review_strategy: "Processing strategy...",
  presenting_assumptions: "Building financial assumptions...",
  review_assumptions: "Processing assumptions...",
  building_model: "Computing financial model...",
  review_model: "Processing financial model...",
  presenting_term_sheet_assumptions: "Preparing term sheet...",
  review_term_sheet_assumptions: "Processing term sheet...",
  generating_documents: "Generating Gamma deck & documents...",
  review_documents: "Finalizing documents...",
  completed: "Complete",
  error: "Error",
};

const GATE_APPROVALS: Record<string, { endpoint: string; body: object }> = {
  review_country_report: { endpoint: "feedback/country-report", body: { approved: true } },
  review_education_report: { endpoint: "feedback/education-report", body: { approved: true } },
  review_strategy: { endpoint: "feedback/strategy", body: { approved: true } },
  review_assumptions: { endpoint: "feedback/assumptions", body: { approved: true, adjustments: {} } },
  review_model: { endpoint: "feedback/model", body: { locked: true } },
  review_term_sheet_assumptions: { endpoint: "feedback/term-sheet-assumptions", body: { approved: true, adjustments: {} } },
  review_documents: { endpoint: "feedback/documents", body: { approved: true } },
};

async function orchestratePipeline(localRunId: string, target: string): Promise<void> {
  try {
    // Step 1: Create the run on the FastAPI backend
    const createRes = await fetch(`${BACKEND_URL}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Failed to create pipeline run: ${createRes.status} ${errText}`);
    }
    const { run_id } = await createRes.json() as { run_id: string };

    storage.updatePipelineRun(localRunId, {
      pipelineRunId: run_id,
      pipelineStatus: "pending",
      pipelineLabel: STAGE_LABELS.pending,
    });

    // Step 2: Poll and auto-approve gates until completed or error
    const approvedGates = new Set<string>();
    const maxAttempts = 600; // 30 minutes at 3s intervals
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const statusRes = await fetch(`${BACKEND_URL}/api/runs/${run_id}`);
      if (!statusRes.ok) {
        console.error(`Pipeline poll failed: ${statusRes.status}`);
        continue;
      }

      const data = await statusRes.json() as {
        status: PipelineStatus;
        gamma_url?: string | null;
        gamma_export_url?: string | null;
        country_profile?: any | null;
        financial_model?: any | null;
        strategy?: any | null;
        financial_assumptions?: any | null;
        error_message?: string | null;
        agent_logs?: string[];
        country_report?: string | null;
        strategy_report?: string | null;
      };

      const status = data.status;
      const label = STAGE_LABELS[status] || status;

      storage.updatePipelineRun(localRunId, {
        pipelineStatus: status,
        pipelineLabel: label,
        agentLogs: data.agent_logs || [],
      });

      // Auto-approve gates
      if (status in GATE_APPROVALS && !approvedGates.has(status)) {
        const gate = GATE_APPROVALS[status];
        try {
          const approveRes = await fetch(`${BACKEND_URL}/api/runs/${run_id}/${gate.endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(gate.body),
          });
          if (approveRes.ok) {
            approvedGates.add(status);
            console.log(`Auto-approved gate: ${status} for run ${run_id}`);
          } else {
            console.warn(`Failed to approve gate ${status}: ${approveRes.status}`);
          }
        } catch (gateErr) {
          console.warn(`Gate approval error for ${status}:`, gateErr);
        }
        continue;
      }

      if (status === "error") {
        storage.updatePipelineRun(localRunId, {
          pipelineStatus: "error",
          pipelineLabel: "Error",
          error: data.error_message || "Pipeline failed with unknown error",
        });
        return;
      }

      // Generate term sheet as soon as we have a financial model (don't wait for Gamma docs)
      const canGenerate = (status === "generating_documents" || status === "review_documents" || status === "completed")
        && data.country_profile && data.financial_model;

      if (canGenerate) {
        // Build the result — map backend CountryProfile to portal CountryContext
        let ctx: CountryContext | null = data.country_profile ? mapBackendProfile(data.country_profile) : null;

        // Enrich with strategy data if available
        if (ctx && data.strategy) {
          const s = data.strategy;
          // Brand names from strategy.brand
          if (s.brand?.jv_name_suggestion) ctx.localizedProgramName = s.brand.jv_name_suggestion;
          if (s.brand?.positioning) ctx.culturalNarrative = s.brand.positioning;
          // Value propositions as key strengths
          if (s.value_propositions && Array.isArray(s.value_propositions)) {
            ctx.keyStrengths = s.value_propositions.map((vp: any) => 
              vp.pillar + (vp.proof_points?.length ? `: ${vp.proof_points[0]}` : "")
            ).filter(Boolean);
          }
          // Pitch angle as cultural narrative if brand positioning is empty
          if (!ctx.culturalNarrative && s.pitch_angle) ctx.culturalNarrative = s.pitch_angle;
        }

        // Enrich from strategy report (markdown) — extract cultural narrative
        if (ctx && !ctx.culturalNarrative && data.strategy_report) {
          // Take the first paragraph as the narrative
          const paragraphs = data.strategy_report.split("\n\n").filter((p: string) => p.trim() && !p.startsWith("#"));
          if (paragraphs.length > 0) ctx.culturalNarrative = paragraphs[0].trim().substring(0, 500);
        }
        let termSheetHtml: string | null = null;
        let pitchDeckHtml: string | null = null;
        let termSheetDocxBase64: string | null = null;

        // If we got a country profile, generate the local HTML docs
        if (ctx) {
          // Apply the same guardrails as local generation
          if (ctx.localizedProgramName && /\balpha\b/i.test(ctx.localizedProgramName)) {
            ctx.localizedProgramName = ctx.localizedProgramName.replace(/\s*\bAlpha\b\s*/gi, " ").trim() || `${ctx.country} Futures`;
          }
          if (!ctx.localizedLifeSkillsName) {
            ctx.localizedLifeSkillsName = `${ctx.country}Vita`;
          }

          try {
            termSheetHtml = generateTermSheetHtml(ctx);
            const financialData = buildFinancialResearchData(ctx);
            const financialModel = data.financial_model || computeFinancialModel(financialData, ctx.country);
            pitchDeckHtml = generatePitchDeckHtml(ctx, financialModel);

            // Language QA
            const tsQA = runLanguageQA(termSheetHtml);
            termSheetHtml = tsQA.text;
            const pdQA = runLanguageQA(pitchDeckHtml);
            pitchDeckHtml = pdQA.text;

            // DOCX
            const docxBuffer = await buildTermSheetDocx(ctx, financialModel);
            termSheetDocxBase64 = docxBuffer.toString("base64");
          } catch (genErr) {
            console.error("Error generating local documents from pipeline data:", genErr);
          }
        }

        const fullResult: FullGenerationResult = {
          context: ctx,
          termSheetHtml,
          pitchDeckHtml,
          termSheetDocxBase64,
          gammaUrl: data.gamma_url || null,
          gammaExportUrl: data.gamma_export_url || null,
          pipelineRunId: run_id,
          pipelineStatus: "completed",
          pipelineLabel: "Complete",
          agentLogs: data.agent_logs || [],
          errorMessage: null,
        };

        storage.updatePipelineRun(localRunId, {
          pipelineStatus: "completed",
          pipelineLabel: "Complete",
          result: fullResult,
        });
        return;
      }
    }

    // Timed out
    storage.updatePipelineRun(localRunId, {
      pipelineStatus: "error",
      pipelineLabel: "Error",
      error: "Pipeline timed out after 30 minutes",
    });
  } catch (err) {
    console.error("Pipeline orchestration error:", err);
    storage.updatePipelineRun(localRunId, {
      pipelineStatus: "error",
      pipelineLabel: "Error",
      error: String(err),
    });
  }
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

  // ─── Pipeline Routes (FastAPI backend) ──────────────────────────────────────

  app.post("/api/generate-full", async (req, res) => {
    const { target } = req.body;
    if (!target || typeof target !== "string" || !target.trim()) {
      res.status(400).json({ error: "Target country or state is required" });
      return;
    }

    const run = storage.createPipelineRun(target.trim());

    // Start pipeline orchestration in background
    orchestratePipeline(run.id, target.trim()).catch((err) => {
      console.error("Pipeline orchestration failed:", err);
    });

    res.json({ id: run.id });
  });

  app.get("/api/pipeline-runs/:id", (req, res) => {
    const run = storage.getPipelineRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Pipeline run not found" });
      return;
    }
    res.json(run);
  });

  // ─── Term Sheet Generation (for Vercel frontend calling portal backend) ─────

  app.post("/api/generate-term-sheet", async (req, res) => {
    const { countryContext, financialModel: clientModel } = req.body;
    if (!countryContext || !countryContext.country) {
      res.status(400).json({ error: "countryContext is required" });
      return;
    }

    try {
      const ctx = countryContext as CountryContext;

      // Apply guardrails
      if (ctx.localizedProgramName && /\balpha\b/i.test(ctx.localizedProgramName)) {
        ctx.localizedProgramName = ctx.localizedProgramName.replace(/\s*\bAlpha\b\s*/gi, " ").trim() || `${ctx.country} Futures`;
      }
      if (!ctx.localizedLifeSkillsName) {
        ctx.localizedLifeSkillsName = `${ctx.country}Vita`;
      }

      // Build financial model from context if not provided
      const financialData = buildFinancialResearchData(ctx);
      const model = clientModel || computeFinancialModel(financialData, ctx.country);

      // Generate HTML
      let termSheetHtml = generateTermSheetHtml(ctx);
      let pitchDeckHtml = generatePitchDeckHtml(ctx, model);

      // Language QA
      const tsQA = runLanguageQA(termSheetHtml);
      termSheetHtml = tsQA.text;
      const pdQA = runLanguageQA(pitchDeckHtml);
      pitchDeckHtml = pdQA.text;

      // DOCX
      const docxBuffer = await buildTermSheetDocx(ctx, model);
      const termSheetDocxBase64 = docxBuffer.toString("base64");

      res.json({
        context: ctx,
        termSheetHtml,
        pitchDeckHtml,
        termSheetDocxBase64,
      });
    } catch (err) {
      console.error("Term sheet generation error:", err);
      res.status(500).json({ error: "Failed to generate term sheet" });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "3.1.0-vercel-ready", slides: 14 });
  });
}
