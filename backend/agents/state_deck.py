"""State Pitch Deck Generator — Oklahoma-style governor pitch via Gamma.

Produces a 10-slide deck tailored for US state governors, generated through
Gamma's API using the "Alpha School" theme.

Format: Problem → Results → Live Pilot → How It Works → The Deal →
Economics → What Each Side Provides → Gated Roadmap → The Ask.

Adapted from the Oklahoma deck used for Gov Stitt.
"""

from __future__ import annotations

import logging
import os

from models.schemas import (
    CountryProfile, EducationAnalysis, Strategy,
    FinancialModel, FinancialAssumptions,
)
from services.llm import call_llm_plain
from services.gamma import generate_and_wait
from config import OUTPUT_DIR
from config.rules_loader import get_esa_data

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Alpha reference data (confirmed by CFO)
# ---------------------------------------------------------------------------

ALPHA_RESULTS = {
    "avg_growth": "2.2x",
    "behind_growth": "4.9x",
    "love_school": "97%",
    "avg_sat": "1530",
    "ap_4_or_5": "94%",
    "lipscomb": "3x learning (Fall-Winter MAP)",
    "intervention_ela": "2x+",
    "intervention_math": "1.5-2x",
}

PRICING = {
    "intervention": 2_000,          # $/student/year for 1-hr block
    "mark_rober_science": 2_000,    # $/student/year for 1-hr block
    "timeback_pct": 20,             # % of per-pupil funding
}


# ---------------------------------------------------------------------------
# Prompt for state-specific research synthesis
# ---------------------------------------------------------------------------

STATE_DECK_PROMPT = """You are a senior director at Alpha Holdings preparing a governor pitch deck
for **{state}**. Using the data below, produce SPECIFIC NUMBERS for each slide.

State Data:
{state_data}

Education Data:
{education_data}

Strategy Summary:
{strategy_summary}

For each of the following, provide 3-5 bullet points with SPECIFIC DATA:

1. THE PROBLEM: {state}'s education rankings, NAEP scores, proficiency rates, graduation rate,
   per-pupil spending vs national average, total K-12 students, state education budget.
   Frame it as "this isn't a funding problem — it's a model problem."

2. WHAT {state_upper} GETS: What Alpha provides vs what the state provides (table format).
   Include alignment with governor's agenda and existing state policies.

3. ESA/VOUCHER OPPORTUNITY: If {state} has an ESA/voucher program, explain how Alpha's model
   works within it. ESA amount per student, total eligible students, how families can use
   ESA funds to access Alpha programs.

Return as structured markdown with ## headers for each section.
"""


