"""Country Research Agent — produces investment-bank-quality country/state profiles.

Generates both structured data AND a comprehensive 15-20 page narrative report
suitable for CEOs, heads of state, and institutional investors.
Uses multi-call generation to achieve the necessary depth and length.
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
from services.humanizer import humanize_report
from config import OUTPUT_DIR
from config.rules_loader import (
    classify_tier as classify_country_tier,
    get_state_spending_data,
    get_spending_spotlight_national_trends,
)

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


SYNTHESIS_PROMPT = """You are a senior research analyst at Goldman Sachs synthesising country data
into a structured profile. Extract specific numbers wherever available. If a data point is not
available, provide your best estimate and note it. Output a JSON matching the CountryProfile schema."""

# ---------------------------------------------------------------------------
# Multi-section report prompts — each call generates 2-4 pages
# ---------------------------------------------------------------------------

SECTION_1_PROMPT = """You are a senior research analyst at Goldman Sachs / J.P. Morgan writing the
FIRST PART of a comprehensive country research report for **{target}**.

You are writing for an audience of CEOs, sovereign wealth fund managers, and heads of state
evaluating a $1B+ education partnership with 2hr Learning (Alpha).

## Context Data
{data_context}

## Write EXACTLY these sections:

# Country Research Report: {target}

## 1. Executive Summary
Write 5-6 paragraphs providing a complete synthesis of the investment opportunity. Cover:
- Macroeconomic positioning and trajectory
- Education sector opportunity (market size, growth, gaps)
- Regulatory environment for foreign education operators
- Recommended entry strategy and partnership structure
- Key risks and mitigants
- Expected financial returns parameters

## 2. Macroeconomic Overview

### 2.1 Economic Performance
Create a detailed table:

| Indicator | Value | Source | Year |
|-----------|-------|--------|------|
| Nominal GDP | ... | ... | ... |
| GDP per Capita (USD) | ... | ... | ... |
| Real GDP Growth (5-yr avg) | ... | ... | ... |
| GDP Growth Forecast (next 3 yrs) | ... | ... | ... |
| Inflation Rate | ... | ... | ... |
| Unemployment Rate | ... | ... | ... |
| Current Account Balance (% GDP) | ... | ... | ... |
| Government Debt (% GDP) | ... | ... | ... |
| Sovereign Credit Rating | ... | ... | ... |
| FX Rate to USD | ... | ... | ... |
| FDI Inflows (annual) | ... | ... | ... |

Write 3-4 paragraphs analysing the economic trajectory, fiscal position, and implications for
a long-term education investment. Compare to regional peers.

### 2.2 Sovereign Wealth & Investment Capacity
Detail sovereign wealth funds (name, AUM, mandate), government investment capacity,
appetite for education sector investments, precedent deals.

### 2.3 Currency & FX Considerations
Currency stability analysis, hedging considerations, dollarisation factors.

**⚡ Alpha Relevance:** What does the economic profile mean for per-student budget sizing,
pricing strategy, and upfront deal commitment capacity?

## 3. Demographics & Social Indicators

### 3.1 Population Profile
Create a detailed table:

| Indicator | Value | Source |
|-----------|-------|--------|
| Total Population | ... | ... |
| Population Growth Rate | ... | ... |
| Population aged 0-4 | ... | ... |
| Population aged 5-14 | ... | ... |
| Population aged 15-18 | ... | ... |
| Total School-Age (0-18) | ... | ... |
| Median Age | ... | ... |
| Urbanisation Rate | ... | ... |
| Fertility Rate | ... | ... |

Write 3-4 paragraphs on demographic trends, the youth bulge (if any), urbanisation patterns,
and what this means for school demand projections.

### 3.2 Income Distribution & Affordability
Create a table:

| Income Segment | % of Population | Household Income Range | Education Spend Capacity |
|---------------|-----------------|----------------------|------------------------|
| Ultra-High Net Worth | ... | ... | ... |
| Affluent | ... | ... | ... |
| Upper-Middle Class | ... | ... | ... |
| Middle Class | ... | ... | ... |
| Lower-Middle Class | ... | ... | ... |

Write 3 paragraphs on income inequality, middle class growth trajectory, Gini coefficient,
and willingness/ability to pay for premium education.

