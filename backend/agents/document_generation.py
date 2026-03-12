"""Document Generation Agent — produces executive-quality investor deck and
investment memorandum (proposal document).

Generates slide decks via Gamma API and DOCX with appendices, formatted for
C-suite / head-of-state audiences.  The DOCX proposal is structured as a full
investment memorandum modelled after Goldman Sachs / Morgan Stanley deal books.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime

from services.gamma import generate_and_wait

from docx import Document as DocxDocument
from docx.shared import Pt as DocxPt, RGBColor as DocxRGB, Inches as DocxInches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

from models.schemas import (
    CountryProfile, EducationAnalysis, Strategy,
    FinancialModel, FinancialAssumptions, AudienceType,
)
from services.llm import call_llm_plain
from config import OUTPUT_DIR

logger = logging.getLogger(__name__)



# ---------------------------------------------------------------------------
# Investment Memorandum Prompts (multi-section generation)
# ---------------------------------------------------------------------------

IM_SECTION_PROMPTS = {
    "executive_summary": """You are a Managing Director at Goldman Sachs' Investment Banking Division.
Write the EXECUTIVE SUMMARY section of an investment memorandum for a strategic education
partnership between 2hr Learning (Alpha) and {target}.

Context:
{context}

Write 1,500-2,000 words covering:
- Transaction overview and key investment highlights (5-7 bullet points at the top)
- The opportunity: why this market, why now
- Brief description of 2hr Learning / Alpha model
- Proposed deal structure and partnership model
- Key financial highlights (revenue, EBITDA, IRR, MOIC)
- Risk/reward assessment summary
- Recommended next steps

Use formal investment banking prose. Include data points. Be specific and quantitative.""",

    "market_overview": """You are a VP at Goldman Sachs' Global Markets Research Division.
Write the MARKET OVERVIEW & MACRO ANALYSIS section of an investment memorandum for an
education partnership in {target}.

Context:
{context}

Country Data:
{country_data}

Write 2,000-2,500 words covering:
1. MACRO-ECONOMIC OVERVIEW — GDP, growth trajectory, per-capita income, wealth distribution,
   currency dynamics, sovereign ratings, fiscal position
2. DEMOGRAPHIC PROFILE — Population, youth bulge, urbanisation, middle-class growth,
   household income distribution
3. POLITICAL & REGULATORY LANDSCAPE — Government structure, stability, education governance,
   foreign investment regulations, PPP frameworks
4. NATIONAL VISION & REFORM AGENDA — Vision plans, education modernisation targets,
   digital transformation initiatives
5. COMPETITIVE LANDSCAPE — Existing private education operators, international schools,
   edtech players, market gaps

Include tables where relevant (markdown format). Use formal analytical language.
Cite specific data points with numbers, years, and sources.""",

    "education_deep_dive": """You are a Senior Partner at McKinsey & Company's Education Practice.
Write the EDUCATION SECTOR DEEP DIVE section of an investment memorandum for {target}.

Context:
{context}

Education Data:
{education_data}

Write 2,000-2,500 words covering:
1. CURRENT STATE OF EDUCATION — System structure, enrollment, public vs private split,
   per-pupil spending, teacher workforce, outcomes (PISA, literacy, graduation rates)
2. PAIN POINTS & SYSTEM FAILURES — Student disengagement, outdated pedagogy,
   skills gap for AI economy, parent frustration, teacher burnout
3. REFORM LANDSCAPE — Active government reforms, budget allocations, timeline, key stakeholders
4. PRIVATE EDUCATION MARKET — Market size (TAM/SAM/SOM), growth rate, segmentation,
   pricing tiers, demand-supply gap
5. THE ALPHA OPPORTUNITY — Specific gaps that the 2hr Learning model fills, competitive
   advantages vs incumbents, unique value propositions for this market

Include a market sizing table. Use consulting-quality analysis with specific data.""",

    "alpha_model": """You are the Chief Strategy Officer of 2hr Learning.
Write the THE 2HR LEARNING MODEL section of an investment memorandum.

Context:
{context}

Write 1,500-2,000 words covering:
1. THE INNOVATION — How Timeback works (AI compresses core academics into 2 hours/day),
   what students do with the remaining time (STEM, sports, arts, entrepreneurship, life skills)
2. THE TECHNOLOGY STACK — AlphaCore (curriculum OS), Incept eduLLM (custom AI for local curriculum),
   Guide School (teacher transformation program), Learning Intelligence Platform
3. PROVEN OUTCOMES — UAE reference deal ($1.5B, 200K students), learning outcomes data,
   student engagement metrics, parent satisfaction
4. SCALABILITY — How the model adapts to different markets, cultures, curricula, and
   languages while maintaining core quality
5. COMPETITIVE MOAT — Proprietary AI, outcomes data flywheel, curriculum IP, teacher training IP,
   government relationships
6. LOCALIZATION FOR {target} — Specific adaptations required for this market
   (cultural, curriculum, language, regulatory)

Be specific about outcomes data and the UAE reference deal.""",

    "deal_structure": """You are a Partner at a top-tier M&A advisory firm.
Write the PROPOSED DEAL STRUCTURE & PARTNERSHIP MODEL section of an investment memorandum
for the 2hr Learning × {target} partnership.

Context:
{context}

Strategy Data:
{strategy_data}

Write 1,500-2,000 words covering:
1. PARTNERSHIP STRUCTURE — JV/licensing/franchise structure, rationale for chosen structure,
   ownership split, governance framework, board composition
