"""Country Research Agent — produces investment-bank-quality country/state profiles.

Generates both structured data AND a comprehensive narrative report suitable
for CEOs, heads of state, and institutional investors.
"""

from __future__ import annotations

import logging
import os

from docx import Document as DocxDocument
from docx.shared import Pt as DocxPt
from docx.enum.text import WD_ALIGN_PARAGRAPH

from models.schemas import (
    CountryProfile, TargetInfo, TargetType, TierClassification,
    Demographics, Economy, EducationData, Regulatory, PoliticalContext,
    CompetitiveLandscape, USStateESA,
)
from services.llm import call_llm, call_llm_plain
from services.perplexity import research_country, research_us_state
from services.world_bank import get_country_data
from config import OUTPUT_DIR

logger = logging.getLogger(__name__)

US_STATES = {
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
    "maine", "maryland", "massachusetts", "michigan", "minnesota",
    "mississippi", "missouri", "montana", "nebraska", "nevada",
    "new hampshire", "new jersey", "new mexico", "new york",
    "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
    "pennsylvania", "rhode island", "south carolina", "south dakota",
    "tennessee", "texas", "utah", "vermont", "virginia", "washington",
    "west virginia", "wisconsin", "wyoming", "district of columbia",
}


def _detect_target_type(target: str) -> TargetType:
    if target.lower().strip() in US_STATES:
        return TargetType.US_STATE
    return TargetType.SOVEREIGN_NATION


def _classify_tier(gdp_per_capita: float | None, population: float | None) -> TierClassification:
    if gdp_per_capita is None:
        return TierClassification.TIER_2
    if gdp_per_capita > 30_000 and (population is None or population > 1_000_000):
        return TierClassification.TIER_1
    elif gdp_per_capita >= 10_000 or (population is not None and population > 50_000_000):
        return TierClassification.TIER_2
    else:
        return TierClassification.TIER_3


# ---------------------------------------------------------------------------
# System prompt for structured data synthesis
# ---------------------------------------------------------------------------
SYNTHESIS_PROMPT = """You are a senior research analyst at Goldman Sachs synthesising country data
into a structured profile. Extract specific numbers wherever available. If a data point is not
available, provide your best estimate and note it. Output a JSON matching the CountryProfile schema."""

# ---------------------------------------------------------------------------
# System prompt for the narrative report
# ---------------------------------------------------------------------------
REPORT_PROMPT = """You are a senior research analyst at a top-tier investment bank (Goldman Sachs / Morgan Stanley / J.P. Morgan).

You are writing a comprehensive country research report for **{target}** that will be read by
CEOs, sovereign wealth fund managers, and heads of state considering a major education
partnership with 2hr Learning (Alpha).

## About Alpha / 2hr Learning

Alpha's education operating system includes:
- **Timeback**: AI-powered learning platform compressing core academics into 2 hours/day
- **AlphaCore**: Core curriculum and learning management system
- **Guide School**: Transforms traditional teachers into facilitative "Guides"
- **Incept eduLLM**: Custom education-focused large language model

The UAE deal (Ed71/Next71) is the reference: $1.5B upfront, 200K students over 5 years,
$25K per-student budget, JV structure with local entity (AsasOne) owning cultural IP layer.

## Report Requirements

Write an exhaustive, data-rich research report in **markdown** format with the following sections.
Every section must include specific numbers, dates, and cited data points. Use tables for
comparative data. Highlight items of specific relevance to Alpha's education model with
**⚡ Alpha Relevance:** callouts.

### Required Sections

1. **Executive Summary** — 3-4 paragraph overview of key findings and investment thesis
2. **Macroeconomic Overview** — GDP, growth trajectory, fiscal position, currency, inflation,
   sovereign credit rating, sovereign wealth funds, FDI environment
3. **Demographics & Social Indicators** — Population pyramid, school-age cohort, urbanisation,
   income distribution by decile, Gini coefficient, middle class growth
4. **Education Sector Deep Dive** — K-12 enrollment, public/private split, spend per student,
   tuition ranges (mass market through ultra-premium), teacher workforce, student-teacher
   ratios, PISA/assessment scores, literacy/numeracy gaps, dropout rates, language of
   instruction, mandatory curriculum
5. **Regulatory & Political Landscape** — Government structure, key decision-makers,
   education ministry, private school licensing process and timeline, foreign ownership rules
   and caps, charter/PPP frameworks, curriculum flexibility, political stability assessment
6. **Private Education Market** — Market size ($), growth rate, major operators (with
   student counts and tuition ranges), international school chains, market gaps,
   parent willingness to pay, edtech penetration
7. **Market Opportunity Sizing** — Total addressable market, serviceable addressable market
   at Alpha's price points, penetration scenarios (conservative/base/aggressive)
8. **Risk Assessment** — Regulatory risk, political risk, FX risk, competitive risk,
   execution risk, cultural risk — each rated High/Medium/Low with mitigation strategies
9. **Alpha-Specific Implications** — Tier classification rationale, recommended entry mode,
   partnership structure considerations, localisation requirements, pricing strategy
   implications, competitive positioning, key success factors
10. **Key Data Tables** — Summary tables of all critical metrics
11. **Sources** — All data sources with dates

For US states, adapt the structure to focus on: ESA/voucher landscape (program name, amount,
eligibility, growth trajectory), charter school penetration, homeschool population, regulatory
environment for new school models, competitor landscape, demographic targeting.

## Formatting Rules
- Use markdown headers (## for sections, ### for subsections)
- Use markdown tables for data comparisons
- Use **bold** for key figures and **⚡ Alpha Relevance:** for Alpha-specific insights
- Use bullet points for lists of findings
- Be analytical, not descriptive — every paragraph should advance an argument
- Minimum 3,000 words
- Write as if presenting to a board of directors
"""

