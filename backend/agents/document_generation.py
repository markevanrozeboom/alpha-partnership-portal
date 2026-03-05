"""Document Generation Agent — produces PPTX, DOCX, and XLSX deliverables.

Generates three files from structured agent outputs:
- PPTX pitch deck (adapts to audience type)
- DOCX narrative proposal (Ed71-style)
- XLSX financial model
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

from docx import Document
from docx.shared import Pt as DocxPt, Inches as DocxInches, RGBColor as DocxRGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, numbers
from openpyxl.utils import get_column_letter

from models.schemas import (
    CountryProfile,
    EducationAnalysis,
    Strategy,
    FinancialModel,
    AudienceType,
    TargetType,
    TierClassification,
)
from config import OUTPUT_DIR

logger = logging.getLogger(__name__)

# Brand colors
ALPHA_NAVY = RGBColor(0x0A, 0x1F, 0x3C)
ALPHA_BLUE = RGBColor(0x1E, 0x90, 0xFF)
ALPHA_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
ALPHA_GOLD = RGBColor(0xD4, 0xA5, 0x37)
ALPHA_LIGHT_GRAY = RGBColor(0xF0, 0xF2, 0xF5)


# ---------------------------------------------------------------------------
# PPTX Generation
# ---------------------------------------------------------------------------

def _add_slide(prs: Presentation, title: str, content_lines: list[str],
               subtitle: str = "", is_title_slide: bool = False) -> None:
    """Add a styled slide to the presentation."""
    if is_title_slide:
        layout = prs.slide_layouts[6]  # Blank layout
    else:
        layout = prs.slide_layouts[6]  # Blank layout for full control

    slide = prs.slides.add_slide(layout)

    # Background
    background = slide.background
    fill = background.fill
    fill.solid()
    if is_title_slide:
        fill.fore_color.rgb = ALPHA_NAVY
    else:
        fill.fore_color.rgb = ALPHA_WHITE

    # Title
    title_left = Inches(0.8)
    title_top = Inches(0.5) if not is_title_slide else Inches(2.0)
    title_width = Inches(8.5)
    title_height = Inches(1.0) if not is_title_slide else Inches(1.5)

    txBox = slide.shapes.add_textbox(title_left, title_top, title_width, title_height)
    tf = txBox.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(28) if not is_title_slide else Pt(36)
    p.font.bold = True
    p.font.color.rgb = ALPHA_WHITE if is_title_slide else ALPHA_NAVY
    if is_title_slide:
        p.alignment = PP_ALIGN.CENTER

    # Subtitle (title slide only)
    if is_title_slide and subtitle:
        sub_top = Inches(3.5)
        txBox2 = slide.shapes.add_textbox(title_left, sub_top, title_width, Inches(0.8))
        tf2 = txBox2.text_frame
        tf2.word_wrap = True
        p2 = tf2.paragraphs[0]
        p2.text = subtitle
        p2.font.size = Pt(18)
        p2.font.color.rgb = ALPHA_GOLD
        p2.alignment = PP_ALIGN.CENTER

    # Content
    if content_lines and not is_title_slide:
        content_top = Inches(1.6)
        content_left = Inches(0.8)
        content_width = Inches(8.5)
        content_height = Inches(5.0)

        txBox3 = slide.shapes.add_textbox(content_left, content_top, content_width, content_height)
        tf3 = txBox3.text_frame
        tf3.word_wrap = True

        for i, line in enumerate(content_lines):
            if i == 0:
                p3 = tf3.paragraphs[0]
            else:
                p3 = tf3.add_paragraph()

            if line.startswith("##"):
                p3.text = line.replace("## ", "").replace("##", "")
                p3.font.size = Pt(16)
                p3.font.bold = True
                p3.font.color.rgb = ALPHA_NAVY
                p3.space_before = Pt(12)
            elif line.startswith("• ") or line.startswith("- "):
                p3.text = line
                p3.font.size = Pt(13)
                p3.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
                p3.space_before = Pt(4)
                p3.level = 1
            elif line.startswith("**") and line.endswith("**"):
                p3.text = line.strip("*")
                p3.font.size = Pt(14)
                p3.font.bold = True
                p3.font.color.rgb = ALPHA_BLUE
                p3.space_before = Pt(8)
            else:
                p3.text = line
                p3.font.size = Pt(13)
                p3.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
                p3.space_before = Pt(4)


def generate_pptx(
    target: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    strategy: Strategy,
    financial_model: FinancialModel,
    audience: AudienceType = AudienceType.INVESTOR,
) -> str:
    """Generate the executive pitch deck."""
    logger.info("Generating PPTX for %s (audience: %s)", target, audience.value)
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    is_us_state = country_profile.target.type == TargetType.US_STATE
    tier = country_profile.target.tier

    # Audience-specific language
    if audience == AudienceType.ROYAL:
        audience_label = "A Sovereign Education Partnership"
        tone = "nation-building"
    elif audience == AudienceType.MINISTER:
        audience_label = "Education System Transformation"
        tone = "reform"
    else:
        audience_label = "Investment Opportunity"
        tone = "returns"

    brand_name = strategy.brand.jv_name_suggestion or f"Alpha × {target}"

    # --- Slide 0: Title ---
    subtitle = f"{audience_label}\n{brand_name}"
    _add_slide(prs, f"2hr Learning × {target}", [], subtitle=subtitle, is_title_slide=True)

    # --- Slide 1: Vision & Executive Summary ---
    vision_lines = [
        f"**The Vision: Transform Education in {target}**",
        "",
        "## Three Commitments",
        "• Children will love school",
        "• Children will learn 2x faster",
        "• Children will develop life skills for the AI age",
        "",
    ]

    if not is_us_state and strategy.upfront_ask:
        vision_lines.append(f"**Headline: ${strategy.upfront_ask / 1e6:,.0f}M partnership to educate "
                          f"{strategy.target_student_count_year5:,} students over 5 years**")
    elif is_us_state:
        vision_lines.append(f"**Headline: Scaling to {strategy.target_student_count_year5:,} students across "
                          f"{target} through school choice**")

    if strategy.pitch_angle:
        vision_lines.append(f"")
        vision_lines.append(f"• {strategy.pitch_angle}")

    _add_slide(prs, "Vision & Executive Summary", vision_lines)

    # --- Slide 2: Proof — Alpha Outcomes ---
    proof_lines = [
        "**Proven Results from the Alpha Model**",
        "",
        "• Students complete core academics in 2 hours/day via Timeback",
        "• Remaining time devoted to specializations: STEM, sports, arts, entrepreneurship",
        "• Guide School model transforms teachers into facilitators of deeper learning",
        "• Incept eduLLM provides personalized AI tutoring adapted to local curriculum",
        "",
        "**UAE Reference (Ed71 / Next71):**",
        "• $1.5B partnership — 200,000 students over 5 years",
        "• $25,000 per-student budget",
        "• $5B annual revenue at scale",
        "• 7-13x return multiple projected",
    ]
    _add_slide(prs, "Proof — Alpha Outcomes", proof_lines)

    # --- Slide 3: The System ---
    system_lines = [
        "**The Alpha Education Operating System**",
        "",
        "## Core IP Stack (Owned by Alpha)",
        "• Timeback — AI learning platform (2hr core academics)",
        "• AlphaCore — Curriculum and learning management system",
        "• Guide School — Teacher-to-Guide transformation program",
        "• Incept eduLLM — Custom education AI model",
        "",
        f"## Local Sovereignty Layer (Owned by {target} entity)",
        f"• Equivalent of AsasOne (UAE model)",
        "• National identity, cultural values, local curriculum",
        "• 100% owned by local joint venture entity",
    ]
    if education_analysis.two_hr_learning_fit.localisation_requirements:
        system_lines.append("")
        system_lines.append("## Localisation Requirements")
        for req in education_analysis.two_hr_learning_fit.localisation_requirements[:5]:
            system_lines.append(f"• {req}")
    _add_slide(prs, "The Education System", system_lines)

    # --- Slide 4: Scope, Timeline & Economics ---
    econ_lines = ["**Proposed Partnership Structure**", ""]

    if strategy.entry_mode:
        econ_lines.append(f"• Entry Mode: {strategy.entry_mode.value.title()}")
    if strategy.partnership_structure.type:
        econ_lines.append(f"• Partnership: {strategy.partnership_structure.type.value.upper()}")
    if not is_us_state and strategy.upfront_ask:
        econ_lines.append(f"• Upfront Investment: ${strategy.upfront_ask / 1e6:,.0f}M")
    if strategy.per_student_budget:
        econ_lines.append(f"• Per-Student Budget: ${strategy.per_student_budget:,.0f}")

    econ_lines.append("")
    econ_lines.append("## School Types")
    for st in strategy.school_types:
        econ_lines.append(f"• {st.name}: {st.size or ''} — {st.tuition or ''}")

    econ_lines.append("")
    econ_lines.append("## Phased Rollout")
    for phase in strategy.phased_rollout:
        sc = f" ({phase.student_count:,} students)" if phase.student_count else ""
        econ_lines.append(f"• {phase.phase} [{phase.timeline}]{sc}")

    econ_lines.append("")
    econ_lines.append("## 5-Year Financial Summary")
    if financial_model.pnl_projection and len(financial_model.pnl_projection) >= 5:
        y5 = financial_model.pnl_projection[4]
        econ_lines.append(f"• Year 5 Revenue: ${y5.revenue / 1e6:,.0f}M")
        econ_lines.append(f"• Year 5 EBITDA: ${y5.ebitda / 1e6:,.0f}M")
        econ_lines.append(f"• Year 5 Students: {y5.students:,}")
    if financial_model.returns_analysis.irr:
        econ_lines.append(f"• Projected IRR: {financial_model.returns_analysis.irr:.1f}%")
    if financial_model.returns_analysis.moic:
        econ_lines.append(f"• Projected MOIC: {financial_model.returns_analysis.moic:.1f}x")

    _add_slide(prs, "Scope, Timeline & Economics", econ_lines)

    # --- Slide 5: The Ask ---
    ask_lines = [f"**What Alpha Needs from {target}**", ""]
    if strategy.key_asks:
        for ask in strategy.key_asks:
            ask_lines.append(f"• {ask}")
    else:
        if not is_us_state:
            ask_lines.extend([
                "• Regulatory fast-track for school licensing",
                "• Tuition/subsidy approval at proposed price points",
                "• Real estate allocation or partnership",
                "• Scholarship funding for qualifying students",
                "• Sovereign/political sponsorship and endorsement",
            ])
        else:
            ask_lines.extend([
                "• ESA/voucher program access and compliance clarity",
                "• Site selection support for micro schools and campuses",
                "• Local marketing and community partnership",
                "• Regulatory guidance for new school establishment",
            ])

    ask_lines.append("")
    ask_lines.append("**Next Steps:**")
    ask_lines.append("• Establish working group within 30 days")
    ask_lines.append("• Guide School site selection and teacher recruitment")
    ask_lines.append("• Pilot school launch within 6-12 months")

    _add_slide(prs, "The Ask & Next Steps", ask_lines)

    # --- Appendix slides ---
    if country_profile.demographics.total_population:
        appendix_lines = [
            f"**{target} — Market Overview**",
            "",
        ]
        if country_profile.demographics.total_population:
            appendix_lines.append(f"• Population: {country_profile.demographics.total_population:,.0f}")
        if country_profile.demographics.population_0_18:
            appendix_lines.append(f"• School-Age Population: {country_profile.demographics.population_0_18:,.0f}")
        if country_profile.economy.gdp_per_capita:
            appendix_lines.append(f"• GDP per Capita: ${country_profile.economy.gdp_per_capita:,.0f}")
        if country_profile.economy.gdp:
            appendix_lines.append(f"• GDP: ${country_profile.economy.gdp / 1e9:,.1f}B")
        if tier:
            appendix_lines.append(f"• Tier Classification: Tier {tier}")
        if country_profile.education.k12_enrolled:
            appendix_lines.append(f"• K-12 Enrolled: {country_profile.education.k12_enrolled:,.0f}")
        if country_profile.education.public_private_split:
            appendix_lines.append(f"• Public/Private Split: {country_profile.education.public_private_split}")
        _add_slide(prs, "Appendix: Market Data", appendix_lines)

    # Save
    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, f"{target.replace(' ', '_')}_pitch_deck.pptx")
    prs.save(filepath)
    logger.info("PPTX saved to %s", filepath)
    return filepath


# ---------------------------------------------------------------------------
# DOCX Generation
# ---------------------------------------------------------------------------

def generate_docx(
    target: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    strategy: Strategy,
    financial_model: FinancialModel,
) -> str:
    """Generate the narrative proposal document (Ed71-style)."""
    logger.info("Generating DOCX for %s", target)
    doc = Document()

    is_us_state = country_profile.target.type == TargetType.US_STATE
    tier = country_profile.target.tier

    # Style setup
    style = doc.styles['Normal']
    font = style.font
    font.name = 'Calibri'
    font.size = DocxPt(11)

    # Title
    title = doc.add_heading(f"2hr Learning × {target}", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph("CONFIDENTIAL & PROPRIETARY").alignment = WD_ALIGN_PARAGRAPH.CENTER
    brand_name = strategy.brand.jv_name_suggestion or f"Alpha × {target}"
    doc.add_paragraph(f"{brand_name} — Education Partnership Proposal").alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph(f"Prepared by 2hr Learning (Alpha)").alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_page_break()

    # --- Section 1: Executive Summary ---
    doc.add_heading("1. Executive Summary", level=1)
    doc.add_paragraph(
        f"This proposal outlines a transformative education partnership between "
        f"2hr Learning (Alpha) and {target}, designed to deliver world-class "
        f"education outcomes through Alpha's proven technology platform."
    )
    doc.add_heading("Three Commitments", level=2)
    doc.add_paragraph("1. Children will love school", style='List Number')
    doc.add_paragraph("2. Children will learn 2x faster", style='List Number')
    doc.add_paragraph("3. Children will develop life skills for the AI age", style='List Number')

    if not is_us_state and strategy.upfront_ask:
        doc.add_paragraph(
            f"\nHeadline Financial Ask: ${strategy.upfront_ask / 1e6:,.0f}M partnership to educate "
            f"{strategy.target_student_count_year5:,} students over 5 years."
        )
    elif is_us_state:
        doc.add_paragraph(
            f"\nTarget: Scale to {strategy.target_student_count_year5:,} students across "
            f"{target} through school choice programs."
        )

    # --- Section 2: Education System Diagnosis ---
    doc.add_heading(f"2. {target} Education System Diagnosis", level=1)

    if education_analysis.system_diagnosis.primary_pain_points:
        doc.add_heading("What Is Broken", level=2)
        for point in education_analysis.system_diagnosis.primary_pain_points:
            doc.add_paragraph(f"• {point}")

    if education_analysis.system_diagnosis.parent_pain_points:
        doc.add_heading("Parent Pain Points", level=2)
        for point in education_analysis.system_diagnosis.parent_pain_points:
            doc.add_paragraph(f"• {point}")

    if education_analysis.system_diagnosis.government_pain_points:
        doc.add_heading("Government Challenges", level=2)
        for point in education_analysis.system_diagnosis.government_pain_points:
            doc.add_paragraph(f"• {point}")

    if education_analysis.reform_landscape.active_reforms:
        doc.add_heading("Current Reform Landscape", level=2)
        for reform in education_analysis.reform_landscape.active_reforms:
            doc.add_paragraph(f"• {reform}")

    # --- Section 3: The Alpha Education Stack ---
    doc.add_heading("3. The Alpha Education Stack", level=1)
    doc.add_paragraph(
        "Alpha's complete education operating system addresses every dimension "
        "of the education challenge:"
    )

    components = [
        ("Timeback", "AI-powered learning platform that compresses core academics into 2 hours per day, "
         "freeing the remaining school hours for specializations, sports, arts, and life skills development."),
        ("AlphaCore", "The core curriculum and learning management system that ensures rigorous academic "
         "standards while enabling personalized learning paths for every student."),
        ("Guide School", "A transformative teacher training program that converts traditional educators "
         "into 'Guides' — facilitators who enable deeper, project-based, and student-led learning."),
        ("Incept eduLLM", "A custom education-focused large language model that provides personalized "
         "AI tutoring, adapted to local curriculum and cultural context."),
    ]

    for comp_name, comp_desc in components:
        doc.add_heading(comp_name, level=2)
        doc.add_paragraph(comp_desc)

    doc.add_heading("Local IP Layer", level=2)
    doc.add_paragraph(
        f"A local entity (equivalent of AsasOne in the UAE) will be created and 100% owned by the "
        f"{target} partner. This entity controls national identity content, cultural values "
        f"integration, and mandatory local curriculum. Alpha's core IP remains owned by Alpha."
    )

    # --- Section 4: Proposed Deal Structure ---
    doc.add_heading("4. Proposed Deal Structure", level=1)

    if strategy.entry_mode:
        doc.add_paragraph(f"Entry Mode: {strategy.entry_mode.value.title()}")
    if strategy.partnership_structure.type:
        doc.add_paragraph(f"Partnership Type: {strategy.partnership_structure.type.value.upper()}")
    if strategy.partnership_structure.ownership_split:
        doc.add_paragraph(f"Ownership: {strategy.partnership_structure.ownership_split}")

    doc.add_heading("School Types", level=2)
    for st in strategy.school_types:
        doc.add_paragraph(
            f"• {st.name}: {st.focus or ''} — {st.size or ''} — {st.tuition or ''}"
        )

    doc.add_heading("Phased Rollout", level=2)
    for phase in strategy.phased_rollout:
        sc = f" ({phase.student_count:,} students)" if phase.student_count else ""
        doc.add_paragraph(f"• {phase.phase} [{phase.timeline}]{sc}")
        for ms in phase.milestones[:3]:
            doc.add_paragraph(f"  - {ms}")

    # --- Section 5: Financial Summary ---
    doc.add_heading("5. Financial Summary", level=1)

    if not is_us_state and strategy.upfront_ask:
        doc.add_paragraph(f"Upfront Investment: ${strategy.upfront_ask / 1e6:,.0f}M")
    if strategy.per_student_budget:
        doc.add_paragraph(f"Per-Student Budget: ${strategy.per_student_budget:,.0f}")

    doc.add_paragraph(f"Management Fee: {financial_model.management_fee_pct * 100:.0f}% of per-student budget (non-negotiable floor)")
    doc.add_paragraph(f"Timeback License Fee: {financial_model.timeback_license_pct * 100:.0f}% of per-student budget (non-negotiable floor)")

    if financial_model.total_management_fee_revenue:
        doc.add_paragraph(f"Total Management Fee Revenue (5yr): ${financial_model.total_management_fee_revenue / 1e6:,.0f}M")
    if financial_model.total_timeback_license_revenue:
        doc.add_paragraph(f"Total Timeback License Revenue (5yr): ${financial_model.total_timeback_license_revenue / 1e6:,.0f}M")

    doc.add_heading("Projected P&L (Year 5)", level=2)
    if financial_model.pnl_projection and len(financial_model.pnl_projection) >= 5:
        y5 = financial_model.pnl_projection[4]
        table = doc.add_table(rows=6, cols=2)
        table.style = 'Table Grid'
        rows_data = [
            ("Students", f"{y5.students:,}"),
            ("Revenue", f"${y5.revenue / 1e6:,.0f}M"),
            ("Gross Margin", f"${y5.gross_margin / 1e6:,.0f}M"),
            ("EBITDA", f"${y5.ebitda / 1e6:,.0f}M"),
            ("Net Income", f"${y5.net_income / 1e6:,.0f}M"),
            ("Schools", f"{y5.schools:,}"),
        ]
        for i, (label, value) in enumerate(rows_data):
            table.rows[i].cells[0].text = label
            table.rows[i].cells[1].text = value

    doc.add_heading("Returns Analysis", level=2)
    if financial_model.returns_analysis.irr:
        doc.add_paragraph(f"Projected IRR: {financial_model.returns_analysis.irr:.1f}%")
    if financial_model.returns_analysis.moic:
        doc.add_paragraph(f"Projected MOIC: {financial_model.returns_analysis.moic:.1f}x")
    if financial_model.returns_analysis.enterprise_value_at_exit:
        doc.add_paragraph(f"Enterprise Value at Exit (Year 10): ${financial_model.returns_analysis.enterprise_value_at_exit / 1e9:,.1f}B")

    # --- Section 6: The Ask ---
    doc.add_heading(f"6. The Ask — What Alpha Needs from {target}", level=1)
    if strategy.key_asks:
        for ask in strategy.key_asks:
            doc.add_paragraph(f"• {ask}")
    else:
        if not is_us_state:
            asks = [
                "Regulatory fast-track for school licensing",
                "Tuition/subsidy approval at proposed price points",
                "Real estate allocation or development partnership",
                "Scholarship funding for qualifying students",
                "Sovereign or political sponsorship and endorsement",
            ]
        else:
            asks = [
                "ESA/voucher program access and compliance clarity",
                "Site selection support",
                "Local marketing and community partnerships",
                "Regulatory guidance for new school models",
            ]
        for ask in asks:
            doc.add_paragraph(f"• {ask}")

    # Save
    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, f"{target.replace(' ', '_')}_proposal.docx")
    doc.save(filepath)
    logger.info("DOCX saved to %s", filepath)
    return filepath


# ---------------------------------------------------------------------------
# XLSX Generation
# ---------------------------------------------------------------------------

# Styles
HEADER_FONT = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
HEADER_FILL = PatternFill(start_color='0A1F3C', end_color='0A1F3C', fill_type='solid')
SUBHEADER_FILL = PatternFill(start_color='1E90FF', end_color='1E90FF', fill_type='solid')
MONEY_FORMAT = '#,##0'
PCT_FORMAT = '0.0%'
THIN_BORDER = Border(
    left=Side(style='thin'), right=Side(style='thin'),
    top=Side(style='thin'), bottom=Side(style='thin')
)


def _style_header_row(ws, row: int, max_col: int) -> None:
    for col in range(1, max_col + 1):
        cell = ws.cell(row=row, column=col)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = THIN_BORDER


def _style_data_cell(ws, row: int, col: int, fmt: str = '') -> None:
    cell = ws.cell(row=row, column=col)
    cell.border = THIN_BORDER
    cell.alignment = Alignment(horizontal='right' if col > 1 else 'left')
    if fmt:
        cell.number_format = fmt


def generate_xlsx(
    target: str,
    country_profile: CountryProfile,
    strategy: Strategy,
    financial_model: FinancialModel,
) -> str:
    """Generate the financial model spreadsheet."""
    logger.info("Generating XLSX for %s", target)
    wb = Workbook()

    # --- Sheet 1: P&L Projection ---
    ws_pnl = wb.active
    ws_pnl.title = "P&L Projection"

    headers = ["Year", "Students", "Schools", "Revenue", "COGS", "Gross Margin", "OpEx", "EBITDA", "Net Income"]
    for col, h in enumerate(headers, 1):
        ws_pnl.cell(row=1, column=col, value=h)
    _style_header_row(ws_pnl, 1, len(headers))

    for i, yr in enumerate(financial_model.pnl_projection, 2):
        ws_pnl.cell(row=i, column=1, value=yr.year)
        ws_pnl.cell(row=i, column=2, value=yr.students)
        ws_pnl.cell(row=i, column=3, value=yr.schools)
        ws_pnl.cell(row=i, column=4, value=yr.revenue)
        ws_pnl.cell(row=i, column=5, value=yr.cogs)
        ws_pnl.cell(row=i, column=6, value=yr.gross_margin)
        ws_pnl.cell(row=i, column=7, value=yr.opex)
        ws_pnl.cell(row=i, column=8, value=yr.ebitda)
        ws_pnl.cell(row=i, column=9, value=yr.net_income)
        for col in range(1, 10):
            _style_data_cell(ws_pnl, i, col, MONEY_FORMAT if col >= 4 else '')

    for col in range(1, 10):
        ws_pnl.column_dimensions[get_column_letter(col)].width = 18

    # --- Sheet 2: Unit Economics ---
    ws_ue = wb.create_sheet("Unit Economics")
    ue_headers = ["School Type", "Revenue/Student", "Cost/Student", "Contribution Margin", "Margin %"]
    for col, h in enumerate(ue_headers, 1):
        ws_ue.cell(row=1, column=col, value=h)
    _style_header_row(ws_ue, 1, len(ue_headers))

    for i, ue in enumerate(financial_model.unit_economics, 2):
        ws_ue.cell(row=i, column=1, value=ue.school_type)
        ws_ue.cell(row=i, column=2, value=ue.per_student_revenue)
        ws_ue.cell(row=i, column=3, value=ue.per_student_cost)
        ws_ue.cell(row=i, column=4, value=ue.contribution_margin)
        ws_ue.cell(row=i, column=5, value=ue.margin_pct / 100 if ue.margin_pct else 0)
        for col in range(1, 6):
            fmt = MONEY_FORMAT if 2 <= col <= 4 else (PCT_FORMAT if col == 5 else '')
            _style_data_cell(ws_ue, i, col, fmt)

    for col in range(1, 6):
        ws_ue.column_dimensions[get_column_letter(col)].width = 22

    # --- Sheet 3: Capital Deployment ---
    ws_cap = wb.create_sheet("Capital Deployment")
    cap_headers = ["Year", "IP Development", "Management Fees", "Launch Capital", "Real Estate", "Total"]
    for col, h in enumerate(cap_headers, 1):
        ws_cap.cell(row=1, column=col, value=h)
    _style_header_row(ws_cap, 1, len(cap_headers))

    for i, cap in enumerate(financial_model.capital_deployment, 2):
        ws_cap.cell(row=i, column=1, value=cap.year)
        ws_cap.cell(row=i, column=2, value=cap.ip_development)
        ws_cap.cell(row=i, column=3, value=cap.management_fees)
        ws_cap.cell(row=i, column=4, value=cap.launch_capital)
        ws_cap.cell(row=i, column=5, value=cap.real_estate)
        ws_cap.cell(row=i, column=6, value=cap.total)
        for col in range(1, 7):
            _style_data_cell(ws_cap, i, col, MONEY_FORMAT if col >= 2 else '')

    for col in range(1, 7):
        ws_cap.column_dimensions[get_column_letter(col)].width = 20

    # --- Sheet 4: Returns Analysis ---
    ws_ret = wb.create_sheet("Returns Analysis")
    ret_data = [
        ("Metric", "Value"),
        ("IRR", f"{financial_model.returns_analysis.irr:.1f}%" if financial_model.returns_analysis.irr else "N/A"),
        ("MOIC", f"{financial_model.returns_analysis.moic:.1f}x" if financial_model.returns_analysis.moic else "N/A"),
        ("Enterprise Value at Exit", f"${financial_model.returns_analysis.enterprise_value_at_exit / 1e9:,.1f}B" if financial_model.returns_analysis.enterprise_value_at_exit else "N/A"),
        ("Payback Period", f"{financial_model.returns_analysis.payback_period_years:.1f} years" if financial_model.returns_analysis.payback_period_years else "N/A"),
        ("EBITDA Multiple", f"{financial_model.returns_analysis.ebitda_multiple}x" if financial_model.returns_analysis.ebitda_multiple else "N/A"),
        ("", ""),
        ("PPP Factor", f"{financial_model.ppp_factor:.2f}"),
        ("Demand Factor", f"{financial_model.demand_factor:.1f}"),
        ("Management Fee %", f"{financial_model.management_fee_pct * 100:.0f}%"),
        ("Timeback License %", f"{financial_model.timeback_license_pct * 100:.0f}%"),
        ("Upfront IP Fee", f"${financial_model.upfront_ip_fee / 1e6:,.0f}M"),
        ("Total Mgmt Fee Rev (5yr)", f"${financial_model.total_management_fee_revenue / 1e6:,.0f}M"),
        ("Total Timeback Rev (5yr)", f"${financial_model.total_timeback_license_revenue / 1e6:,.0f}M"),
    ]
    for i, (label, value) in enumerate(ret_data, 1):
        ws_ret.cell(row=i, column=1, value=label)
        ws_ret.cell(row=i, column=2, value=value)
        if i == 1:
            _style_header_row(ws_ret, i, 2)
        else:
            for col in (1, 2):
                _style_data_cell(ws_ret, i, col)

    ws_ret.column_dimensions['A'].width = 30
    ws_ret.column_dimensions['B'].width = 25

    # --- Sheet 5: Sensitivity Analysis ---
    ws_sens = wb.create_sheet("Sensitivity Analysis")
    sens_headers = ["Variable", "Base Case", "Downside (-20-30%)", "Upside (+20-30%)"]
    for col, h in enumerate(sens_headers, 1):
        ws_sens.cell(row=1, column=col, value=h)
    _style_header_row(ws_sens, 1, len(sens_headers))

    for i, s in enumerate(financial_model.sensitivity, 2):
        ws_sens.cell(row=i, column=1, value=s.variable)
        ws_sens.cell(row=i, column=2, value=s.base_case)
        ws_sens.cell(row=i, column=3, value=s.downside)
        ws_sens.cell(row=i, column=4, value=s.upside)
        for col in range(1, 5):
            _style_data_cell(ws_sens, i, col, MONEY_FORMAT if col >= 2 else '')

    for col in range(1, 5):
        ws_sens.column_dimensions[get_column_letter(col)].width = 22

    # Save
    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, f"{target.replace(' ', '_')}_financial_model.xlsx")
    wb.save(filepath)
    logger.info("XLSX saved to %s", filepath)
    return filepath


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def run_document_generation(
    target: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    strategy: Strategy,
    financial_model: FinancialModel,
    audience: AudienceType = AudienceType.INVESTOR,
) -> tuple[str, str, str]:
    """Generate all three deliverables. Returns (pptx_path, docx_path, xlsx_path)."""
    logger.info("Generating all documents for %s", target)

    pptx_path = generate_pptx(
        target, country_profile, education_analysis, strategy, financial_model, audience
    )
    docx_path = generate_docx(
        target, country_profile, education_analysis, strategy, financial_model
    )
    xlsx_path = generate_xlsx(
        target, country_profile, strategy, financial_model
    )

    logger.info("All documents generated for %s", target)
    return pptx_path, docx_path, xlsx_path