2. IP LICENSING & FEE STRUCTURE — Upfront IP licensing fee, ongoing management fees,
   Timeback license fees, fee escalation mechanisms, minimum guarantees
3. CAPITAL STRUCTURE — Total capital requirement, deployment phasing, funding sources,
   equity vs debt mix, potential co-investors
4. SCHOOL PORTFOLIO STRATEGY — School types (premium/mid/accessible), capacity per school,
   geographic rollout sequence, site selection criteria
5. GOVERNANCE & CONTROLS — Decision rights, quality assurance, curriculum oversight,
   brand protection, exit provisions
6. RISK ALLOCATION — How risks are shared between parties, insurance, force majeure,
   regulatory change provisions

Include a fee structure summary table. Be specific about numbers.""",

    "financial_analysis": """You are a Managing Director at Morgan Stanley's Financial Sponsors Group.
Write the FINANCIAL ANALYSIS section of an investment memorandum for the 2hr Learning × {target}
partnership.

Context:
{context}

Financial Data:
{financial_data}

Write 2,500-3,000 words covering:
1. KEY ASSUMPTIONS — Enrollment ramp, pricing by school type, cost structure,
   capital expenditure, working capital, PPP adjustments
2. 5-YEAR P&L PROJECTION — Year-by-year walkthrough of students, schools, revenue, COGS,
   gross margin, OPEX, EBITDA, net income, FCF. Include commentary on drivers and inflection points.
3. UNIT ECONOMICS — Per-student revenue, cost, and margin by school type.
   Compare to industry benchmarks.
4. REVENUE STREAMS — Management fees, Timeback license revenue, upfront IP fee.
   Break down Alpha's revenue vs JV entity revenue.
5. RETURNS ANALYSIS — IRR, MOIC, payback period, enterprise value at exit.
   Include sensitivity analysis on key variables.
6. CAPITAL DEPLOYMENT — Year-by-year capex schedule, IP development costs, launch capital,
   real estate/infrastructure.
7. VALUATION & COMPARABLE TRANSACTIONS — How this deal compares to recent education sector
   M&A and partnerships globally. EV/EBITDA, EV/Revenue multiples.

Include P&L summary table, returns summary table, and sensitivity matrix. Use rigorous
financial analysis language.""",

    "implementation_roadmap": """You are a Senior Partner at Bain & Company's Private Equity Group.
Write the IMPLEMENTATION ROADMAP & EXECUTION PLAN section of an investment memorandum for
the 2hr Learning × {target} partnership.

Context:
{context}

Strategy Data:
{strategy_data}

Write 1,500-2,000 words covering:
1. PHASE 1: ESTABLISHMENT (Months 1-12) — Legal entity setup, regulatory approvals,
   site selection, initial hiring, curriculum localization, pilot school launch
2. PHASE 2: PROOF OF CONCEPT (Months 12-24) — First school operations, outcomes measurement,
   parent feedback, government engagement, second school pipeline
3. PHASE 3: SCALE-UP (Year 2-3) — Expansion to additional cities/regions, teacher training
   at scale, technology platform deployment, marketing ramp
4. PHASE 4: MARKET LEADERSHIP (Year 3-5) — Full portfolio deployment, brand establishment,
   government contract discussions, potential second-wave markets
5. KEY MILESTONES & DECISION GATES — Specific KPIs and go/no-go criteria for each phase
6. TEAM & ORGANIZATION — Key hires, organizational structure, advisory board, local leadership

Include a milestone timeline table.""",

    "risk_factors": """You are the Chief Risk Officer of a major investment bank.
Write the RISK FACTORS & MITIGATION section of an investment memorandum for the
2hr Learning × {target} partnership.

Context:
{context}

Write 1,500-2,000 words covering:
1. REGULATORY & LICENSING RISK — Private school licensing, curriculum approval,
   foreign ownership restrictions, changing regulations. Mitigation strategies.
2. POLITICAL & SOVEREIGN RISK — Government change, policy reversals, geopolitical events.
   Mitigation through multi-stakeholder alignment.
3. EXECUTION & OPERATIONAL RISK — Teacher recruitment, technology deployment, construction,
   quality maintenance at scale. Mitigation through phased rollout.
4. FINANCIAL & FX RISK — Currency fluctuation, inflation, revenue collection, pricing pressure.
   Hedging strategies.
5. COMPETITIVE RISK — New entrants, incumbent responses, edtech disruption.
   Mitigation through proprietary moat.
6. CULTURAL & SOCIAL RISK — Community acceptance, cultural sensitivity, parental concerns.
   Mitigation through local advisory board and cultural IP layer.
7. TECHNOLOGY RISK — AI model reliability, data privacy, cybersecurity.
   Mitigation through robust tech governance.
8. REPUTATIONAL RISK — Student safety, outcomes delivery, media scrutiny.
   Mitigation through quality assurance framework.

Rate each risk (High/Medium/Low probability and impact). Include a risk matrix table.""",

    "appendices": """You are a VP at Goldman Sachs preparing the APPENDICES section of an
investment memorandum for the 2hr Learning × {target} partnership.

Context:
{context}

Financial Data:
{financial_data}

Write 1,500-2,000 words covering:
1. APPENDIX A: DETAILED FINANCIAL PROJECTIONS — Complete 5-year P&L table with all line items,
   detailed assumptions behind each number
2. APPENDIX B: COMPARABLE TRANSACTIONS — Table of 5-10 comparable education sector deals
   globally (date, buyer, target, size, multiple, structure)