def _build_gamma_input(
    state: str,
    per_pupil: float,
    k12_students: float,
    timeback_cost: int,
    esa_data: dict | None,
    llm_content: str,
) -> str:
    """Build the Gamma inputText with slide separators (\\n---\\n).

    Each section between separators becomes one slide/card in Gamma.
    """
    slides: list[str] = []

    # --- Slide 1: Title ---
    slides.append(
        f"# Alpha: AI-Powered Education for {state}\n\n"
        f"Better outcomes. Lower cost. Proven at scale.\n\n"
        f"CONFIDENTIAL"
    )

    # --- Slide 2: The Problem ---
    slides.append(
        f"# The Problem — {state} Needs a New Model\n\n"
        f"- {state} K-12 system: {k12_students:,.0f} students across the state\n"
        f"- Per-pupil spending: ${per_pupil:,.0f}/student\n"
        f"- This isn't a funding problem — it's a model problem\n"
        f"- The traditional classroom model hasn't delivered results\n"
        f"- More money into the same system won't change outcomes"
    )

    # --- Slide 3: We've Solved This ---
    slides.append(
        f"# We've Solved This — And We Can Prove It\n\n"
        f"- Alpha students: {ALPHA_RESULTS['avg_growth']} average growth (vs 1x expected)\n"
        f"- Students 2 years behind: {ALPHA_RESULTS['behind_growth']} growth\n"
        f"- {ALPHA_RESULTS['love_school']} of students love school (voted to keep school open over summer)\n"
        f"- Avg SAT: {ALPHA_RESULTS['avg_sat']} vs 1063 national\n"
        f"- Lipscomb Academy (Nashville): {ALPHA_RESULTS['lipscomb']}\n"
        f"- Intervention pilots: ELA {ALPHA_RESULTS['intervention_ela']}, Math {ALPHA_RESULTS['intervention_math']}"
    )

    # --- Slide 4: Live in Houston ---
    slides.append(
        "# Live in Houston — America's Largest Public School Pilot\n\n"
        "- HISD pilot: America's largest public school pilot\n"
        "- Partnership with Superintendent Miles\n"
        "- 2 campuses, 400 students, grades 3-8\n"
        "- Alpha owns students >50% of the day\n"
        "- Alpha investing $150k/campus + 5 guides per campus\n"
        "- This proves it works in PUBLIC schools, not just private"
    )

    # --- Slide 5: How It Works ---
    slides.append(
        "# How It Works — The Reinvented School Day\n\n"
        "- Children can master academics in 2 hours/day (Bloom's 2-Sigma)\n"
        "- AI makes 1:1 tutoring possible at scale for the first time\n"
        "- The freed time goes to life skills that parents actually want\n"
        "- Traditional: 6 hrs classroom instruction\n"
        "- Alpha Model: 2 hrs academic mastery + 4 hrs life skills\n"
        "- Teachers become coaches/mentors — AI handles instruction"
    )

    # --- Slide 6: The Deal ---
    slides.append(
        f"# The Deal — We Prove It, You Scale It\n\n"
        f"Our commitment: We take the pilot risk. Outcomes-based. You pay nothing unless targets hit.\n\n"
        f"Your commitment: When we hit numbers, you roll it out. Pre-agreed triggers.\n\n"
        f"- INTERVENTION: ${PRICING['intervention']:,}/student/yr — 1-hr AI tutoring block\n"
        f"  - Trigger: 60%+ NWEA MAP Growth → expand to all low-performing schools\n"
        f"- MARK ROBER SCIENCE: ${PRICING['mark_rober_science']:,}/student/yr — 1-hr science block\n"
        f"  - Trigger: hit targets → available to every public school\n"
        f"- FULL TRANSFORMATION: ~${timeback_cost:,}/student/yr (20% of per-pupil)\n"
        f"  - Trigger: hit targets → aggressive expansion statewide"
    )

    # --- Slide 7: The Economics ---
    econ_text = (
        f"# The Economics — What It Costs\n\n"
        f"{state} spends ${per_pupil:,.0f}/student. Here's what Alpha costs:\n\n"
        f"- Intervention & Mark Rober Science: $2,000/student/year (outcomes-based)\n"
        f"  - {round(2000/per_pupil*100)}% of current per-pupil spend for transformational outcomes\n"
        f"- Full School Transformation: ~${timeback_cost:,}/student (20% of per-pupil)\n"
        f"  - Remaining 80% (${per_pupil - timeback_cost:,.0f}) covers guides, life skills, facility, ops\n"
        f"  - Same total budget. World-class outcomes."
    )
    if esa_data and esa_data.get("esa_amount"):
        esa_amt = esa_data["esa_amount"]
        econ_text += f"\n\n- ESA/Voucher: ${esa_amt:,}/student covers Alpha programs directly"
    slides.append(econ_text)

    # --- Slide 8: What Each Side Gets ---
    slides.append(
        f"# What {state} Gets\n\n"
        f"**What Alpha Provides:**\n"
        f"- Timeback AI platform\n"
        f"- AlphaCore life-skills curriculum\n"
        f"- Guide training (teacher coaching)\n"
        f"- Ongoing management + support\n"
        f"- Outcomes guarantee (intervention tier)\n\n"
        f"**What {state.upper()} Provides:**\n"
        f"- Access to schools/districts\n"
        f"- Existing per-pupil funding\n"
        f"- Teachers willing to adopt the model\n"
        f"- Political support for innovation\n"
        f"- Adherence to daily model"
    )

    # --- Slide 9: Gated Expansion Roadmap ---
    slides.append(
        "# The Roadmap — Gated Expansion\n\n"
        "**Phase 1 — PROVE (SY 2026-27):**\n"
        "Pilot in low-performing schools | Alpha takes the risk | Outcomes-based\n"
        "Trigger: 60%+ NWEA MAP Growth, third-party verified\n\n"
        "**Phase 2 — EXPAND (SY 2027-28):**\n"
        "All low-performing schools + willing districts | Existing per-pupil funding\n"
        "Trigger: Results hold across pilot cohort\n\n"
        "**Phase 3 — TRANSFORM (SY 2028-29+):**\n"
        "Full school re-inventions statewide | Per-pupil + facility investment\n"
        "Contract signed before pilot starts. Triggers pre-agreed."
    )

    # --- Slide 10: The Ask ---
    slides.append(
        f"# The Ask\n\n"
        f"We'll prove it works, at our financial risk.\n"
        f"You commit now that when we hit targets, it scales — fast.\n\n"
        f"**What We Need from {state.upper()}:**\n"
        f"1. Access to low-performing schools for fall 2026 pilot\n"
        f"2. A signed expansion commitment: hit triggers → statewide rollout\n"
        f"3. A champion in the governor's office to clear blockers\n\n"
        f"**What You Get:**\n"
        f"- Zero financial risk on the pilot\n"
        f"- Third-party verified results before any state money moves\n"
        f"- {state} leads the nation in education innovation — that's the headline"
    )

    # --- Slide 11: Closing ---
    slides.append(
        "# AI is transforming every industry.\n\n"
        "Education is last. The governor who moves first wins."
    )

    return "\n---\n".join(slides)


