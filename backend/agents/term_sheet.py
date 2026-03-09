"""Term Sheet Generator — produces a professional deal term sheet DOCX.

Modelled on the UAE Ed71 deal term sheet format.
This is one of the two primary deliverables to the country/state
(the other being the investor deck).
"""

from __future__ import annotations

import logging
import os
from datetime import datetime

from docx import Document as DocxDocument
from docx.shared import Pt as DocxPt, RGBColor as DocxRGB, Inches as DocxInches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

from models.schemas import (
    CountryProfile, EducationAnalysis, Strategy,
    FinancialModel, FinancialAssumptions, TargetType,
)
from services.llm import call_llm_plain
from config import OUTPUT_DIR

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# LLM prompts for term sheet sections
# ---------------------------------------------------------------------------

TERM_SHEET_PROMPT = """You are a senior M&A lawyer at Sullivan & Cromwell drafting a non-binding
indicative term sheet for a strategic education partnership between 2hr Learning (Alpha Holdings)
and {target}.

Context:
{context}

Write a PROFESSIONAL TERM SHEET with the following exact sections. Use crisp legal/deal language.
Every term should be SPECIFIC — no placeholder ranges, commit to numbers.

## PARTIES
- Alpha Holdings / 2hr Learning ("Alpha")
- The counterparty (government ministry, sovereign entity, or private partner)

## TRANSACTION OVERVIEW
- 2-3 sentence description of the deal

## KEY COMMERCIAL TERMS

### Partnership Structure
- Entity type (JV / licensing / direct)
- Ownership split
- Governance (board composition, voting rights, reserved matters)

### IP Licensing & Technology
- Timeback platform license: {timeback_pct}% of per-student revenue
- AlphaCore curriculum license: included
- Incept eduLLM localisation: included
- Guide School teacher training: included
- Upfront IP development & licensing fee: ${upfront_ip:,.0f}

### Management Fee
- Alpha management fee: {mgmt_pct}% of gross school revenue
- Payable: quarterly in arrears
- Minimum prepayment: 2 years at signing

### School Portfolio
{school_info}

### Financial Projections (Indicative)
{financial_summary}

### Rollout & Milestones
{rollout_info}

## KEY ASKS FROM {target_upper}
{key_asks}

## ALPHA COMMITMENTS
- Three commitments: (1) Children will love school, (2) Children will learn 2x faster,
  (3) Children will develop life skills for the AI age
- Outcomes measurement: third-party verified (NWEA MAP, standardised assessments)
- Cultural IP layer: local identity, language, and values fully integrated

## EXCLUSIVITY
- Alpha grants territorial exclusivity for the education model in {target}
- Duration: co-terminus with the partnership agreement
- Alpha retains global IP ownership

## TERM & EXIT
- Initial term: 25 years (renewable)
- Exit provisions: tag-along, drag-along, ROFR on partner share
- Termination for cause with 12-month cure period

## GOVERNING LAW
- [Appropriate jurisdiction]

## CONDITIONS PRECEDENT
- Regulatory approvals for school licensing
- Government endorsement / MOU
- Completion of due diligence
- Board approvals from both parties

## CONFIDENTIALITY
- This term sheet is confidential and non-binding (other than confidentiality and exclusivity)
- Subject to definitive agreement execution

---

*This Indicative Term Sheet is for discussion purposes only and does not constitute a binding offer or commitment. All terms are subject to final negotiation and execution of definitive agreements.*
"""


async def generate_term_sheet(
    target: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    strategy: Strategy,
    financial_model: FinancialModel,
    assumptions: FinancialAssumptions,
) -> tuple[str, str]:
    """Generate a term sheet.

    Returns (term_sheet_markdown, term_sheet_docx_path).
    """
    logger.info("Generating term sheet for %s", target)

    # Build context
    context_parts = []
    if country_profile.demographics.total_population:
        context_parts.append(f"Population: {country_profile.demographics.total_population:,.0f}")
    if country_profile.education.k12_enrolled:
        context_parts.append(f"K-12 students: {country_profile.education.k12_enrolled:,.0f}")
    if country_profile.economy.gdp_per_capita:
        context_parts.append(f"GDP/capita: ${country_profile.economy.gdp_per_capita:,.0f}")
    if country_profile.target.tier:
        context_parts.append(f"Tier: {country_profile.target.tier}")
    if strategy.entry_mode:
        context_parts.append(f"Entry mode: {strategy.entry_mode.value}")
    if strategy.partnership_structure.type:
        context_parts.append(f"Partnership: {strategy.partnership_structure.type.value}")

    # Financial info
    school_info_lines = []
    if strategy.school_types:
        for st in strategy.school_types[:4]:
            school_info_lines.append(f"- {st.name}: {st.focus or 'TBD'} — {st.tuition or 'TBD'}")
    school_info = "\n".join(school_info_lines) or "- To be defined in definitive agreement"

    fin_lines = []
    if financial_model.pnl_projection:
        for p in financial_model.pnl_projection:
            fin_lines.append(
                f"- Year {p.year}: {p.students:,} students | {p.schools} schools | "
                f"${p.revenue:,.0f} revenue | ${p.ebitda:,.0f} EBITDA"
            )
    financial_summary = "\n".join(fin_lines) or "- See attached financial model"

    rollout_lines = []
    if strategy.phased_rollout:
        for ph in strategy.phased_rollout[:5]:
            rollout_lines.append(
                f"- {ph.phase} ({ph.timeline}): {ph.student_count:,} students"
                if ph.student_count else f"- {ph.phase} ({ph.timeline})"
            )
    rollout_info = "\n".join(rollout_lines) or "- Phased rollout over 5 years"

    key_asks = "\n".join(f"- {ask}" for ask in strategy.key_asks[:8]) if strategy.key_asks else "- To be discussed"

    # Get percentages
    mgmt_pct = round(financial_model.management_fee_pct * 100)
    timeback_pct = round(financial_model.timeback_license_pct * 100)
    upfront_ip = financial_model.upfront_ip_fee

    term_sheet_md = await call_llm_plain(
        system_prompt=TERM_SHEET_PROMPT.format(
            target=target,
            target_upper=target.upper(),
            context="\n".join(context_parts),
            timeback_pct=timeback_pct,
            mgmt_pct=mgmt_pct,
            upfront_ip=upfront_ip,
            school_info=school_info,
            financial_summary=financial_summary,
            rollout_info=rollout_info,
            key_asks=key_asks,
        ),
        user_prompt=f"Produce the complete term sheet for the 2hr Learning × {target} partnership.",
    )

    # Save as DOCX
    docx_path = _build_term_sheet_docx(target, term_sheet_md)

    logger.info("Term sheet generated for %s", target)
    return term_sheet_md, docx_path