REPORT_REVISION_PROMPT = """You are revising a country research report based on user feedback.

Here is the original report:

{original_report}

Here is the user's feedback:

{feedback}

Produce a revised version of the full report incorporating the feedback. Maintain the same
high quality, structure, and depth. Keep all data tables and ⚡ Alpha Relevance callouts."""


async def run_country_research(
    target: str,
    feedback: str | None = None,
    previous_report: str | None = None,
) -> tuple[CountryProfile, str, str]:
    """Execute the country research pipeline.

    Returns (profile, report_markdown, report_docx_path).
    """
    target_type = _detect_target_type(target)
    logger.info("Researching %s (type: %s)", target, target_type.value)

    # --- Data gathering ---
    if target_type == TargetType.US_STATE:
        perplexity_result = await research_us_state(target)
        wb_data: dict = {}
    else:
        perplexity_result = await research_country(target)
        wb_data = await get_country_data(target)

    research_text = perplexity_result.get("answer", "")
    citations = perplexity_result.get("citations", [])

    # --- Build structured profile ---
    profile = CountryProfile()
    profile.target = TargetInfo(name=target, type=target_type, region="")
    if isinstance(citations, list):
        profile.research_sources = [str(c) for c in citations]

    # Populate from World Bank
    if wb_data:
        profile.demographics.total_population = wb_data.get("population")
        profile.demographics.population_0_18 = wb_data.get("population_0_14")
        profile.demographics.growth_rate = wb_data.get("population_growth")
        profile.demographics.urbanisation = wb_data.get("urbanization")
        profile.demographics.gini_coefficient = wb_data.get("gini")
        profile.economy.gdp = wb_data.get("gdp")
        profile.economy.gdp_per_capita = wb_data.get("gdp_per_capita")
        profile.economy.gdp_growth_rate = wb_data.get("gdp_growth")
        profile.economy.inflation = wb_data.get("inflation")
        profile.education.literacy_rate = wb_data.get("literacy")
        profile.education.education_budget_pct_gdp = wb_data.get("education_spend_pct_gdp")
        profile.education.student_teacher_ratio = wb_data.get("pupil_teacher_ratio_primary")

    # LLM synthesis for structured data
    try:
        synth: CountryProfile = await call_llm(
            system_prompt=SYNTHESIS_PROMPT,
            user_prompt=f"Target: {target} ({target_type.value})\nWorld Bank: {wb_data}\nResearch: {research_text}",
            output_schema=CountryProfile,
        )
        _merge_profiles(profile, synth)
    except Exception as exc:
        logger.warning("Structured synthesis failed: %s", exc)

    # Tier classification
    if target_type == TargetType.SOVEREIGN_NATION:
        profile.target.tier = _classify_tier(
            profile.economy.gdp_per_capita, profile.demographics.total_population
        )
    if not profile.target.region:
        profile.target.region = "North America" if target_type == TargetType.US_STATE else ""

    # --- Generate narrative report ---
    if feedback and previous_report:
        # Revision mode
        report_md = await call_llm_plain(
            system_prompt=REPORT_REVISION_PROMPT.format(
                original_report=previous_report, feedback=feedback
            ),
            user_prompt=f"Revise the report for {target} incorporating the feedback above.",
        )
    else:
        # Fresh report
        report_md = await call_llm_plain(
            system_prompt=REPORT_PROMPT.format(target=target),
            user_prompt=(
                f"Write the full country research report for **{target}**.\n\n"
                f"Use the following verified data sources:\n\n"
                f"**World Bank Data:**\n{wb_data}\n\n"
                f"**Live Research (Perplexity Sonar):**\n{research_text}\n\n"
                f"**Citations:**\n{chr(10).join(str(c) for c in citations)}\n\n"
                f"Produce the complete research report following all formatting requirements."
            ),
        )

    # --- Save report as DOCX ---
    docx_path = _save_report_docx(target, report_md, "Country Research Report")

    logger.info("Country research complete: %s (tier=%s)", target, profile.target.tier)
    return profile, report_md, docx_path


