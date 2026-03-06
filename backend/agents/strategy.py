"""Strategy Agent — produces McKinsey/VC quality market-entry strategy.

Synthesises country research and education analysis into a comprehensive
go-to-market strategy for Alpha's expansion into the target market.
"""

from __future__ import annotations

import logging
import os

from docx import Document as DocxDocument
from docx.shared import Pt as DocxPt
from docx.enum.text import WD_ALIGN_PARAGRAPH

from models.schemas import (
    Strategy, CountryProfile, EducationAnalysis,
    EntryMode, PartnershipType, TargetType,
)
from services.llm import call_llm, call_llm_plain
from config import OUTPUT_DIR

logger = logging.getLogger(__name__)

REPORT_PROMPT = """You are a senior partner at McKinsey & Company's Education Practice, working
alongside a managing director from a top-tier VC fund. You are producing a comprehensive
market-entry strategy for 2hr Learning (Alpha) in **{target}**.

This document will be presented to Alpha's executive team, prospective sovereign partners,
and institutional investors.

## About Alpha / 2hr Learning

- **Mission**: Transform K-12 education globally by making children love school, learn 2x
  faster, and develop future-ready skills
- **Products**: Timeback (AI learning compression), AlphaCore (curriculum OS), Guide School
  (teacher transformation), Incept eduLLM (education AI)
- **UAE Reference Deal (Ed71/Next71)**: $1.5B upfront commitment, 200,000 students over
  5 years, $25K per-student budget, JV structure with local entity AsasOne managing
  cultural IP layer, Emirati Guide cohort trained through Guide School
- **Revenue Model**: Management fees (10% of school revenue), Timeback License (20% of
  per-student budget), upfront IP/development fee ($25M+), curriculum development fees
- **Fee Floor**: Minimum $15K per student; below that, economic model breaks

## Country/State Profile

{country_context}

## Education Analysis

{education_context}

## Report Requirements

Write a comprehensive market-entry strategy in **markdown** with these sections.
Be specific, actionable, and investment-thesis oriented. Include specific numbers,
timelines, and decision criteria. Use tables for comparisons. Mark critical strategic
insights with **🎯 Strategic Priority:** callouts.

### Required Sections

1. **Executive Summary** — 4-5 paragraph synthesis: the opportunity, the approach,
   the deal structure, the returns thesis, and the key risks
2. **Market Opportunity Assessment** — TAM/SAM/SOM with calculation methodology,
   penetration scenarios, growth trajectory, comparison to UAE baseline
3. **Recommended Entry Mode** — Private / Government / Hybrid with detailed rationale,
   decision matrix comparing all three options across 8+ criteria
4. **Partnership Structure**
   - Recommended partner type (sovereign fund, government ministry, private operator)
   - Specific potential partners with assessment of each
   - JV structure recommendation (ownership split, governance, IP rights)
   - Local entity structure (based on AsasOne model)
   - Cultural IP layer design
5. **Brand & Positioning** — JV name suggestions (following Ed71/Next71 naming pattern),
   brand positioning, messaging framework for each stakeholder (parents, students,
   government, investors)
6. **School Type Portfolio** — For each recommended school type:
   - Target market segment and demographic
   - Student capacity and physical model
   - Pricing with PPP-adjusted rationale
   - Curriculum mix (Timeback + specialisations)
   - Differentiation from competitors
7. **Phased Rollout Plan** — 5-year plan with specific milestones per phase:
   - Phase 1 (Year 1): Flagship launch — student count, location, hiring
   - Phase 2 (Year 2-3): Expansion — additional schools, geographies
   - Phase 3 (Year 4-5): Scale — target student count, new school types
   - Include decision gates between phases
8. **Value Proposition Framework** — Value propositions for each stakeholder:
   - Government/sovereign: economic diversification, human capital, global ranking
   - Parents: outcomes data, child wellbeing, 2x learning efficiency
   - Students: love school, specialisations, future readiness
   - Investors: returns thesis, capital deployment, exit optionality
9. **Competitive Positioning** — Positioning vs. existing operators, defensibility
   of Alpha's model, moat analysis (technology, outcomes data, teacher training IP)
10. **Risk Mitigation Strategy** — Top 10 risks with probability, impact, and
    specific mitigation actions
11. **Key Asks & Deal Parameters** — Specific asks for the sovereign partner:
    - Upfront commitment (scaled from UAE deal)
    - Per-student budget (PPP-adjusted)
    - Student volume commitments
    - Regulatory concessions needed
    - Infrastructure/real estate support
    - Timeline commitments
12. **Implementation Roadmap** — 18-month pre-launch timeline with workstreams:
    partnership negotiation, regulatory, hiring, facilities, curriculum, technology
13. **Sources & Appendices**

For US states: adapt the strategy around ESA/voucher economics, charter school frameworks,
micro-school networks, direct-to-parent model, and school choice advocacy partnerships.

## Formatting Rules
- Markdown headers (## sections, ### subsections)
- Tables for comparisons, decision matrices, risk registers
- **🎯 Strategic Priority:** for key strategic decisions
- Minimum 4,000 words
- Write as if co-presenting at a McKinsey-VC board session
"""

