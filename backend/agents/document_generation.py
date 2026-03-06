"""Document Generation Agent — produces executive-quality investor deck and proposal.

Generates PPTX and DOCX with appendices, formatted for C-suite / head-of-state audiences.
"""

from __future__ import annotations

import logging
import os
from io import BytesIO

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

from docx import Document as DocxDocument
from docx.shared import Pt as DocxPt, RGBColor as DocxRGB
from docx.enum.text import WD_ALIGN_PARAGRAPH

from models.schemas import (
    CountryProfile, EducationAnalysis, Strategy,
    FinancialModel, FinancialAssumptions, AudienceType,
)
from services.llm import call_llm_plain
from config import OUTPUT_DIR

logger = logging.getLogger(__name__)

# Colour palette
DARK = RGBColor(0x1a, 0x1a, 0x2e)
ACCENT = RGBColor(0x00, 0x6D, 0x77)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT = RGBColor(0xF0, 0xF0, 0xF0)


DECK_OUTLINE_PROMPT = """You are a senior director at Goldman Sachs' Investment Banking Division
drafting an investor/government presentation deck outline for a {audience_label} audience.

Target market: {target}
{context}

Produce a detailed slide-by-slide outline for a {slide_count}-slide presentation deck
covering:
1. Title slide with tagline
2. Executive summary (2 slides)
3. Market opportunity (2 slides) — macro data, education market sizing
4. The Alpha Model — how 2hr Learning works, key outcomes data
5. Deal structure — partnership model, JV structure, revenue split
6. School portfolio — school types with pricing and capacity
7. 5-year rollout plan with milestones
8. Financial overview — P&L summary, returns, unit economics
9. Capital deployment — where the money goes
10. Risk mitigation
11. The team (placeholder)
12. Key asks and next steps
13. Appendix: detailed financial projections
14. Appendix: competitive landscape
15. Appendix: regulatory overview

For each slide provide: title, key bullet points (4-6), data callouts, and speaker notes.
"""


async def generate_documents(
    target: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    strategy: Strategy,
    financial_model: FinancialModel,
    assumptions: FinancialAssumptions,
    audience: AudienceType = AudienceType.INVESTOR,
    revision_notes: str | None = None,
) -> tuple[str, str, str]:
    """Generate presentation deck, proposal doc, and spreadsheet.

    Returns (pptx_path, docx_path, xlsx_path).
    """
    logger.info("Generating documents for %s (audience: %s)", target, audience.value)

    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)

    # --- Build context ---
    context = _build_context(country_profile, strategy, financial_model)

    audience_labels = {
        AudienceType.ROYAL: "a Royal Family / Head of State",
        AudienceType.MINISTER: "a Minister of Education / Government Official",
        AudienceType.INVESTOR: "a VC/Institutional Investor",
    }

    # --- Get deck content from LLM ---
    deck_outline = await call_llm_plain(
        system_prompt=DECK_OUTLINE_PROMPT.format(
            target=target,
            context=context,
            audience_label=audience_labels.get(audience, "investor"),
            slide_count=18,
        ),
        user_prompt=(
            f"Produce the detailed slide outline for {target}."
            f"{' Additional notes: ' + revision_notes if revision_notes else ''}"
        ),
    )

    # --- Generate PPTX ---
    pptx_path = _build_pptx(target, strategy, financial_model, deck_outline, audience, output_dir)

    # --- Generate DOCX proposal ---
    docx_path = await _build_proposal_docx(target, country_profile, strategy,
                                            financial_model, assumptions, audience, output_dir)

    # --- Generate XLSX (already done by financial agent, but path reference) ---
    from agents.financial import export_model_xlsx
    xlsx_path = export_model_xlsx(target, financial_model, assumptions)

    logger.info("Documents generated: %s, %s, %s", pptx_path, docx_path, xlsx_path)
    return pptx_path, docx_path, xlsx_path


def _build_context(
    country_profile: CountryProfile,
    strategy: Strategy,
    model: FinancialModel,
) -> str:
    parts = []
    cp = country_profile
    if cp.demographics.total_population:
        parts.append(f"Population: {cp.demographics.total_population:,.0f}")
    if cp.economy.gdp_per_capita:
        parts.append(f"GDP/capita: ${cp.economy.gdp_per_capita:,.0f}")
    if cp.target.tier:
        parts.append(f"Tier: {cp.target.tier}")
    if strategy.entry_mode:
        parts.append(f"Entry mode: {strategy.entry_mode.value}")
    if strategy.partnership_structure.type:
        parts.append(f"Partnership: {strategy.partnership_structure.type.value}")
    if model.pnl_projection:
        y5 = model.pnl_projection[-1]
        parts.append(f"Year 5 students: {y5.students:,}")
        parts.append(f"Year 5 revenue: ${y5.revenue:,.0f}")
        parts.append(f"Year 5 EBITDA: ${y5.ebitda:,.0f}")
    if model.returns_analysis.irr:
        parts.append(f"IRR: {model.returns_analysis.irr}%")
    if model.returns_analysis.moic:
        parts.append(f"MOIC: {model.returns_analysis.moic}x")
    return "\n".join(parts)


