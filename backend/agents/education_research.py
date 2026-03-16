"""Education System Research Agent — produces McKinsey-quality 15-20 page education sector analysis.

Deep-dives into the education system, diagnoses what's broken, maps the reform landscape,
and identifies where 2hr Learning's model creates the sharpest differentiation.
Uses multi-call generation for comprehensive depth.
"""

from __future__ import annotations

import logging
import os

from docx import Document as DocxDocument
from docx.shared import Pt as DocxPt
from docx.enum.text import WD_ALIGN_PARAGRAPH

from models.schemas import (
    EducationAnalysis, SystemDiagnosis, ReformLandscape, TwoHrLearningFit,
    EntryMode, CountryProfile, TargetType,
)
from services.llm import call_llm, call_llm_plain
from services.perplexity import research_education
from services.humanizer import humanize_report
from config import OUTPUT_DIR
from config.rules_loader import (
    get_state_spending_data,
    get_spending_spotlight_national_trends,
    get_spending_spotlight_alpha_insights,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Multi-section prompts
# ---------------------------------------------------------------------------

SECTION_1_PROMPT = """You are a senior partner at McKinsey & Company's Global Education Practice
writing the FIRST PART of a comprehensive education system analysis for **{target}**.

This report will be read by CEOs, education ministers, and sovereign wealth fund managers
evaluating a $1B+ partnership with 2hr Learning (Alpha).

## About Alpha / 2hr Learning
- **Timeback**: AI platform compressing core academics into 2 hours/day
- **AlphaCore**: Curriculum OS and learning management system
- **Guide School**: 12-month program transforming teachers into facilitative "Guides"
- **Incept eduLLM**: Custom education AI model adapted to local curriculum and culture
- Alpha's three commitments: children love school, learn 2x faster, develop AI-age life skills
- UAE reference: $1.5B, 200K students, $25K/student, JV with local cultural IP layer

## Context Data
{data_context}

## Write EXACTLY these sections:

# Education System Analysis: {target}

## 1. Executive Summary
Write 5-6 paragraphs synthesising:
- Current state of the education system (quality, equity, efficiency)
- Critical pain points across all stakeholders
- Reform landscape and government appetite for innovation
- Alpha's specific fit and value proposition
- Recommended approach and expected impact
- Key risks and success factors

## 2. Education System Architecture

### 2.1 System Structure Overview
Create a comprehensive table:

| Element | Details |
|---------|---------|
| Education Ministry | ... |
| Governance Model | Centralised / Decentralised / Mixed |
| Compulsory Education | Ages X to Y |
| System Structure | ... years primary + ... years secondary |
| National Curriculum | ... |
| Language of Instruction | ... |
| Assessment Framework | ... (national exams, continuous assessment) |
| School Calendar | ... (start month, term structure) |
| School Hours | ... |
| Grading System | ... |
| Teacher Certification | ... |
| Accreditation Bodies | ... |
| Private School Oversight | ... |

Write 4-5 paragraphs explaining the system architecture, recent structural reforms,
and key institutional dynamics.

### 2.2 Curriculum Framework
Detailed analysis of the national curriculum: mandatory subjects, elective options,
assessment methods, international curriculum options (IB, Cambridge, AP), flexibility
for innovation. Create a table comparing curriculum frameworks available.

### 2.3 Governance & Decision-Making
Who makes education policy decisions? Map the decision-making chain from ministry
to school level. Name specific individuals where possible.

## 3. Performance Assessment

### 3.1 Learning Outcomes
Create a detailed benchmarking table:

| Assessment | {target} Score | {target} Rank | Regional Avg | OECD Avg | Top Performer | Gap to Top |
|-----------|---------------|---------------|-------------|----------|--------------|-----------|
| PISA Reading | ... | ... | ... | ... | ... | ... |
| PISA Mathematics | ... | ... | ... | ... | ... | ... |
| PISA Science | ... | ... | ... | ... | ... | ... |
| TIMSS Grade 4 Math | ... | ... | ... | ... | ... | ... |
| TIMSS Grade 8 Math | ... | ... | ... | ... | ... | ... |
| PIRLS (Reading) | ... | ... | ... | ... | ... | ... |

Write 4-5 paragraphs analysing:
- Performance relative to economic peers (countries with similar GDP/capita)
- Trend analysis (improving, declining, stagnating)
- Subject-specific strengths and weaknesses
- Grade-level performance differences

### 3.2 Equity Analysis
Create a table:

| Equity Dimension | Gap Size | Details |
|-----------------|----------|---------|
| Urban vs. Rural | ... | ... |
| Male vs. Female | ... | ... |
| Top vs. Bottom Income Quintile | ... | ... |
| Public vs. Private | ... | ... |
| Native vs. Immigrant | ... | ... |
| Regional Disparities | ... | ... |

Write 3-4 paragraphs on equity gaps, their causes, and implications for Alpha's
market positioning.

### 3.3 Efficiency Metrics
Create a table:

| Metric | {target} | Regional Avg | OECD Avg | Assessment |
|--------|----------|-------------|----------|-----------|
| Spend per Student (USD) | ... | ... | ... | ... |
| Spend as % of GDP | ... | ... | ... | ... |
| Spend per PISA point | ... | ... | ... | ... |
| Student-Teacher Ratio | ... | ... | ... | ... |
| Graduation Rate | ... | ... | ... | ... |
| Dropout Rate | ... | ... | ... | ... |
| Repetition Rate | ... | ... | ... | ... |

Write 3 paragraphs on system efficiency — is the country getting value for its education spend?

**⚡ Alpha Relevance:** Where are the biggest outcome gaps? Alpha's "learn 2x faster"
commitment directly addresses which specific deficiencies?

IMPORTANT: Minimum 3,000 words. Every data point with source. Analytical, not descriptive.
Use peer country comparisons throughout."""

SECTION_2_PROMPT = """You are continuing the McKinsey education analysis for **{target}**.
Writing sections 4-6.

## Context Data
{data_context}

## Write EXACTLY these sections:

## 4. Stakeholder Pain Point Analysis

### 4.1 Student Pain Points
Create a table:

| Pain Point | Severity (1-5) | Evidence | Alpha Solution |
|-----------|----------------|----------|---------------|
| Disengagement / boredom | ... | ... | Timeback: 2hr core + specialisations |
| Rote learning / memorisation | ... | ... | AlphaCore: mastery-based progression |
| Mental health / stress | ... | ... | Timeback: reduced academic pressure |
| Future skills gap | ... | ... | Specialisation tracks (STEM, arts, etc.) |
| Irrelevant curriculum | ... | ... | AI-personalised learning paths |
| Long school hours | ... | ... | Timeback: 2hr core academics |
| Limited specialisation | ... | ... | Afternoon specialisation blocks |
| ... | ... | ... | ... |

Write 4-5 paragraphs with specific data on student satisfaction, engagement metrics,
mental health statistics, and skills mismatch with employer needs.

### 4.2 Parent Pain Points
Create a table:

| Pain Point | Income Segment Most Affected | Evidence | Alpha Solution |
|-----------|----------------------------|----------|---------------|
| Quality concerns | ... | ... | ... |
| Cost burden | ... | ... | ... |
| Aspirations gap | ... | ... | ... |
| Safety concerns | ... | ... | ... |
| Teacher quality | ... | ... | ... |
| University preparation | ... | ... | ... |
| 21st century skills | ... | ... | ... |
| ... | ... | ... | ... |

Write 3-4 paragraphs on parent concerns, spending patterns, decision-making factors
for school choice, and willingness to switch.

### 4.3 Government Pain Points
Create a table:

| Pain Point | Budget Impact | Political Urgency | Alpha Solution |
|-----------|-------------|-------------------|---------------|
| Outcome deficiency | ... | ... | ... |
| Fiscal pressure | ... | ... | ... |
| Teacher shortage | ... | ... | Guide School: transform existing teachers |
| Infrastructure gap | ... | ... | ... |
| Global competitiveness | ... | ... | ... |
| Youth unemployment | ... | ... | ... |
| Brain drain | ... | ... | ... |
| ... | ... | ... | ... |

Write 3-4 paragraphs on government education challenges, budget constraints,
political pressures, and how these create opportunity for a strategic partner like Alpha.

### 4.4 Employer / Economy Pain Points
Skills gap analysis: what do employers need vs. what schools produce?
Youth unemployment data, NEET rates, workforce readiness indices.

**⚡ Alpha Relevance:** Create a summary "pain-to-product" mapping showing which Alpha
product (Timeback, AlphaCore, Guide School, Incept eduLLM) solves which specific pain point.

## 5. Reform Landscape

### 5.1 Active Reforms & Initiatives
Create a table:

| Reform/Initiative | Budget | Timeline | Lead Agency | Status | Relevance to Alpha |
|------------------|--------|----------|-------------|--------|-------------------|
| ... | ... | ... | ... | ... | ... |

Include all significant reforms in the last 5 years and upcoming.

Write 4-5 paragraphs on the reform trajectory, government appetite for innovation,
precedent for foreign partnerships, budget allocation, and political commitment.

### 5.2 International Partnerships
List existing partnerships with international education organisations, bilateral
agreements, World Bank/UNESCO programs. What precedent exists for a deal like Alpha's?

### 5.3 EdTech Initiatives
Create a table of major EdTech initiatives — government and private:

| Initiative | Provider | Scale | Budget | Outcome | Lessons Learned |
|-----------|----------|-------|--------|---------|-----------------|
| ... | ... | ... | ... | ... | ... |

### 5.4 Failed Reforms & Lessons
What has been tried and failed? Why? What does this tell us about implementation risk?

## 6. Private Education Market Deep Dive

### 6.1 Market Sizing
Create a table:

| Segment | Market Size ($) | Annual Growth | # Schools | # Students | Avg Tuition |
|---------|----------------|--------------|-----------|-----------|-------------|
| International / Ultra-Premium | ... | ... | ... | ... | ... |
| Premium Private | ... | ... | ... | ... | ... |
| Mid-Market Private | ... | ... | ... | ... | ... |
| Budget / Low-Cost Private | ... | ... | ... | ... | ... |
| **Total** | ... | ... | ... | ... | ... |

### 6.2 Parent Willingness to Pay
Create a table by income segment:

| Income Segment | % of Parents | Max Annual Tuition | Decision Factors | Alpha Price Fit |
|---------------|-------------|-------------------|-----------------|----------------|
| Top 1% | ... | ... | ... | Premium tier |
| Top 5% | ... | ... | ... | ... |
| Top 10% | ... | ... | ... | ... |
| Top 20% | ... | ... | ... | Mid-tier |
| Top 40% | ... | ... | ... | ... |

Write 3-4 paragraphs on affordability, willingness to pay, and demand elasticity.

### 6.3 Unmet Demand Analysis
Write 3-4 paragraphs quantifying unmet demand: waitlists, underserved segments,
quality gaps at each price point, geographic gaps.

**⚡ Alpha Relevance:** What is the size of the unmet demand that Alpha can address?
At what price points?

IMPORTANT: Minimum 3,000 words. Data-rich with tables. Analytical."""

SECTION_3_PROMPT = """You are completing the McKinsey education analysis for **{target}**.
Writing sections 7-10 (final sections).

## Context Data
{data_context}

## Write EXACTLY these sections:

## 7. Technology & Innovation Readiness

### 7.1 Digital Infrastructure
Create a table:

| Indicator | Value | Ranking | Source |
|-----------|-------|---------|--------|
| Internet Penetration | ... | ... | ... |
| Mobile Penetration | ... | ... | ... |
| Broadband Speed (avg) | ... | ... | ... |
| School Internet Access | ... | ... | ... |
| Device-to-Student Ratio | ... | ... | ... |
| 4G/5G Coverage | ... | ... | ... |
| Cloud Infrastructure | ... | ... | ... |
| Data Protection Laws | ... | ... | ... |

### 7.2 EdTech Adoption
EdTech market size, key platforms, school adoption rates, teacher digital literacy,
AI policy for education.

### 7.3 AI Readiness
National AI strategy, AI in education policy, teacher and parent attitudes toward AI,
data privacy framework. Specific relevance to Incept eduLLM deployment.

**⚡ Alpha Relevance:** What infrastructure investments are needed to deploy Timeback
and Incept eduLLM? What is the implementation complexity?

## 8. Alpha Model Fit Analysis

### 8.1 Product-by-Product Assessment
Create a comprehensive fit table:

| Alpha Product | Pain Point Addressed | Fit Score (1-5) | Localisation Required | Competitive Advantage | Implementation Challenge |
|-------------|---------------------|-----------------|---------------------|---------------------|------------------------|
| Timeback | ... | ... | ... | ... | ... |
| AlphaCore | ... | ... | ... | ... | ... |
| Guide School | ... | ... | ... | ... | ... |
| Incept eduLLM | ... | ... | ... | ... | ... |
| **Integrated Model** | ... | ... | ... | ... | ... |

Write 5-6 paragraphs providing a detailed analysis of how each Alpha product maps to
specific pain points in the {target} education system. Be specific about:
- Which outcome gaps each product addresses
- What localisation is required (language, curriculum, cultural values)
- How Alpha's integrated model creates compound value vs. point solutions
- Competitive differentiation from existing operators

### 8.2 Recommended Entry Strategy
Write 4-5 paragraphs on:
- Private / Government / Hybrid recommendation with detailed rationale
- Target customer segments (by income, geography, school type)
- Pricing strategy (PPP-adjusted from UAE baseline)
- Regulatory pathway and timeline
- First-mover advantages and timing considerations

### 8.3 Competitive Positioning
How does Alpha's integrated model differentiate from:
- Traditional private schools
- International school chains
- EdTech platforms
- Government reform programs

## 9. Localisation Requirements

Create a comprehensive table:

| Dimension | Requirement | Complexity (H/M/L) | Timeline | Notes |
|-----------|------------|-------------------|----------|-------|
| Language | ... | ... | ... | ... |
| Core Curriculum | ... | ... | ... | ... |
| Cultural Values | ... | ... | ... | ... |
| National Identity | ... | ... | ... | ... |
| Religious Education | ... | ... | ... | ... |
| Mandatory Subjects | ... | ... | ... | ... |
| Assessment Standards | ... | ... | ... | ... |
| Teacher Certification | ... | ... | ... | ... |
| Facility Standards | ... | ... | ... | ... |
| Technology Standards | ... | ... | ... | ... |
| Data Privacy | ... | ... | ... | ... |
| Content Moderation | ... | ... | ... | ... |

Write 4-5 paragraphs on localisation strategy, referencing the AsasOne model from
the UAE deal as the template for cultural IP layer development.

**⚡ Alpha Relevance:** What is the estimated timeline and cost for localisation?
What are the non-negotiable localisation requirements vs. nice-to-haves?

## 10. Conclusions & Sources

### 10.1 Key Findings Summary
Bullet-point summary of the 10 most important findings from this analysis.

### 10.2 Recommended Next Steps
Numbered list of specific next steps for Alpha's executive team.

### 10.3 Sources & Data Notes
List all sources with dates. Note any estimates and data gaps.

IMPORTANT: Minimum 2,500 words. Data-rich. Analytical. This completes a report for
McKinsey's Global Education Practice leadership."""

REPORT_REVISION_PROMPT = """You are revising an education sector analysis based on user feedback.

Original report:
{original_report}

User feedback:
{feedback}

Produce a revised full report incorporating the feedback. Maintain the same depth,
data richness, tables, and ⚡ Alpha Relevance callouts. Do not shorten — must be
at least as long as the original."""


async def run_education_research(
    target: str,
    country_profile: CountryProfile,
    feedback: str | None = None,
    previous_report: str | None = None,
) -> tuple[EducationAnalysis, str, str]:
    """Execute education research. Returns (analysis, report_md, docx_path)."""
    logger.info("Running education research for %s", target)

    # --- Research ---
    perplexity_result = await research_education(target)
    research_text = perplexity_result.get("answer", "")
    citations = perplexity_result.get("citations", [])

    # --- Build context ---
    ctx_parts = [f"Target: {target}", f"Type: {country_profile.target.type.value}"]
    if country_profile.target.tier:
        ctx_parts.append(f"Tier: {country_profile.target.tier}")
    if country_profile.demographics.total_population:
        ctx_parts.append(f"Population: {country_profile.demographics.total_population:,.0f}")
    if country_profile.economy.gdp_per_capita:
        ctx_parts.append(f"GDP/cap: ${country_profile.economy.gdp_per_capita:,.0f}")
    if country_profile.education.k12_enrolled:
        ctx_parts.append(f"K-12 students: {country_profile.education.k12_enrolled:,.0f}")
    if country_profile.education.avg_private_tuition:
        ctx_parts.append(f"Avg private tuition: ${country_profile.education.avg_private_tuition:,.0f}")
    if country_profile.regulatory.foreign_ownership_rules:
        ctx_parts.append(f"Foreign ownership: {country_profile.regulatory.foreign_ownership_rules}")

    # --- Inject Spending Spotlight data for US states ---
    spending_spotlight_context = ""
    if country_profile.target.type == TargetType.US_STATE:
        ss_data = get_state_spending_data(target)
        national = get_spending_spotlight_national_trends()
        alpha_insights = get_spending_spotlight_alpha_insights()
        if ss_data:
            spending_spotlight_context = (
                f"\n\n**K-12 Spending Spotlight Data (Reason Foundation, 2002-2023):**\n"
                f"Source: https://spending-spotlight.reason.org\n"
                f"- Per-pupil spending: ${ss_data.get('per_pupil_spending', 'N/A'):,}\n"
                f"- Spending rank: #{ss_data.get('spending_rank', 'N/A')} nationally\n"
                f"- K-12 enrollment: {ss_data.get('k12_enrollment', 'N/A'):,}\n"
                f"- Average teacher salary: ${ss_data.get('avg_teacher_salary', 'N/A'):,}\n"
                f"- Student-teacher ratio: {ss_data.get('student_teacher_ratio', 'N/A')}\n"
                f"- Revenue per pupil: ${ss_data.get('revenue_per_pupil', 'N/A'):,}\n"
                f"- Instructional spending share: {ss_data.get('instructional_spending_pct', 'N/A')}%\n"
                f"- Benefit spending per pupil: ${ss_data.get('benefit_spending_per_pupil', 'N/A'):,}\n"
                f"- Enrollment change (2020-2023): {ss_data.get('enrollment_change_2020_2023_pct', 'N/A')}%\n"
                f"- NAEP 4th grade reading proficient: {ss_data.get('naep_4th_reading_proficient_pct', 'N/A')}%\n"
                f"- NAEP 4th grade math proficient: {ss_data.get('naep_4th_math_proficient_pct', 'N/A')}%\n"
                f"- NAEP 8th grade reading proficient: {ss_data.get('naep_8th_reading_proficient_pct', 'N/A')}%\n"
                f"- NAEP 8th grade math proficient: {ss_data.get('naep_8th_math_proficient_pct', 'N/A')}%\n"
            )
        if national:
            spending_spotlight_context += (
                f"\n**National Benchmarks (Spending Spotlight 2025):**\n"
                f"- National avg per-pupil spending: ${national.get('per_pupil_spending', {}).get('national_average_2023', 20322):,}\n"
                f"- Per-pupil spending rose {national.get('per_pupil_spending', {}).get('change_pct', 35.8)}% (2002-2023)\n"
                f"- Avg teacher salary (national): ${national.get('teacher_salary', {}).get('avg_2022', 70548):,}\n"
                f"- Teacher salary change: {national.get('teacher_salary', {}).get('change_pct', -6.1)}% (2002-2022)\n"
                f"- Non-teaching staff growth: {national.get('staffing', {}).get('non_teaching_staff_growth_pct', 22.8)}% vs {national.get('enrollment', {}).get('change_2002_2023_pct', 4.1)}% enrollment growth\n"
                f"- Benefit spending per pupil rose {national.get('employee_benefits', {}).get('change_pct', 81.1)}% (2002-2023)\n"
                f"- {national.get('enrollment', {}).get('states_with_decline_2020_2023', 39)} states saw enrollment decline (2020-2023)\n"
                f"- ~{national.get('student_outcomes', {}).get('naep_4th_grade_reading_below_basic_pct', 40)}% of 4th graders below basic reading level (NAEP)\n"
            )
        if alpha_insights:
            disconnect = alpha_insights.get("spending_vs_outcomes_disconnect", {})
            state_key = target.replace(" ", "_")
            priority = alpha_insights.get("priority_state_economics", {}).get(state_key, {})
            spending_spotlight_context += (
                f"\n**Alpha Strategic Insight (from Spending Spotlight data):**\n"
                f"- Core argument: {disconnect.get('summary', 'More spending has not led to better outcomes.')}\n"
            )
            if priority:
                spending_spotlight_context += (
                    f"- Alpha intervention cost: ${priority.get('alpha_intervention_cost', 2000):,}/student "
                    f"({priority.get('alpha_pct_of_per_pupil', 'N/A')}% of per-pupil spend)\n"
                    f"- Alpha full transformation: ${priority.get('alpha_full_transform_cost', 'N/A'):,}/student "
                    f"({priority.get('alpha_full_pct_of_per_pupil', 20)}% of per-pupil spend)\n"
                    f"- Pitch: {priority.get('argument', '')}\n"
                )

    data_context = (
        f"**Country Profile:**\n{chr(10).join(ctx_parts)}\n\n"
        f"**Live Research (Perplexity):**\n{research_text}\n\n"
        f"**Citations:**\n{chr(10).join(str(c) for c in citations)}"
        f"{spending_spotlight_context}"
    )

    # --- Structured analysis ---
    try:
        analysis: EducationAnalysis = await call_llm(
            system_prompt="Extract structured education analysis from the research data.",
            user_prompt=f"Context:\n{chr(10).join(ctx_parts)}\n\nResearch:\n{research_text}",
            output_schema=EducationAnalysis,
        )
    except Exception as exc:
        logger.warning("Structured analysis failed: %s", exc)
        analysis = EducationAnalysis(
            system_diagnosis=SystemDiagnosis(primary_pain_points=["Analysis pending"]),
            two_hr_learning_fit=TwoHrLearningFit(model_recommendation=EntryMode.HYBRID),
        )

    # --- Narrative report ---
    if feedback and previous_report:
        report_md = await call_llm_plain(
            system_prompt=REPORT_REVISION_PROMPT.format(
                original_report=previous_report, feedback=feedback
            ),
            user_prompt=f"Revise the education report for {target}.",
        )
    else:
        logger.info("Generating education report section 1/3 for %s", target)
        section_1 = await call_llm_plain(
            system_prompt=SECTION_1_PROMPT.format(target=target, data_context=data_context),
            user_prompt=f"Write sections 1-3 of the education system analysis for {target}.",
        )

        logger.info("Generating education report section 2/3 for %s", target)
        section_2 = await call_llm_plain(
            system_prompt=SECTION_2_PROMPT.format(target=target, data_context=data_context),
            user_prompt=f"Write sections 4-6 of the education system analysis for {target}.",
        )

        logger.info("Generating education report section 3/3 for %s", target)
        section_3 = await call_llm_plain(
            system_prompt=SECTION_3_PROMPT.format(target=target, data_context=data_context),
            user_prompt=f"Write sections 7-10 of the education system analysis for {target}.",
        )

        report_md = section_1 + "\n\n" + section_2 + "\n\n" + section_3

    # --- Humanize: remove AI writing patterns ---
    logger.info("Humanizing education report for %s", target)
    report_md = await humanize_report(report_md)

    # --- Save as DOCX ---
    docx_path = _save_report_docx(target, report_md, "Education System Analysis")

    logger.info("Education research complete for %s", target)
    return analysis, report_md, docx_path


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
    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_education_report.docx")
    doc.save(path)
    return path
