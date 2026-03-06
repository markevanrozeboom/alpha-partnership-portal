"""Education System Research Agent — produces McKinsey-quality education sector analysis.

Deep-dives into the education system, diagnoses what's broken, maps the reform landscape,
and identifies where 2hr Learning's model creates the sharpest differentiation.
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
from config import OUTPUT_DIR

logger = logging.getLogger(__name__)

REPORT_PROMPT = """You are a senior education sector analyst at McKinsey & Company writing a
comprehensive education system analysis for **{target}**.

This report will be read by CEOs, education ministers, and sovereign wealth fund managers
evaluating a major partnership with 2hr Learning (Alpha).

## About Alpha / 2hr Learning

Alpha's education operating system:
- **Timeback**: AI platform compressing core academics into 2 hours/day, freeing time for
  specialisations (STEM, sports, arts, entrepreneurship, life skills)
- **AlphaCore**: Core curriculum and learning management system
- **Guide School**: 12-month program transforming traditional teachers into "Guides" —
  facilitators of deeper, project-based, student-led learning
- **Incept eduLLM**: Custom education AI model adapted to local curriculum and culture

Alpha's three commitments: (1) Children will love school, (2) Children will learn 2x faster,
(3) Children will develop life skills for the AI age.

UAE reference: $1.5B deal, 200K students, $25K/student, local IP layer (AsasOne) for
national identity and cultural values.

## Report Requirements

Write an exhaustive education sector analysis in **markdown** with these sections.
Include specific data, citations, and comparative benchmarks. Use tables for data.
Mark Alpha-relevant insights with **⚡ Alpha Relevance:** callouts.

### Required Sections

1. **Executive Summary** — 3-4 paragraph synthesis of key findings and Alpha's strategic fit
2. **Education System Architecture** — Structure overview, governance model, curriculum
   framework, assessment system, language of instruction, school calendar, key regulatory bodies
3. **Performance Assessment** — Learning outcomes (PISA, TIMSS, national assessments),
   equity gaps (urban/rural, gender, income), efficiency metrics (spend per outcome),
   international benchmarking vs. peer countries
4. **Pain Point Analysis**
   - **Student pain points**: engagement, relevance, mental health, future readiness
   - **Parent pain points**: quality concerns, cost burden, aspirations gap
   - **Government pain points**: fiscal pressure, outcomes gap, teacher quality, infrastructure
   - **Employer pain points**: skills gap, workforce readiness
5. **Reform Landscape** — Active reforms with budget and timeline, government appetite
   for innovation, prior edtech initiatives (successes and failures), international
   partnerships in education
6. **Private Education Market** — Market size and growth, segmentation (premium/mid/mass),
   major operators, pricing tiers, parent willingness to pay by income segment,
   unmet demand analysis
7. **Technology & Innovation Readiness** — Digital infrastructure, device penetration,
   internet access, EdTech adoption, AI readiness, teacher digital literacy
8. **Alpha Model Fit Analysis** — For each Alpha product (Timeback, AlphaCore, Guide School,
   Incept eduLLM): specific pain point it solves, localisation requirements, competitive
   advantage vs. existing solutions, implementation challenges
9. **Recommended Entry Strategy** — Private / Government / Hybrid with detailed rationale,
   target segments, pricing positioning, regulatory pathway, timeline
10. **Localisation Requirements** — Language, curriculum, cultural values integration,
    national identity considerations, mandatory subjects, teacher certification
11. **Risk Factors** — Implementation risks, cultural risks, regulatory risks, competitive
    response — each rated and with mitigation strategies
12. **Sources** — All citations with dates

For US states: focus on ESA/voucher programs, charter/micro-school culture, homeschool
populations, regulatory environment, school choice political landscape.

## Formatting Rules
- Markdown headers, tables, bold for key figures
- **⚡ Alpha Relevance:** callouts for actionable insights
- Analytical and data-driven, not descriptive
- Minimum 3,000 words
- Write as if presenting to McKinsey's Global Education Practice leadership
"""

REPORT_REVISION_PROMPT = """You are revising an education sector analysis based on user feedback.

Original report:
{original_report}

User feedback:
{feedback}

Produce a revised full report incorporating the feedback. Maintain the same depth,
data richness, and ⚡ Alpha Relevance callouts."""


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

    # --- Build context from country profile ---
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
    context = "\n".join(ctx_parts)

    # --- Structured analysis ---
    try:
        analysis: EducationAnalysis = await call_llm(
            system_prompt="Extract structured education analysis from the research data.",
            user_prompt=f"Context:\n{context}\n\nResearch:\n{research_text}",
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
        report_md = await call_llm_plain(
            system_prompt=REPORT_PROMPT.format(target=target),
            user_prompt=(
                f"Write the full education system analysis for **{target}**.\n\n"
                f"**Country Profile Context:**\n{context}\n\n"
                f"**Live Research:**\n{research_text}\n\n"
                f"**Citations:**\n{chr(10).join(str(c) for c in citations)}\n\n"
                f"Produce the complete report."
            ),
        )

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