def _build_pptx(
    target: str,
    strategy: Strategy,
    model: FinancialModel,
    outline: str,
    audience: AudienceType,
    output_dir: str,
) -> str:
    """Build a professional PPTX presentation."""
    prs = Presentation()
    prs.slide_width = Inches(13.33)
    prs.slide_height = Inches(7.5)

    # Helper to add a styled slide
    def add_slide(title: str, bullets: list[str], subtitle: str = ""):
        slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank
        # Background
        bg = slide.background
        fill = bg.fill
        fill.solid()
        fill.fore_color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

        # Title bar
        left = Inches(0)
        top = Inches(0)
        width = prs.slide_width
        height = Inches(1.2)
        shape = slide.shapes.add_shape(1, left, top, width, height)  # rectangle
        shape.fill.solid()
        shape.fill.fore_color.rgb = DARK
        shape.line.fill.background()
        tf = shape.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = title
        p.font.size = Pt(28)
        p.font.color.rgb = WHITE
        p.font.bold = True
        p.alignment = PP_ALIGN.LEFT

        if subtitle:
            p2 = tf.add_paragraph()
            p2.text = subtitle
            p2.font.size = Pt(14)
            p2.font.color.rgb = RGBColor(0xAA, 0xAA, 0xAA)

        # Content
        content_top = Inches(1.5)
        content_left = Inches(0.8)
        content_width = Inches(11.5)
        content_height = Inches(5.5)
        txBox = slide.shapes.add_textbox(content_left, content_top, content_width, content_height)
        tf2 = txBox.text_frame
        tf2.word_wrap = True

        for i, bullet in enumerate(bullets[:8]):  # max 8 bullets
            p = tf2.paragraphs[0] if i == 0 else tf2.add_paragraph()
            p.text = bullet
            p.font.size = Pt(16)
            p.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
            p.space_after = Pt(8)

        # Footer
        footer = slide.shapes.add_textbox(Inches(0.5), Inches(7.0), Inches(12), Inches(0.4))
        fp = footer.text_frame.paragraphs[0]
        fp.text = f"CONFIDENTIAL — 2hr Learning (Alpha) | {target}"
        fp.font.size = Pt(9)
        fp.font.color.rgb = RGBColor(0x99, 0x99, 0x99)

        return slide

    # --- Slide 1: Title ---
    title_slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = title_slide.background
    bg.fill.solid()
    bg.fill.fore_color.rgb = DARK
    center_box = title_slide.shapes.add_textbox(Inches(1), Inches(2), Inches(11), Inches(3))
    tf = center_box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = f"2hr Learning × {target}"
    p.font.size = Pt(44)
    p.font.color.rgb = WHITE
    p.font.bold = True
    p.alignment = PP_ALIGN.CENTER
    p2 = tf.add_paragraph()
    p2.text = "Strategic Partnership Proposal"
    p2.font.size = Pt(24)
    p2.font.color.rgb = ACCENT
    p2.alignment = PP_ALIGN.CENTER
    p3 = tf.add_paragraph()
    p3.text = "CONFIDENTIAL"
    p3.font.size = Pt(14)
    p3.font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    p3.alignment = PP_ALIGN.CENTER

    # --- Slide 2: Executive Summary ---
    jv = strategy.brand.jv_name_suggestion or f"Alpha × {target}"
    exec_bullets = [
        f"Opportunity: Transform K-12 education in {target} through AI-powered learning",
        f"Partnership: {strategy.partnership_structure.type.value.upper() if strategy.partnership_structure.type else 'JV'} structure with local entity",
        f"Scale: {model.pnl_projection[-1].students:,} students across {model.pnl_projection[-1].schools} schools by Year 5" if model.pnl_projection else "Scale details in financial model",
        f"Investment: Year 5 revenue of ${model.pnl_projection[-1].revenue:,.0f}" if model.pnl_projection else "",
        f"Returns: {model.returns_analysis.irr}% IRR, {model.returns_analysis.moic}x MOIC" if model.returns_analysis.irr else "",
        "Proven model: UAE deal ($1.5B, 200K students) as reference",
    ]
    add_slide("Executive Summary", [b for b in exec_bullets if b])

    # --- Slide 3: The Alpha Model ---
    add_slide("The 2hr Learning Model", [
        "Timeback: AI compresses core academics into 2 hours/day",
        "Remaining time: STEM, sports, arts, entrepreneurship, life skills",
        "AlphaCore: Curriculum OS managing the full student journey",
        "Guide School: 12-month program transforming teachers into Guides",
        "Incept eduLLM: Custom AI adapted to local curriculum & culture",
        "Three commitments: Love school | Learn 2x faster | Future-ready skills",
    ])

    # --- Slide 4: Market Opportunity ---
    add_slide(f"Market Opportunity: {target}", [
        f"School-age population: significant K-12 cohort",
        "Education sector undergoing reform and modernisation",
        "Growing demand for premium, innovation-driven education",
        "Gap between aspirations and current system performance",
        "Government appetite for public-private partnerships",
        "Alpha's model addresses the core pain points",
    ])

    # --- Slide 5: Financial Overview ---
    if model.pnl_projection:
        y1 = model.pnl_projection[0]
        y5 = model.pnl_projection[-1]
        add_slide("5-Year Financial Summary", [
            f"Year 1: {y1.students:,} students → ${y1.revenue:,.0f} revenue → ${y1.ebitda:,.0f} EBITDA",
            f"Year 5: {y5.students:,} students → ${y5.revenue:,.0f} revenue → ${y5.ebitda:,.0f} EBITDA",
            f"IRR: {model.returns_analysis.irr}%" if model.returns_analysis.irr else "",
            f"MOIC: {model.returns_analysis.moic}x" if model.returns_analysis.moic else "",
            f"Management fee revenue (5yr): ${model.total_management_fee_revenue:,.0f}",
            f"Timeback license revenue (5yr): ${model.total_timeback_license_revenue:,.0f}",
        ])
    else:
        add_slide("Financial Overview", ["Financial model pending"])

    # --- Slide 6: Deal Structure ---
    add_slide("Proposed Deal Structure", [
        f"Structure: {strategy.partnership_structure.type.value.upper() if strategy.partnership_structure.type else 'JV'} with local partner",
        f"Ownership: {strategy.partnership_structure.ownership_split or '51/49 local-majority'}",
        f"Upfront IP fee: ${model.upfront_ip_fee:,.0f}",
        f"Management fee: {model.management_fee_pct*100:.0f}% of school revenue",
        f"Timeback license: {model.timeback_license_pct*100:.0f}% of per-student budget",
        "Local entity manages cultural IP layer, national identity integration",
    ])

    # --- Slide 7: School Portfolio ---
    if strategy.school_types:
        school_bullets = []
        for st in strategy.school_types[:4]:
            school_bullets.append(f"{st.name}: {st.focus or ''} — {st.tuition or ''}")
        add_slide("School Type Portfolio", school_bullets or ["School types to be defined"])
    else:
        add_slide("School Type Portfolio", ["Premium, Mid-Market, and Specialised school types"])

    # --- Slide 8: Rollout Plan ---
    if strategy.phased_rollout:
        rollout_bullets = [
            f"{ph.phase}: {ph.timeline} — {ph.student_count:,} students" if ph.student_count
            else f"{ph.phase}: {ph.timeline}"
            for ph in strategy.phased_rollout[:5]
        ]
        add_slide("5-Year Rollout Plan", rollout_bullets)
    else:
        add_slide("5-Year Rollout Plan", ["Phased rollout details in strategy report"])

    # --- Slide 9: Unit Economics ---
    ue_bullets = [
        f"{ue.school_type}: ${ue.per_student_revenue:,.0f}/student revenue, "
        f"${ue.contribution_margin:,.0f} margin ({ue.margin_pct}%)"
        for ue in model.unit_economics[:4]
    ]
    add_slide("Unit Economics", ue_bullets or ["Unit economics in financial model"])

    # --- Slide 10: Risk Mitigation ---
    add_slide("Risk Mitigation", [
        "Regulatory risk: Proactive government engagement and compliance",
        "Execution risk: Phased rollout with decision gates",
        "Cultural risk: Local IP layer and cultural advisory board",
        "FX risk: Local currency revenue with USD hedging strategy",
        "Competitive risk: Proprietary AI and outcomes data as moat",
        "Political risk: Multi-stakeholder alignment strategy",
    ])

    # --- Slide 11: Key Asks ---
    asks = strategy.key_asks[:6] if strategy.key_asks else [
        "Sovereign commitment to student volume targets",
        "Regulatory fast-track for school licensing",
        "Infrastructure/real estate support",
        "Cultural IP development partnership",
    ]
    add_slide("Key Asks & Next Steps", asks)

    # --- Slide 12: Appendix - P&L ---
    if model.pnl_projection:
        pnl_bullets = []
        for p in model.pnl_projection:
            pnl_bullets.append(
                f"Y{p.year}: {p.students:,} students | ${p.revenue:,.0f} rev | ${p.ebitda:,.0f} EBITDA | ${p.free_cash_flow:,.0f} FCF"
            )
        add_slide("Appendix: Detailed P&L Projection", pnl_bullets, "APPENDIX")

    # --- Slide 13: Appendix - Capital Deployment ---
    if model.capital_deployment:
        cap_bullets = [
            f"Year {cd.year}: ${cd.total:,.0f} total ({f'${cd.ip_development:,.0f} IP' if cd.ip_development else ''}"
            f" + ${cd.launch_capital:,.0f} launch + ${cd.real_estate:,.0f} RE)"
            for cd in model.capital_deployment
        ]
        add_slide("Appendix: Capital Deployment", cap_bullets, "APPENDIX")

    # --- Slide 14: Thank You ---
    ty_slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = ty_slide.background
    bg.fill.solid()
    bg.fill.fore_color.rgb = DARK
    ty_box = ty_slide.shapes.add_textbox(Inches(1), Inches(2.5), Inches(11), Inches(2))
    tf = ty_box.text_frame
    p = tf.paragraphs[0]
    p.text = "Thank You"
    p.font.size = Pt(48)
    p.font.color.rgb = WHITE
    p.font.bold = True
    p.alignment = PP_ALIGN.CENTER
    p2 = tf.add_paragraph()
    p2.text = "2hr Learning — Transforming Education Globally"
    p2.font.size = Pt(20)
    p2.font.color.rgb = ACCENT
    p2.alignment = PP_ALIGN.CENTER

    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_investor_deck.pptx")
    prs.save(path)
    return path