def _save_report_docx(target: str, markdown: str, title: str) -> str:
    """Save a markdown report as a basic DOCX file."""
    doc = DocxDocument()
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = DocxPt(11)

    heading = doc.add_heading(f"{title}: {target}", level=0)
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph("CONFIDENTIAL & PROPRIETARY — 2hr Learning (Alpha)").alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_page_break()

    # Simple markdown → docx conversion
    for line in markdown.split("\n"):
        stripped = line.strip()
        if stripped.startswith("# "):
            doc.add_heading(stripped[2:], level=1)
        elif stripped.startswith("## "):
            doc.add_heading(stripped[3:], level=2)
        elif stripped.startswith("### "):
            doc.add_heading(stripped[4:], level=3)
        elif stripped.startswith("- ") or stripped.startswith("* "):
            doc.add_paragraph(stripped[2:], style="List Bullet")
        elif stripped.startswith("|"):
            # Table rows — add as plain text for now
            doc.add_paragraph(stripped, style="Normal")
        elif stripped:
            doc.add_paragraph(stripped)

    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_country_report.docx")
    doc.save(path)
    return path


def _merge_profiles(base: CountryProfile, synth: CountryProfile) -> None:
    """Merge synthesised data into base, preferring existing World Bank data."""
    for model_cls, attr in [
        (Demographics, "demographics"), (Economy, "economy"),
        (EducationData, "education"), (Regulatory, "regulatory"),
        (PoliticalContext, "political_context"),
    ]:
        base_obj = getattr(base, attr)
        synth_obj = getattr(synth, attr)
        for field in model_cls.model_fields:
            if getattr(base_obj, field) is None and getattr(synth_obj, field) is not None:
                setattr(base_obj, field, getattr(synth_obj, field))

    # Competitive landscape
    if synth.competitive_landscape.major_operators:
        base.competitive_landscape.major_operators = synth.competitive_landscape.major_operators
    for f in ("international_chains", "edtech_penetration", "market_gaps"):
        if getattr(synth.competitive_landscape, f):
            setattr(base.competitive_landscape, f, getattr(synth.competitive_landscape, f))

    if synth.us_state_esa and base.us_state_esa is None:
        base.us_state_esa = synth.us_state_esa
    if not base.target.region and synth.target.region:
        base.target.region = synth.target.region