3. APPENDIX C: REGULATORY CHECKLIST — Step-by-step regulatory requirements for establishing
   private schools in {target}
4. APPENDIX D: KEY TERMS SHEET — Summary of proposed commercial terms (fee schedule,
   ownership, governance, exit provisions)
5. APPENDIX E: REFERENCE CONTACTS — Key government contacts, potential local partners,
   advisory firms (use placeholder names)

Format as clean appendix sections with tables where appropriate.""",
}


async def generate_documents(
    target: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    strategy: Strategy,
    financial_model: FinancialModel,
    assumptions: FinancialAssumptions,
    audience: AudienceType = AudienceType.INVESTOR,
    revision_notes: str | None = None,
) -> tuple[str | None, str | None, str, str]:
    """Generate presentation deck (via Gamma), investment memorandum, and spreadsheet.

    Returns (gamma_url, export_url, docx_path, xlsx_path).
    """
    logger.info("Generating documents for %s (audience: %s)", target, audience.value)

    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)

    # --- Build context strings ---
    context = _build_context(country_profile, strategy, financial_model)
    country_data = _build_country_data(country_profile)
    education_data = _build_education_data(education_analysis)
    strategy_data = _build_strategy_data(strategy)
    financial_data = _build_financial_data(financial_model, assumptions)

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

    # --- Generate investor deck via Gamma ---
    gamma_url, export_url = await _build_investor_deck_gamma(
        target, strategy, financial_model, deck_outline, audience,
    )

    # --- Generate DOCX investment memorandum (multi-section) ---
    docx_path = await _build_investment_memorandum(
        target, country_profile, education_analysis, strategy,
        financial_model, assumptions, audience, output_dir,
        context, country_data, education_data, strategy_data, financial_data,
        revision_notes,
    )

    # --- Generate XLSX ---
    from agents.financial import export_model_xlsx
    xlsx_path = export_model_xlsx(target, financial_model, assumptions, country_profile)

    logger.info("Documents generated: gamma=%s, docx=%s, xlsx=%s", gamma_url, docx_path, xlsx_path)
    return gamma_url, export_url, docx_path, xlsx_path


# ---------------------------------------------------------------------------
# Context builders
# ---------------------------------------------------------------------------

def _build_context(cp: CountryProfile, strategy: Strategy, model: FinancialModel) -> str:
    parts = []
    if cp.demographics.total_population:
        parts.append(f"Population: {cp.demographics.total_population:,.0f}")
    if cp.demographics.population_0_18:
        parts.append(f"Population 0-18: {cp.demographics.population_0_18:,.0f}")
    if cp.economy.gdp:
        parts.append(f"GDP: ${cp.economy.gdp:,.0f}")
    if cp.economy.gdp_per_capita:
        parts.append(f"GDP/capita: ${cp.economy.gdp_per_capita:,.0f}")
    if cp.economy.gdp_growth_rate:
        parts.append(f"GDP growth: {cp.economy.gdp_growth_rate}%")
    if cp.economy.credit_rating:
        parts.append(f"Sovereign rating: {cp.economy.credit_rating}")
    if cp.target.tier:
        parts.append(f"Tier: {cp.target.tier}")
    if strategy.entry_mode:
        parts.append(f"Entry mode: {strategy.entry_mode.value}")
    if strategy.partnership_structure.type:
        parts.append(f"Partnership: {strategy.partnership_structure.type.value}")
    if strategy.partnership_structure.ownership_split:
        parts.append(f"Ownership: {strategy.partnership_structure.ownership_split}")
    if model.upfront_ip_fee:
        parts.append(f"Upfront IP fee: ${model.upfront_ip_fee:,.0f}")
    if model.management_fee_pct:
        parts.append(f"Management fee: {model.management_fee_pct*100:.0f}%")
    if model.timeback_license_pct:
        parts.append(f"Timeback license: {model.timeback_license_pct*100:.0f}%")
    if model.pnl_projection:
        for p in model.pnl_projection:
            parts.append(f"Year {p.year}: {p.students:,} students, {p.schools} schools, "
                         f"${p.revenue:,.0f} revenue, ${p.ebitda:,.0f} EBITDA, ${p.free_cash_flow:,.0f} FCF")
    if model.returns_analysis.irr:
        parts.append(f"IRR: {model.returns_analysis.irr}%")
    if model.returns_analysis.moic:
        parts.append(f"MOIC: {model.returns_analysis.moic}x")
    if model.returns_analysis.payback_period_years:
        parts.append(f"Payback: {model.returns_analysis.payback_period_years} years")
    if model.total_management_fee_revenue:
        parts.append(f"Total mgmt fee revenue (5yr): ${model.total_management_fee_revenue:,.0f}")
    if model.total_timeback_license_revenue:
        parts.append(f"Total Timeback license revenue (5yr): ${model.total_timeback_license_revenue:,.0f}")
    return "\n".join(parts)


def _build_country_data(cp: CountryProfile) -> str:
    parts = []
    d = cp.demographics
    e = cp.economy
    r = cp.regulatory
    pc = cp.political_context
    ed = cp.education

    parts.append(f"Target: {cp.target.name} ({cp.target.type.value})")
    if d.total_population: parts.append(f"Population: {d.total_population:,.0f}")
    if d.population_0_18: parts.append(f"Youth (0-18): {d.population_0_18:,.0f}")
    if d.growth_rate: parts.append(f"Pop growth: {d.growth_rate}%")
    if d.urbanisation: parts.append(f"Urbanisation: {d.urbanisation}%")
    if d.median_age: parts.append(f"Median age: {d.median_age}")
    if d.median_household_income: parts.append(f"Median HH income: ${d.median_household_income:,.0f}")
    if d.gini_coefficient: parts.append(f"Gini: {d.gini_coefficient}")
    if e.gdp: parts.append(f"GDP: ${e.gdp:,.0f}")
    if e.gdp_per_capita: parts.append(f"GDP/capita: ${e.gdp_per_capita:,.0f}")
    if e.gdp_growth_rate: parts.append(f"GDP growth: {e.gdp_growth_rate}%")
    if e.currency: parts.append(f"Currency: {e.currency}")
    if e.fx_rate: parts.append(f"FX rate: {e.fx_rate}")
    if e.inflation: parts.append(f"Inflation: {e.inflation}%")
    if e.sovereign_wealth_fund: parts.append(f"SWF: {e.sovereign_wealth_fund}")
    if e.credit_rating: parts.append(f"Rating: {e.credit_rating}")
    if r.ministry_of_education: parts.append(f"MoE: {r.ministry_of_education}")
    if r.foreign_ownership_rules: parts.append(f"Foreign ownership: {r.foreign_ownership_rules}")
    if r.ppp_framework: parts.append(f"PPP: {r.ppp_framework}")
    if pc.government_type: parts.append(f"Government: {pc.government_type}")
    if pc.head_of_state: parts.append(f"Head of state: {pc.head_of_state}")
    if pc.national_vision_plan: parts.append(f"Vision plan: {pc.national_vision_plan}")
    if ed.k12_enrolled: parts.append(f"K-12 enrolled: {ed.k12_enrolled:,.0f}")
    if ed.public_private_split: parts.append(f"Public/private: {ed.public_private_split}")
    if ed.avg_private_tuition: parts.append(f"Avg private tuition: ${ed.avg_private_tuition:,.0f}")
    return "\n".join(parts)


def _build_education_data(ea: EducationAnalysis) -> str:
    parts = []
    if ea.system_diagnosis.primary_pain_points:
        parts.append("Student pain points: " + "; ".join(ea.system_diagnosis.primary_pain_points[:5]))
    if ea.system_diagnosis.parent_pain_points:
        parts.append("Parent pain points: " + "; ".join(ea.system_diagnosis.parent_pain_points[:5]))
    if ea.system_diagnosis.government_pain_points:
        parts.append("Government pain points: " + "; ".join(ea.system_diagnosis.government_pain_points[:5]))
    if ea.reform_landscape.active_reforms:
        parts.append("Active reforms: " + "; ".join(ea.reform_landscape.active_reforms[:5]))
    if ea.reform_landscape.reform_budget:
        parts.append(f"Reform budget: {ea.reform_landscape.reform_budget}")
    if ea.reform_landscape.appetite_for_foreign_models:
        parts.append(f"Appetite for foreign models: {ea.reform_landscape.appetite_for_foreign_models}")
    if ea.two_hr_learning_fit.unique_value_propositions:
        parts.append("Alpha UVPs: " + "; ".join(ea.two_hr_learning_fit.unique_value_propositions[:5]))
    if ea.two_hr_learning_fit.model_recommendation:
        parts.append(f"Recommended entry: {ea.two_hr_learning_fit.model_recommendation.value}")
    return "\n".join(parts)


def _build_strategy_data(s: Strategy) -> str:
    parts = []
    if s.entry_mode: parts.append(f"Entry mode: {s.entry_mode.value}")
    if s.partnership_structure.type: parts.append(f"Partnership: {s.partnership_structure.type.value}")
    if s.partnership_structure.ownership_split: parts.append(f"Ownership: {s.partnership_structure.ownership_split}")
    if s.partnership_structure.ip_structure: parts.append(f"IP: {s.partnership_structure.ip_structure}")
    if s.brand.jv_name_suggestion: parts.append(f"JV name: {s.brand.jv_name_suggestion}")
    if s.school_types:
        for st in s.school_types[:4]:
            parts.append(f"School type: {st.name} — {st.focus or ''} — {st.tuition or ''}")
    if s.phased_rollout:
        for ph in s.phased_rollout[:5]:
            parts.append(f"Phase: {ph.phase} ({ph.timeline}) — {ph.student_count or 'TBD'} students")
    if s.key_asks:
        parts.append("Key asks: " + "; ".join(s.key_asks[:6]))
    if s.target_student_count_year5: parts.append(f"Y5 target: {s.target_student_count_year5:,} students")
    if s.upfront_ask: parts.append(f"Upfront ask: ${s.upfront_ask:,.0f}")
    return "\n".join(parts)


def _build_financial_data(model: FinancialModel, assumptions: FinancialAssumptions) -> str:
    parts = []
    for a in assumptions.assumptions:
        parts.append(f"{a.label}: {a.value} {a.unit}")
    parts.append("")
    if model.pnl_projection:
        parts.append("P&L Projection:")
        for p in model.pnl_projection:
            parts.append(
                f"  Y{p.year}: {p.students:,} students | {p.schools} schools | "
                f"${p.revenue:,.0f} rev | ${p.cogs:,.0f} COGS | ${p.gross_margin:,.0f} GM | "
                f"${p.opex:,.0f} OPEX | ${p.ebitda:,.0f} EBITDA | ${p.net_income:,.0f} NI | "
                f"${p.free_cash_flow:,.0f} FCF | ${p.cumulative_cash:,.0f} cum"
            )
    if model.unit_economics:
        parts.append("\nUnit Economics:")
        for ue in model.unit_economics:
            parts.append(f"  {ue.school_type}: ${ue.per_student_revenue:,.0f}/student, "
                         f"${ue.contribution_margin:,.0f} margin ({ue.margin_pct}%)")
    if model.returns_analysis:
        ra = model.returns_analysis
        parts.append(f"\nReturns: IRR {ra.irr}%, MOIC {ra.moic}x, Payback {ra.payback_period_years}y, "
                     f"EV@exit ${ra.enterprise_value_at_exit:,.0f}" if ra.enterprise_value_at_exit else "")
    if model.sensitivity:
        parts.append("\nSensitivity:")
        for s in model.sensitivity:
            parts.append(f"  {s.variable}: base={s.base_case}, down={s.downside}, up={s.upside}")
    if model.capital_deployment:
        parts.append("\nCapital Deployment:")
        for cd in model.capital_deployment:
            parts.append(f"  Y{cd.year}: ${cd.total:,.0f} total "
                         f"(IP ${cd.ip_development:,.0f}, Mgmt ${cd.management_fees:,.0f}, "
                         f"Launch ${cd.launch_capital:,.0f}, RE ${cd.real_estate:,.0f})")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Investment Memorandum (DOCX) — multi-section generation
# ---------------------------------------------------------------------------

async def _build_investment_memorandum(
    target: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    strategy: Strategy,
    financial_model: FinancialModel,
    assumptions: FinancialAssumptions,
    audience: AudienceType,
    output_dir: str,
    context: str,
    country_data: str,
    education_data: str,
    strategy_data: str,
    financial_data: str,
    revision_notes: str | None = None,
) -> str:
    """Build a comprehensive investment memorandum (30-50+ pages) with multiple LLM calls."""

    logger.info("Generating investment memorandum for %s...", target)

    sections: list[tuple[str, str]] = []  # (section_title, markdown_content)

    # Generate each section with a separate LLM call for maximum quality and length
    section_configs = [
        ("executive_summary", "I. EXECUTIVE SUMMARY"),
        ("market_overview", "II. MARKET OVERVIEW & MACRO ANALYSIS"),
        ("education_deep_dive", "III. EDUCATION SECTOR DEEP DIVE"),
        ("alpha_model", "IV. THE 2HR LEARNING MODEL"),
        ("deal_structure", "V. PROPOSED DEAL STRUCTURE & PARTNERSHIP MODEL"),
        ("financial_analysis", "VI. FINANCIAL ANALYSIS"),
        ("implementation_roadmap", "VII. IMPLEMENTATION ROADMAP & EXECUTION PLAN"),
        ("risk_factors", "VIII. RISK FACTORS & MITIGATION"),
        ("appendices", "IX. APPENDICES"),
    ]

    for section_key, section_title in section_configs:
        prompt_template = IM_SECTION_PROMPTS[section_key]

        formatted_prompt = prompt_template.format(
            target=target,
            context=context,
            country_data=country_data,
            education_data=education_data,
            strategy_data=strategy_data,
            financial_data=financial_data,
        )

        # Add revision notes if provided
        user_prompt = f"Write the {section_title} section now."
        if revision_notes:
            user_prompt += f"\n\nAdditional revision notes from the user: {revision_notes}"

        try:
            section_content = await call_llm_plain(
                system_prompt=formatted_prompt,
                user_prompt=user_prompt,
            )
            sections.append((section_title, section_content))
            logger.info("Generated section: %s (%d chars)", section_title, len(section_content))
        except Exception as exc:
            logger.error("Failed to generate section %s: %s", section_title, exc)
            sections.append((section_title, f"[Section generation failed: {exc}]"))

    # --- Build the DOCX ---
    doc = DocxDocument()

    # Page setup
    for section in doc.sections:
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)
        section.left_margin = Cm(2.54)
        section.right_margin = Cm(2.54)

    # Set default font
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = DocxPt(11)
    style.font.color.rgb = DocxRGB(0x33, 0x33, 0x33)
    style.paragraph_format.space_after = DocxPt(6)
    style.paragraph_format.line_spacing = 1.15

    # Configure heading styles
    for level, (size, color, bold) in {
        1: (DocxPt(22), DocxRGB(0x1a, 0x1a, 0x2e), True),
        2: (DocxPt(16), DocxRGB(0x00, 0x6D, 0x77), True),
        3: (DocxPt(13), DocxRGB(0x33, 0x33, 0x33), True),
    }.items():
        heading_style = doc.styles[f"Heading {level}"]
        heading_style.font.size = size
        heading_style.font.color.rgb = color
        heading_style.font.bold = bold
        heading_style.font.name = "Calibri"
        heading_style.paragraph_format.space_before = DocxPt(18)
        heading_style.paragraph_format.space_after = DocxPt(8)

    # --- Cover Page ---
    doc.add_paragraph("")  # spacer
    doc.add_paragraph("")
    doc.add_paragraph("")

    cover_title = doc.add_paragraph()
    cover_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = cover_title.add_run(f"2hr Learning × {target}")
    run.font.size = DocxPt(36)
    run.font.color.rgb = DocxRGB(0x1a, 0x1a, 0x2e)
    run.bold = True

    cover_subtitle = doc.add_paragraph()
    cover_subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = cover_subtitle.add_run("INVESTMENT MEMORANDUM")
    run.font.size = DocxPt(18)
    run.font.color.rgb = DocxRGB(0x00, 0x6D, 0x77)
    run.bold = True

    doc.add_paragraph("")

    cover_line = doc.add_paragraph()
    cover_line.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = cover_line.add_run("Strategic Partnership Proposal for Education Transformation")
    run.font.size = DocxPt(14)
    run.font.color.rgb = DocxRGB(0x66, 0x66, 0x66)

    doc.add_paragraph("")
    doc.add_paragraph("")

    cover_conf = doc.add_paragraph()
    cover_conf.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = cover_conf.add_run("CONFIDENTIAL & PROPRIETARY")
    run.font.size = DocxPt(12)
    run.font.color.rgb = DocxRGB(0xCC, 0x00, 0x00)
    run.bold = True

    cover_date = doc.add_paragraph()
    cover_date.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = cover_date.add_run(datetime.now().strftime("%B %Y"))
    run.font.size = DocxPt(12)
    run.font.color.rgb = DocxRGB(0x99, 0x99, 0x99)

    doc.add_paragraph("")

    cover_prepared = doc.add_paragraph()
    cover_prepared.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = cover_prepared.add_run("Prepared by 2hr Learning — Alpha Division")
    run.font.size = DocxPt(11)
    run.font.color.rgb = DocxRGB(0x99, 0x99, 0x99)

    doc.add_page_break()

    # --- Disclaimer Page ---
    disclaimer = doc.add_heading("IMPORTANT NOTICE", level=2)
    disclaimer_text = (
        "This Investment Memorandum (the \"Memorandum\") has been prepared by 2hr Learning "
        "(\"Alpha\" or the \"Company\") solely for the purpose of providing information to "
        "prospective partners and investors in connection with a potential strategic partnership. "
        "This Memorandum is confidential and is being furnished to you solely for your information. "
        "It may not be reproduced or distributed to any other person.\n\n"
        "The information contained herein has been prepared in good faith and is believed to be "
        "reliable. However, no representation or warranty, express or implied, is made as to the "
        "accuracy, completeness, or fairness of the information and opinions contained in this "
        "Memorandum. Nothing in this document constitutes an offer, solicitation, or recommendation "
        "to invest.\n\n"
        "Certain statements in this Memorandum constitute forward-looking statements. These "
        "statements involve known and unknown risks, uncertainties, and other factors that may "
        "cause actual results to differ materially from those expressed or implied by such "
        "forward-looking statements.\n\n"
        "Recipients should conduct their own due diligence and seek independent professional "
        "advice before making any investment decision."
    )
    doc.add_paragraph(disclaimer_text)
    doc.add_page_break()

    # --- Table of Contents ---
    toc_heading = doc.add_heading("TABLE OF CONTENTS", level=1)
    doc.add_paragraph("")
    for _, section_title in section_configs:
        toc_entry = doc.add_paragraph()
        run = toc_entry.add_run(section_title)
        run.font.size = DocxPt(12)
        run.font.color.rgb = DocxRGB(0x00, 0x6D, 0x77)
        toc_entry.paragraph_format.space_after = DocxPt(6)

    doc.add_page_break()

    # --- Section Content ---
    for section_title, section_content in sections:
        doc.add_heading(section_title, level=1)

        # Parse markdown content into DOCX paragraphs
        _render_markdown_to_docx(doc, section_content)

        doc.add_page_break()

    # Save
    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_investment_memorandum.docx")
    doc.save(path)
    logger.info("Investment memorandum saved: %s", path)
    return path


def _render_markdown_to_docx(doc: DocxDocument, md: str) -> None:
    """Parse markdown text and render into DOCX paragraphs, headings, lists, and tables."""
    lines = md.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip empty lines
        if not stripped:
            i += 1
            continue

        # Headings
        if stripped.startswith("#### "):
            doc.add_heading(stripped[5:], level=3)
            i += 1
            continue
        if stripped.startswith("### "):
            doc.add_heading(stripped[4:], level=3)
            i += 1
            continue
        if stripped.startswith("## "):
            doc.add_heading(stripped[3:], level=2)
            i += 1
            continue
        if stripped.startswith("# "):
            doc.add_heading(stripped[2:], level=2)  # Use level 2 since level 1 is section title
            i += 1
            continue

        # Tables (detect pipe-delimited markdown tables)
        if "|" in stripped and stripped.startswith("|"):
            table_lines = []
            while i < len(lines) and "|" in lines[i].strip() and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1

            # Filter out separator lines (e.g., |---|---|)
            data_lines = [l for l in table_lines if not all(c in "|-: " for c in l)]

            if len(data_lines) >= 1:
                # Parse cells
                rows = []
                for tl in data_lines:
                    cells = [c.strip() for c in tl.split("|") if c.strip()]
                    rows.append(cells)

                if rows:
                    ncols = max(len(r) for r in rows)
                    table = doc.add_table(rows=len(rows), cols=ncols)
                    table.style = "Light Grid Accent 1"
                    table.alignment = WD_TABLE_ALIGNMENT.CENTER

                    for ri, row_data in enumerate(rows):
                        for ci, cell_text in enumerate(row_data):
                            if ci < ncols:
                                cell = table.rows[ri].cells[ci]
                                cell.text = cell_text
                                # Bold header row
                                if ri == 0:
                                    for paragraph in cell.paragraphs:
                                        for run in paragraph.runs:
                                            run.bold = True

                    doc.add_paragraph("")  # spacer after table
            continue

        # Bullet lists
        if stripped.startswith("- ") or stripped.startswith("* "):
            text = stripped[2:]
            # Check for bold prefix
            if text.startswith("**") and "**" in text[2:]:
                end_bold = text.index("**", 2)
                bold_part = text[2:end_bold]
                rest = text[end_bold+2:]
                if rest.startswith(": ") or rest.startswith(" — ") or rest.startswith(" - "):
                    p = doc.add_paragraph(style="List Bullet")
                    r1 = p.add_run(bold_part)
                    r1.bold = True
                    p.add_run(rest)
                else:
                    doc.add_paragraph(text, style="List Bullet")
            else:
                doc.add_paragraph(text, style="List Bullet")
            i += 1
            continue

        # Numbered lists
        if len(stripped) >= 3 and stripped[0].isdigit() and (stripped[1] == "." or (stripped[1].isdigit() and stripped[2] == ".")):
            # Find the text after the number and period
            dot_idx = stripped.index(".")
            text = stripped[dot_idx+1:].strip()
            doc.add_paragraph(text, style="List Number")
            i += 1
            continue

        # Horizontal rule
        if stripped in ("---", "***", "___"):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = DocxPt(12)
            p.paragraph_format.space_after = DocxPt(12)
            i += 1
            continue

        # Regular paragraph with bold/italic handling
        p = doc.add_paragraph()
        _add_formatted_text(p, stripped)
        i += 1


def _add_formatted_text(paragraph, text: str) -> None:
    """Add text to a paragraph with bold (**) and italic (*) formatting."""
    pos = 0
    while pos < len(text):
        # Bold
        bold_start = text.find("**", pos)
        if bold_start != -1:
            bold_end = text.find("**", bold_start + 2)
            if bold_end != -1:
                # Add text before bold
                if bold_start > pos:
                    paragraph.add_run(text[pos:bold_start])
                # Add bold text
                run = paragraph.add_run(text[bold_start+2:bold_end])
                run.bold = True
                pos = bold_end + 2
                continue

        # No more formatting — add the rest
        paragraph.add_run(text[pos:])
        break


# ---------------------------------------------------------------------------
# PPTX Deck
# ---------------------------------------------------------------------------

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


def _build_gamma_investor_input(
    target: str,
    strategy: Strategy,
    model: FinancialModel,
    outline: str,
    audience: AudienceType,
) -> str:
    """Build Gamma inputText for the investor deck with slide separators."""
    slides: list[str] = []

    # --- Slide 1: Title ---
    slides.append(
        f"# 2hr Learning × {target}\n\n"
        f"Strategic Partnership Proposal\n\n"
        f"CONFIDENTIAL"
    )

    # --- Slide 2: Executive Summary ---
    jv = strategy.brand.jv_name_suggestion or f"Alpha × {target}"
    exec_lines = [
        f"- Opportunity: Transform K-12 education in {target} through AI-powered learning",
        f"- Partnership: {strategy.partnership_structure.type.value.upper() if strategy.partnership_structure.type else 'JV'} structure with local entity",
    ]
    if model.pnl_projection:
        exec_lines.append(f"- Scale: {model.pnl_projection[-1].students:,} students across {model.pnl_projection[-1].schools} schools by Year 5")
        exec_lines.append(f"- Investment: Year 5 revenue of ${model.pnl_projection[-1].revenue:,.0f}")
    if model.returns_analysis.irr:
        exec_lines.append(f"- Returns: {model.returns_analysis.irr}% IRR, {model.returns_analysis.moic}x MOIC")
    exec_lines.append("- Proven model: UAE deal ($1.5B, 200K students) as reference")
    slides.append("# Executive Summary\n\n" + "\n".join(exec_lines))

    # --- Slide 3: The Alpha Model ---
    slides.append(
        "# The 2hr Learning Model\n\n"
        "- Timeback: AI compresses core academics into 2 hours/day\n"
        "- Remaining time: STEM, sports, arts, entrepreneurship, life skills\n"
        "- AlphaCore: Curriculum OS managing the full student journey\n"
        "- Guide School: 12-month program transforming teachers into Guides\n"
        "- Incept eduLLM: Custom AI adapted to local curriculum & culture\n"
        "- Three commitments: Love school | Learn 2x faster | Future-ready skills"
    )

    # --- Slide 4: Market Opportunity ---
    slides.append(
        f"# Market Opportunity: {target}\n\n"
        f"- School-age population: significant K-12 cohort\n"
        f"- Education sector undergoing reform and modernisation\n"
        f"- Growing demand for premium, innovation-driven education\n"
        f"- Gap between aspirations and current system performance\n"
        f"- Government appetite for public-private partnerships\n"
        f"- Alpha's model addresses the core pain points"
    )

    # --- Slide 5: Financial Overview ---
    if model.pnl_projection:
        y1 = model.pnl_projection[0]
        y5 = model.pnl_projection[-1]
        fin_lines = [
            f"- Year 1: {y1.students:,} students → ${y1.revenue:,.0f} revenue → ${y1.ebitda:,.0f} EBITDA",
            f"- Year 5: {y5.students:,} students → ${y5.revenue:,.0f} revenue → ${y5.ebitda:,.0f} EBITDA",
        ]
        if model.returns_analysis.irr:
            fin_lines.append(f"- IRR: {model.returns_analysis.irr}%")
        if model.returns_analysis.moic:
            fin_lines.append(f"- MOIC: {model.returns_analysis.moic}x")
        fin_lines.append(f"- Management fee revenue (5yr): ${model.total_management_fee_revenue:,.0f}")
        fin_lines.append(f"- Timeback license revenue (5yr): ${model.total_timeback_license_revenue:,.0f}")
        slides.append("# 5-Year Financial Summary\n\n" + "\n".join(fin_lines))
    else:
        slides.append("# Financial Overview\n\n- Financial model pending")

    # --- Slide 6: Deal Structure ---
    slides.append(
        f"# Proposed Deal Structure\n\n"
        f"- Structure: {strategy.partnership_structure.type.value.upper() if strategy.partnership_structure.type else 'JV'} with local partner\n"
        f"- Ownership: {strategy.partnership_structure.ownership_split or '51/49 local-majority'}\n"
        f"- Upfront IP fee: ${model.upfront_ip_fee:,.0f}\n"
        f"- Management fee: {model.management_fee_pct*100:.0f}% of school revenue\n"
        f"- Timeback license: {model.timeback_license_pct*100:.0f}% of per-student budget\n"
        f"- Local entity manages cultural IP layer, national identity integration"
    )

    # --- Slide 7: School Portfolio ---
    if strategy.school_types:
        school_lines = [f"- {st.name}: {st.focus or ''} — {st.tuition or ''}" for st in strategy.school_types[:4]]
        slides.append("# School Type Portfolio\n\n" + "\n".join(school_lines))
    else:
        slides.append("# School Type Portfolio\n\n- Premium, Mid-Market, and Specialised school types")

    # --- Slide 8: Rollout Plan ---
    if strategy.phased_rollout:
        rollout_lines = []
        for ph in strategy.phased_rollout[:5]:
            if ph.student_count:
                rollout_lines.append(f"- {ph.phase}: {ph.timeline} — {ph.student_count:,} students")
            else:
                rollout_lines.append(f"- {ph.phase}: {ph.timeline}")
        slides.append("# 5-Year Rollout Plan\n\n" + "\n".join(rollout_lines))
    else:
        slides.append("# 5-Year Rollout Plan\n\n- Phased rollout details in strategy report")

    # --- Slide 9: Unit Economics ---
    ue_lines = [
        f"- {ue.school_type}: ${ue.per_student_revenue:,.0f}/student revenue, "
        f"${ue.contribution_margin:,.0f} margin ({ue.margin_pct}%)"
        for ue in model.unit_economics[:4]
    ]
    slides.append("# Unit Economics\n\n" + ("\n".join(ue_lines) if ue_lines else "- Unit economics in financial model"))

    # --- Slide 10: Risk Mitigation ---
    slides.append(
        "# Risk Mitigation\n\n"
        "- Regulatory risk: Proactive government engagement and compliance\n"
        "- Execution risk: Phased rollout with decision gates\n"
        "- Cultural risk: Local IP layer and cultural advisory board\n"
        "- FX risk: Local currency revenue with USD hedging strategy\n"
        "- Competitive risk: Proprietary AI and outcomes data as moat\n"
        "- Political risk: Multi-stakeholder alignment strategy"
    )

    # --- Slide 11: Key Asks ---
    asks = strategy.key_asks[:6] if strategy.key_asks else [
        "Sovereign commitment to student volume targets",
        "Regulatory fast-track for school licensing",
        "Infrastructure/real estate support",
        "Cultural IP development partnership",
    ]
    slides.append("# Key Asks & Next Steps\n\n" + "\n".join(f"- {a}" for a in asks))

    # --- Slide 12: Appendix - P&L ---
    if model.pnl_projection:
        pnl_lines = [
            f"- Y{p.year}: {p.students:,} students | ${p.revenue:,.0f} rev | ${p.ebitda:,.0f} EBITDA | ${p.free_cash_flow:,.0f} FCF"
            for p in model.pnl_projection
        ]
        slides.append("# Appendix: Detailed P&L Projection\n\n" + "\n".join(pnl_lines))

    # --- Slide 13: Appendix - Capital Deployment ---
    if model.capital_deployment:
        cap_lines = [
            f"- Year {cd.year}: ${cd.total:,.0f} total ({f'${cd.ip_development:,.0f} IP' if cd.ip_development else ''}"
            f" + ${cd.launch_capital:,.0f} launch + ${cd.real_estate:,.0f} RE)"
            for cd in model.capital_deployment
        ]
        slides.append("# Appendix: Capital Deployment\n\n" + "\n".join(cap_lines))

    # --- Slide 14: Thank You ---
    slides.append(
        "# Thank You\n\n"
        "2hr Learning — Transforming Education Globally"
    )

    return "\n---\n".join(slides)


async def _build_investor_deck_gamma(
    target: str,
    strategy: Strategy,
    model: FinancialModel,
    outline: str,
    audience: AudienceType,
) -> tuple[str | None, str | None]:
    """Build the investor deck via Gamma API.

    Returns (gamma_url, export_url).
    """
    input_text = _build_gamma_investor_input(target, strategy, model, outline, audience)

    result = await generate_and_wait(
        input_text,
        num_cards=14,
        text_mode="preserve",
        card_split="inputTextBreaks",
        additional_instructions=(
            f"This is a strategic partnership proposal / investor deck for {target}. "
            "The audience is C-suite / head-of-state level. "
            "Use a professional, data-driven tone. Keep slides clean with clear hierarchy."
        ),
        export_as="pptx",
    )

    gamma_url = result.get("gammaUrl") or result.get("url")
    export_url = result.get("exportUrl") or result.get("pptxUrl")

    logger.info("Investor deck generated via Gamma: url=%s, export=%s", gamma_url, export_url)
    return gamma_url, export_url