async def _build_proposal_docx(
    target: str,
    country_profile: CountryProfile,
    strategy: Strategy,
    model: FinancialModel,
    assumptions: FinancialAssumptions,
    audience: AudienceType,
    output_dir: str,
) -> str:
    """Build a high-level proposal document."""
    audience_labels = {
        AudienceType.ROYAL: "His/Her Excellency",
        AudienceType.MINISTER: "The Minister of Education",
        AudienceType.INVESTOR: "The Investment Committee",
    }

    prompt = f"""Write a formal high-level proposition document for {audience_labels.get(audience, 'the reader')}
regarding a strategic education partnership between 2hr Learning (Alpha) and {target}.

Key data points:
- Target: {target}
- Entry mode: {strategy.entry_mode.value if strategy.entry_mode else 'hybrid'}
- Year 5 students: {model.pnl_projection[-1].students:,} across {model.pnl_projection[-1].schools} schools
- Year 5 revenue: ${model.pnl_projection[-1].revenue:,.0f}
- IRR: {model.returns_analysis.irr}%
- MOIC: {model.returns_analysis.moic}x
- Upfront IP fee: ${model.upfront_ip_fee:,.0f}

Write in a formal, executive tone. Include sections for:
1. Introduction and vision
2. Partnership overview
3. The 2hr Learning model
4. Market opportunity
5. Proposed structure
6. Financial summary
7. Implementation timeline
8. Key terms and asks
9. Conclusion

Minimum 2,000 words. Be specific and data-driven."""

    proposal_text = await call_llm_plain(
        system_prompt="You are a senior partner drafting a formal proposition document.",
        user_prompt=prompt,
    )

    doc = DocxDocument()
    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = DocxPt(11)

    h = doc.add_heading(f"Strategic Partnership Proposal: 2hr Learning × {target}", level=0)
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph("CONFIDENTIAL & PROPRIETARY").alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_page_break()

    for line in proposal_text.split("\n"):
        s = line.strip()
        if s.startswith("# "):
            doc.add_heading(s[2:], level=1)
        elif s.startswith("## "):
            doc.add_heading(s[3:], level=2)
        elif s.startswith("### "):
            doc.add_heading(s[4:], level=3)
        elif s.startswith("- ") or s.startswith("* "):
            doc.add_paragraph(s[2:], style="List Bullet")
        elif s:
            doc.add_paragraph(s)

    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_proposal.docx")
    doc.save(path)
    return path