REPORT_REVISION_PROMPT = """You are revising a market-entry strategy based on executive feedback.

Original strategy report:
{original_report}

Executive feedback:
{feedback}

Produce a revised full strategy incorporating the feedback. Maintain depth and
🎯 Strategic Priority callouts."""


async def run_strategy(
    target: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    entry_mode: EntryMode | None = None,
    feedback: str | None = None,
    previous_report: str | None = None,
) -> tuple[Strategy, str, str]:
    """Execute strategy development. Returns (strategy, report_md, docx_path)."""
    logger.info("Running strategy agent for %s", target)

    # --- Build context strings ---
    country_ctx = _build_country_context(country_profile)
    education_ctx = _build_education_context(education_analysis)

    # --- Structured strategy ---
    try:
        strategy: Strategy = await call_llm(
            system_prompt="You are a VC/McKinsey strategist. Produce a structured strategy.",
            user_prompt=(
                f"Target: {target}\nCountry: {country_ctx}\nEducation: {education_ctx}\n"
                f"Entry mode preference: {entry_mode.value if entry_mode else 'not specified'}"
            ),
            output_schema=Strategy,
        )
    except Exception as exc:
        logger.warning("Structured strategy failed: %s", exc)
        strategy = Strategy(entry_mode=entry_mode or EntryMode.HYBRID)

    if entry_mode:
        strategy.entry_mode = entry_mode

    # --- Narrative report ---
    if feedback and previous_report:
        report_md = await call_llm_plain(
            system_prompt=REPORT_REVISION_PROMPT.format(
                original_report=previous_report, feedback=feedback
            ),
            user_prompt=f"Revise the strategy for {target}.",
        )
    else:
        report_md = await call_llm_plain(
            system_prompt=REPORT_PROMPT.format(
                target=target,
                country_context=country_ctx,
                education_context=education_ctx,
            ),
            user_prompt=(
                f"Write the full market-entry strategy for **{target}**.\n"
                f"{'Entry mode preference: ' + entry_mode.value if entry_mode else ''}\n"
                f"Produce the complete strategy report."
            ),
        )

    # --- Save DOCX ---
    docx_path = _save_report_docx(target, report_md, "Market Entry Strategy")

    logger.info("Strategy complete for %s (mode=%s)", target, strategy.entry_mode)
    return strategy, report_md, docx_path


def _build_country_context(p: CountryProfile) -> str:
    parts = [f"Name: {p.target.name}", f"Type: {p.target.type.value}"]
    if p.target.tier:
        parts.append(f"Tier: {p.target.tier}")
    if p.demographics.total_population:
        parts.append(f"Population: {p.demographics.total_population:,.0f}")
    if p.economy.gdp_per_capita:
        parts.append(f"GDP/cap: ${p.economy.gdp_per_capita:,.0f}")
    if p.economy.gdp:
        parts.append(f"GDP: ${p.economy.gdp:,.0f}")
    if p.economy.gdp_growth_rate:
        parts.append(f"GDP growth: {p.economy.gdp_growth_rate}%")
    if p.demographics.population_0_18:
        parts.append(f"School-age pop: {p.demographics.population_0_18:,.0f}")
    if p.regulatory.foreign_ownership_rules:
        parts.append(f"Foreign ownership: {p.regulatory.foreign_ownership_rules}")
    if p.political_context.national_vision_plan:
        parts.append(f"National vision: {p.political_context.national_vision_plan}")
    if p.competitive_landscape.major_operators:
        ops = ", ".join(o.name for o in p.competitive_landscape.major_operators[:5])
        parts.append(f"Major operators: {ops}")
    return "\n".join(parts)


def _build_education_context(e: EducationAnalysis) -> str:
    parts = []
    if e.system_diagnosis.primary_pain_points:
        parts.append(f"Pain points: {'; '.join(e.system_diagnosis.primary_pain_points[:5])}")
    if e.reform_landscape.active_reforms:
        parts.append(f"Active reforms: {'; '.join(e.reform_landscape.active_reforms[:5])}")
    if e.two_hr_learning_fit.unique_value_propositions:
        parts.append(f"Alpha UVPs: {'; '.join(e.two_hr_learning_fit.unique_value_propositions[:5])}")
    if e.two_hr_learning_fit.model_recommendation:
        parts.append(f"Recommended model: {e.two_hr_learning_fit.model_recommendation.value}")
    return "\n".join(parts) or "Education analysis pending"


def _save_report_docx(target: str, markdown: str, title: str) -> str:
    doc = DocxDocument()
    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = DocxPt(11)
    h = doc.add_heading(f"{title}: {target}", level=0)
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph("CONFIDENTIAL & PROPRIETARY — 2hr Learning (Alpha)").alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_page_break()
    for line in markdown.split("\n"):
        s = line.strip()
        if s.startswith("# "):
            doc.add_heading(s[2:], level=1)
        elif s.startswith("## "):
            doc.add_heading(s[3:], level=2)
        elif s.startswith("### "):
            doc.add_heading(s[4:], level=3)
        elif s.startswith("- ") or s.startswith("* "):
            doc.add_paragraph(s[2:], style="List Bullet")
        elif s.startswith("|"):
            doc.add_paragraph(s)
        elif s:
            doc.add_paragraph(s)
    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_strategy_report.docx")
    doc.save(path)
    return path