**⚡ Alpha Relevance:** Which income segments are addressable at Alpha's price points
($15K-$50K per student)?

IMPORTANT: Be exhaustive. Use specific numbers with sources. Write at least 2,500 words for this section.
Every data point should include the source and year. If exact data is unavailable, provide
clearly-labelled estimates based on available proxies. Write analytically, not descriptively."""

SECTION_2_PROMPT = """You are continuing the Goldman Sachs country research report for **{target}**.
You are writing sections 4-6. The audience is CEOs and sovereign fund managers.

## Context Data
{data_context}

Write EXACTLY these sections (continue from section 3):

## 4. Education Sector Deep Dive

### 4.1 System Overview
Create a summary table:

| Indicator | Value | Source |
|-----------|-------|--------|
| Total K-12 Students | ... | ... |
| Public School Students | ... | ... |
| Private School Students | ... | ... |
| Public/Private Split | ... | ... |
| Number of Schools | ... | ... |
| Number of Teachers | ... | ... |
| Student-Teacher Ratio | ... | ... |
| Government Education Budget | ... | ... |
| Education Spend (% of GDP) | ... | ... |
| Per-Student Public Spend | ... | ... |
| Compulsory Education Ages | ... | ... |
| Language of Instruction | ... | ... |
| Academic Calendar | ... | ... |

Write 4-5 paragraphs providing a comprehensive overview of the education system architecture.

### 4.2 Learning Outcomes & Quality Assessment
Create a table:

| Assessment | Score | Global Ranking | Peer Comparison |
|-----------|-------|----------------|-----------------|
| PISA Reading | ... | ... | ... |
| PISA Mathematics | ... | ... | ... |
| PISA Science | ... | ... | ... |
| TIMSS Grade 4 | ... | ... | ... |
| TIMSS Grade 8 | ... | ... | ... |
| Literacy Rate | ... | ... | ... |
| Numeracy Rate | ... | ... | ... |
| Net Enrollment Rate (Primary) | ... | ... | ... |
| Net Enrollment Rate (Secondary) | ... | ... | ... |
| Dropout Rate | ... | ... | ... |
| Tertiary Enrollment Rate | ... | ... | ... |

Write 3-4 paragraphs analysing learning outcomes vs. peer countries, skills gaps, and
what this means for the case for education reform.

### 4.3 Private Education Market
Create a table:

| Segment | Est. Market Size | Growth Rate | Avg Tuition | Student Count |
|---------|-----------------|-------------|-------------|---------------|
| Ultra-Premium International | ... | ... | ... | ... |
| Premium Private | ... | ... | ... | ... |
| Mid-Market Private | ... | ... | ... | ... |
| Budget Private | ... | ... | ... | ... |
| Total Private Market | ... | ... | ... | ... |

Write 4-5 paragraphs on the private education market: market size ($), growth rate,
segmentation, parent willingness to pay, unmet demand, market gaps.

**⚡ Alpha Relevance:** Where does Alpha's pricing ($15K-$50K) position within this market?
What is the addressable segment?

### 4.4 Teacher Workforce
Teacher qualifications, compensation, shortages, training infrastructure, teacher
satisfaction. Include comparative data.

## 5. Regulatory & Political Environment

### 5.1 Governance Structure
Government type, education ministry structure, key decision-makers by name and role.

### 5.2 Private School Regulation
Create a table:

| Regulatory Factor | Details |
|-------------------|---------|
| Licensing Authority | ... |
| Licensing Process | ... |
| Licensing Timeline | ... |
| Capital Requirements | ... |
| Foreign Ownership Cap | ... |
| Curriculum Requirements | ... |
| Teacher Certification | ... |
| Inspection Regime | ... |
| Land/Building Requirements | ... |
| Tax Treatment | ... |

Write 3-4 paragraphs analysing the regulatory pathway for a foreign education operator.

### 5.3 Political Context
Write 3 paragraphs on political stability, national vision plans relevant to education,
government education reform priorities, key political risks.

**⚡ Alpha Relevance:** What regulatory concessions would Alpha need? What is the likely
timeline from partnership agreement to first school opening?

## 6. Competitive Landscape

### 6.1 Major Operators
Create a detailed competitor table:

| Operator | Type | Schools | Students | Tuition Range | Curriculum | Key Differentiator |
|----------|------|---------|----------|---------------|------------|-------------------|
| ... | ... | ... | ... | ... | ... | ... |

Include at least 8-10 operators.

Write 4-5 paragraphs on competitive dynamics, market concentration, barriers to entry,
competitive positioning opportunities for Alpha.

### 6.2 EdTech Landscape
Major edtech players, adoption rates, government edtech initiatives.

**⚡ Alpha Relevance:** How does Alpha's integrated model (AI + curriculum + teacher training)
differentiate from existing competitors? What is the competitive moat?

IMPORTANT: Be exhaustive. At least 3,000 words. Every data point cited. Analytical, not descriptive."""

SECTION_3_PROMPT = """You are completing the Goldman Sachs country research report for **{target}**.
You are writing sections 7-10 (final sections). The audience is CEOs and sovereign fund managers.

## Context Data
{data_context}

Write EXACTLY these sections:

## 7. Market Opportunity Sizing

### 7.1 Total Addressable Market (TAM)
Calculate and present the TAM with methodology:

| Component | Calculation | Value |
|-----------|------------|-------|
| Total K-12 students | ... | ... |
| Students in target income segments | ... | ... |
| Average revenue per student (blended) | ... | ... |
| **Total TAM** | ... | **$...** |

### 7.2 Serviceable Addressable Market (SAM)
Factor in Alpha's specific positioning:

| Filter | Rationale | SAM Students | SAM Revenue |
|--------|-----------|-------------|-------------|
| Income-qualified families | ... | ... | ... |
| Urban/accessible geographies | ... | ... | ... |
| Openness to innovation | ... | ... | ... |
| **SAM** | ... | **...** | **$...** |

### 7.3 Penetration Scenarios

| Scenario | Penetration Rate | Students (Yr 5) | Revenue (Yr 5) | Key Assumptions |
|----------|-----------------|-----------------|-----------------|-----------------|
| Conservative | ... | ... | ... | ... |
| Base Case | ... | ... | ... | ... |
| Aggressive | ... | ... | ... | ... |

Write 4-5 paragraphs on the market sizing methodology, key assumptions,
comparison to the UAE deal (200K students, $1.5B commitment), and scalability thesis.

**⚡ Alpha Relevance:** How does this market compare to the UAE reference deal? What scaling
factor should be applied?

## 8. Risk Assessment

Create a comprehensive risk register:

| Risk Category | Specific Risk | Probability | Impact | Mitigation Strategy |
|--------------|--------------|------------|--------|-------------------|
| Regulatory | Licensing delays | ... | ... | ... |
| Regulatory | Curriculum restrictions | ... | ... | ... |
| Political | Government change | ... | ... | ... |
| Political | Policy reversal | ... | ... | ... |
| Financial | FX depreciation | ... | ... | ... |
| Financial | Pricing pressure | ... | ... | ... |
| Operational | Teacher recruitment | ... | ... | ... |
| Operational | Quality consistency | ... | ... | ... |
| Competitive | Incumbent response | ... | ... | ... |
| Competitive | New entrants | ... | ... | ... |
| Cultural | Resistance to AI | ... | ... | ... |
| Cultural | Traditional education values | ... | ... | ... |
| Reputational | Regulatory non-compliance | ... | ... | ... |
| Macroeconomic | Recession impact | ... | ... | ... |

Include at least 12-14 specific risks. Write 4-5 paragraphs providing a narrative assessment
of the overall risk profile, key interdependencies, and recommended risk mitigation framework.

## 9. Alpha-Specific Strategic Implications

### 9.1 Tier Classification & Rationale
Explain the tier classification with a scoring table:

| Factor | Score (1-5) | Rationale |
|--------|------------|-----------|
| Economic capacity | ... | ... |
| Demographic opportunity | ... | ... |
| Education market readiness | ... | ... |
| Regulatory accessibility | ... | ... |
| Political stability | ... | ... |
| Competitive landscape | ... | ... |
| Cultural receptiveness | ... | ... |
| **Overall Tier** | ... | **Tier X** |

### 9.2 Recommended Entry Mode
Detailed comparison table:

| Factor | Private Entry | Government Partnership | Hybrid Model |
|--------|--------------|----------------------|-------------|
| Speed to market | ... | ... | ... |
| Scale potential | ... | ... | ... |
| Revenue per student | ... | ... | ... |
| Regulatory complexity | ... | ... | ... |
| Capital required | ... | ... | ... |
| Political risk | ... | ... | ... |
| Sustainability | ... | ... | ... |
| **Recommendation** | ... | ... | **✓** |

### 9.3 Deal Structure Implications
Write 3-4 paragraphs on:
- Recommended upfront commitment (scaled from UAE $1.5B baseline)
- Per-student budget (PPP-adjusted from $25K UAE baseline)
- Partnership structure (JV ownership, IP rights, cultural layer)
- Key terms and conditions to negotiate

### 9.4 Localisation Requirements
Specific requirements for curriculum, language, cultural values, mandatory subjects,
teacher certification, facility standards.

**⚡ Alpha Relevance:** Provide a clear, actionable summary of the recommended approach
including specific dollar figures, student count targets, and timeline.

## 10. Sources & Data Notes
List all sources used with dates, note any estimates or proxies used, and flag any data
gaps that should be addressed through on-the-ground due diligence.

IMPORTANT: Be exhaustive. At least 2,500 words. This is the final section of a report that
will be presented to heads of state. Every number must be cited. Every recommendation must
be supported by data."""

REPORT_REVISION_PROMPT = """You are revising a country research report based on user feedback.

Here is the original report:

{original_report}

Here is the user's feedback:

{feedback}