async def generate_state_deck(
    state: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    strategy: Strategy,
    financial_model: FinancialModel,
    assumptions: FinancialAssumptions,
    export_as: str = "pptx",
) -> tuple[str | None, str | None, str]:
    """Generate an Oklahoma-style state pitch deck via Gamma.

    Returns (gamma_url, export_url, deck_input_text) — the Gamma viewer URL,
    the export download URL, and the raw input text sent to Gamma
    (so callers can request additional export formats if needed).
    Either URL may be None if the Gamma API doesn't return them.

    Args:
        export_as: 'pptx' or 'pdf' — controls the format of the export URL.
    """
    logger.info("Generating state pitch deck for %s via Gamma", state)

    # Get state-specific data
    esa_data = get_esa_data(state)
    per_pupil = country_profile.education.avg_public_spend_per_student or 11_000
    k12_students = country_profile.education.k12_enrolled or 500_000
    timeback_cost = round(per_pupil * PRICING["timeback_pct"] / 100)

    # Build state data context for LLM
    state_data_parts = []
    if country_profile.demographics.total_population:
        state_data_parts.append(f"Population: {country_profile.demographics.total_population:,.0f}")
    if k12_students:
        state_data_parts.append(f"K-12 students: {k12_students:,.0f}")
    if per_pupil:
        state_data_parts.append(f"Per-pupil spending: ${per_pupil:,.0f}")
    if country_profile.education.pisa_scores:
        state_data_parts.append(f"Test scores: {country_profile.education.pisa_scores}")
    if country_profile.political_context.head_of_state:
        state_data_parts.append(f"Governor: {country_profile.political_context.head_of_state}")
    if esa_data:
        state_data_parts.append(f"ESA program: {esa_data.get('program_name', 'Yes')}")
        state_data_parts.append(f"ESA amount: ${esa_data.get('esa_amount', 'N/A')}/student")

    education_parts = []
    if education_analysis.system_diagnosis.primary_pain_points:
        education_parts.append("Pain points: " + "; ".join(education_analysis.system_diagnosis.primary_pain_points[:5]))
    if education_analysis.system_diagnosis.government_pain_points:
        education_parts.append("Gov pain points: " + "; ".join(education_analysis.system_diagnosis.government_pain_points[:5]))

    strategy_parts = []
    if strategy.key_asks:
        strategy_parts.append("Key asks: " + "; ".join(strategy.key_asks[:5]))

    # Get LLM to synthesize state-specific content (used for context)
    llm_content = await call_llm_plain(
        system_prompt=STATE_DECK_PROMPT.format(
            state=state,
            state_upper=state.upper(),
            state_data="\n".join(state_data_parts),
            education_data="\n".join(education_parts),
            strategy_summary="\n".join(strategy_parts),
        ),
        user_prompt=f"Produce the state-specific data for the {state} governor pitch deck.",
    )

    # Build the Gamma input text
    input_text = _build_gamma_input(
        state, per_pupil, k12_students, timeback_cost, esa_data, llm_content,
    )

    # Generate via Gamma API
    try:
        result = await generate_and_wait(
            input_text,
            num_cards=11,
            text_mode="preserve",
            card_split="inputTextBreaks",
            additional_instructions=(
                f"This is a governor pitch deck for {state}. "
                "Use a professional, data-driven tone. The audience is a state governor. "
                "Keep slides clean with clear hierarchy. Emphasise outcomes and proof points."
            ),
            export_as=export_as,
        )
    except Exception as exc:
        logger.warning("Gamma API unavailable, skipping state deck: %s", exc)
        return None, None, input_text

    gamma_url = result.get("gammaUrl") or result.get("url")
    export_url = result.get("exportUrl") or result.get("pptxUrl") or result.get("pdfUrl")

    logger.info("State deck generated via Gamma: url=%s, export=%s", gamma_url, export_url)
    return gamma_url, export_url, input_text