def _build_term_sheet_docx(target: str, markdown: str) -> str:
    """Render the term sheet markdown into a professional DOCX."""
    doc = DocxDocument()

    # Page setup
    for section in doc.sections:
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)
        section.left_margin = Cm(2.54)
        section.right_margin = Cm(2.54)

    # Default font
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = DocxPt(11)
    style.font.color.rgb = DocxRGB(0x33, 0x33, 0x33)
    style.paragraph_format.space_after = DocxPt(4)
    style.paragraph_format.line_spacing = 1.15

    # Heading styles
    for level, (size, color, bold) in {
        1: (DocxPt(20), DocxRGB(0x1a, 0x1a, 0x2e), True),
        2: (DocxPt(14), DocxRGB(0x00, 0x6D, 0x77), True),
        3: (DocxPt(12), DocxRGB(0x33, 0x33, 0x33), True),
    }.items():
        hs = doc.styles[f"Heading {level}"]
        hs.font.size = size
        hs.font.color.rgb = color
        hs.font.bold = bold
        hs.font.name = "Calibri"
        hs.paragraph_format.space_before = DocxPt(14)
        hs.paragraph_format.space_after = DocxPt(6)

    # --- Header ---
    doc.add_paragraph("")

    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title_p.add_run("INDICATIVE TERM SHEET")
    run.font.size = DocxPt(24)
    run.font.color.rgb = DocxRGB(0x1a, 0x1a, 0x2e)
    run.bold = True

    subtitle_p = doc.add_paragraph()
    subtitle_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle_p.add_run(f"2hr Learning (Alpha) × {target}")
    run.font.size = DocxPt(16)
    run.font.color.rgb = DocxRGB(0x00, 0x6D, 0x77)
    run.bold = True

    subtitle_p2 = doc.add_paragraph()
    subtitle_p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle_p2.add_run("Strategic Education Partnership")
    run.font.size = DocxPt(12)
    run.font.color.rgb = DocxRGB(0x66, 0x66, 0x66)

    doc.add_paragraph("")

    conf_p = doc.add_paragraph()
    conf_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = conf_p.add_run("CONFIDENTIAL & NON-BINDING")
    run.font.size = DocxPt(11)
    run.font.color.rgb = DocxRGB(0xCC, 0x00, 0x00)
    run.bold = True

    date_p = doc.add_paragraph()
    date_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = date_p.add_run(datetime.now().strftime("%B %Y"))
    run.font.size = DocxPt(10)
    run.font.color.rgb = DocxRGB(0x99, 0x99, 0x99)

    doc.add_page_break()

    # --- Render markdown body ---
    for line in markdown.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("### "):
            doc.add_heading(stripped[4:], level=3)
        elif stripped.startswith("## "):
            doc.add_heading(stripped[3:], level=2)
        elif stripped.startswith("# "):
            doc.add_heading(stripped[2:], level=1)
        elif stripped.startswith("- "):
            text = stripped[2:]
            if text.startswith("**") and "**" in text[2:]:
                end = text.index("**", 2)
                bold_part = text[2:end]
                rest = text[end + 2:]
                p = doc.add_paragraph(style="List Bullet")
                r1 = p.add_run(bold_part)
                r1.bold = True
                p.add_run(rest)
            else:
                doc.add_paragraph(text, style="List Bullet")
        elif stripped.startswith("*") and stripped.endswith("*"):
            # Italic disclaimer
            p = doc.add_paragraph()
            run = p.add_run(stripped.strip("*"))
            run.italic = True
            run.font.size = DocxPt(9)
            run.font.color.rgb = DocxRGB(0x99, 0x99, 0x99)
        elif stripped.startswith("|"):
            # Simple table row — render as plain text for term sheets
            doc.add_paragraph(stripped)
        elif stripped == "---":
            p = doc.add_paragraph()
            p.paragraph_format.space_before = DocxPt(8)
            p.paragraph_format.space_after = DocxPt(8)
        else:
            p = doc.add_paragraph()
            # Handle inline bold
            _add_formatted_text(p, stripped)

    # Save
    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_term_sheet.docx")
    doc.save(path)
    logger.info("Term sheet DOCX saved: %s", path)
    return path


def _add_formatted_text(paragraph, text: str) -> None:
    """Add text with **bold** handling."""
    pos = 0
    while pos < len(text):
        bold_start = text.find("**", pos)
        if bold_start != -1:
            bold_end = text.find("**", bold_start + 2)
            if bold_end != -1:
                if bold_start > pos:
                    paragraph.add_run(text[pos:bold_start])
                run = paragraph.add_run(text[bold_start + 2:bold_end])
                run.bold = True
                pos = bold_end + 2
                continue
        paragraph.add_run(text[pos:])
        break