Produce a revised version of the FULL report incorporating the feedback. Maintain the same
high quality, structure, depth, tables, and ⚡ Alpha Relevance callouts. Do not shorten or
summarise — the revised report must be at least as long as the original."""


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

    # Tier classification — use YAML config first, fallback to heuristic
    if target_type == TargetType.SOVEREIGN_NATION:
        yaml_tier = classify_country_tier(
            target, profile.economy.gdp_per_capita, profile.demographics.total_population
        )
        profile.target.tier = yaml_tier or _classify_tier(
            profile.economy.gdp_per_capita, profile.demographics.total_population
        )
    if not profile.target.region:
        profile.target.region = "North America" if target_type == TargetType.US_STATE else ""

    # --- Populate US state education data from Spending Spotlight ---
    spending_spotlight_context = ""
    if target_type == TargetType.US_STATE:
        ss_data = get_state_spending_data(target)
        national = get_spending_spotlight_national_trends()
        if ss_data:
            # Backfill structured profile with Spending Spotlight data
            if not profile.education.k12_enrolled and ss_data.get("k12_enrollment"):
                profile.education.k12_enrolled = ss_data["k12_enrollment"]
            if not profile.education.avg_public_spend_per_student and ss_data.get("per_pupil_spending"):
                profile.education.avg_public_spend_per_student = ss_data["per_pupil_spending"]
            if not profile.education.student_teacher_ratio and ss_data.get("student_teacher_ratio"):
                profile.education.student_teacher_ratio = ss_data["student_teacher_ratio"]
            if not profile.education.teacher_count and ss_data.get("k12_enrollment") and ss_data.get("student_teacher_ratio"):
                profile.education.teacher_count = round(
                    ss_data["k12_enrollment"] / ss_data["student_teacher_ratio"]
                )

            spending_spotlight_context = (
                f"\n\n**K-12 Spending Spotlight Data (Reason Foundation, 2002-2023):**\n"
                f"Source: https://spending-spotlight.reason.org\n"
                f"- Per-pupil spending: ${ss_data.get('per_pupil_spending', 'N/A'):,} "
                f"(national avg: ${national.get('per_pupil_spending', {}).get('national_average_2023', 20322):,})\n"
                f"- Spending rank: #{ss_data.get('spending_rank', 'N/A')} nationally\n"
                f"- K-12 enrollment: {ss_data.get('k12_enrollment', 'N/A'):,}\n"
                f"- Average teacher salary: ${ss_data.get('avg_teacher_salary', 'N/A'):,} "
                f"(national avg: ${national.get('teacher_salary', {}).get('avg_2022', 70548):,})\n"
                f"- Student-teacher ratio: {ss_data.get('student_teacher_ratio', 'N/A')}\n"
                f"- Revenue per pupil: ${ss_data.get('revenue_per_pupil', 'N/A'):,}\n"
                f"- Instructional spending share: {ss_data.get('instructional_spending_pct', 'N/A')}%\n"
                f"- Benefit spending per pupil: ${ss_data.get('benefit_spending_per_pupil', 'N/A'):,}\n"
                f"- Enrollment change (2020-2023): {ss_data.get('enrollment_change_2020_2023_pct', 'N/A')}%\n"
                f"- NAEP 4th grade reading proficient: {ss_data.get('naep_4th_reading_proficient_pct', 'N/A')}%\n"
                f"- NAEP 4th grade math proficient: {ss_data.get('naep_4th_math_proficient_pct', 'N/A')}%\n"
                f"- NAEP 8th grade reading proficient: {ss_data.get('naep_8th_reading_proficient_pct', 'N/A')}%\n"
                f"- NAEP 8th grade math proficient: {ss_data.get('naep_8th_math_proficient_pct', 'N/A')}%\n"
                f"\n**National Benchmarks (Spending Spotlight 2025):**\n"
                f"- Per-pupil spending rose 35.8% nationally (2002-2023) yet outcomes stagnated\n"
                f"- Avg teacher salary fell 6.1% despite increased spending\n"
                f"- Non-teaching staff grew 22.8% vs 4.1% enrollment growth\n"
                f"- Benefit spending per pupil rose 81.1% (pension debt)\n"
                f"- ~40% of 4th graders below basic reading level (NAEP)\n"
                f"- 39 states saw enrollment decline (2020-2023)\n"
            )

    # --- Build data context for report prompts ---
    data_context = (
        f"**World Bank Data:**\n{wb_data}\n\n"
        f"**Live Research (Perplexity Sonar Deep Research):**\n{research_text}\n\n"
        f"**Citations:**\n{chr(10).join(str(c) for c in citations)}"
        f"{spending_spotlight_context}"
    )

    # --- Generate narrative report ---
    if feedback and previous_report:
        # Revision mode — single call
        report_md = await call_llm_plain(
            system_prompt=REPORT_REVISION_PROMPT.format(
                original_report=previous_report, feedback=feedback
            ),
            user_prompt=f"Revise the full report for {target} incorporating the feedback above.",
        )
    else:
        # Fresh report — multi-call for length and depth
        logger.info("Generating report section 1/3 for %s", target)
        section_1 = await call_llm_plain(
            system_prompt=SECTION_1_PROMPT.format(target=target, data_context=data_context),
            user_prompt=f"Write sections 1-3 of the country research report for {target}. Be exhaustive and data-rich.",
        )

        logger.info("Generating report section 2/3 for %s", target)
        section_2 = await call_llm_plain(
            system_prompt=SECTION_2_PROMPT.format(target=target, data_context=data_context),
            user_prompt=f"Write sections 4-6 of the country research report for {target}. Be exhaustive and data-rich.",
        )

        logger.info("Generating report section 3/3 for %s", target)
        section_3 = await call_llm_plain(
            system_prompt=SECTION_3_PROMPT.format(target=target, data_context=data_context),
            user_prompt=f"Write sections 7-10 of the country research report for {target}. Be exhaustive and data-rich.",
        )

        report_md = section_1 + "\n\n" + section_2 + "\n\n" + section_3

    # --- Humanize: remove AI writing patterns ---
    logger.info("Humanizing country report for %s", target)
    report_md = await humanize_report(report_md)

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
            doc.add_paragraph(stripped, style="Normal")
        elif stripped:
            doc.add_paragraph(stripped)

    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_country_report.docx")
    doc.save(path)
    return path


def _merge_profiles(base: CountryProfile, synth: CountryProfile) -> None:
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

    if synth.competitive_landscape.major_operators:
        base.competitive_landscape.major_operators = synth.competitive_landscape.major_operators
    for f in ("international_chains", "edtech_penetration", "market_gaps"):
        if getattr(synth.competitive_landscape, f):
            setattr(base.competitive_landscape, f, getattr(synth.competitive_landscape, f))

    if synth.us_state_esa and base.us_state_esa is None:
        base.us_state_esa = synth.us_state_esa
    if not base.target.region and synth.target.region:
        base.target.region = synth.target.region
