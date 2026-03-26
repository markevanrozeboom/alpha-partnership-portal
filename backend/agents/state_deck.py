"""State Pitch Deck Generator — Oklahoma-style governor pitch via Gamma.

Produces a 10-slide deck tailored for US state governors, generated through
Gamma's API using the "Alpha School" theme.

Format: Problem → Results → Live Pilot → How It Works → The Deal →
Economics → What Each Side Provides → Gated Roadmap → The Ask.

Adapted from the Oklahoma deck used for Gov Stitt.
"""

from __future__ import annotations

import logging

from models.schemas import (
    CountryProfile, EducationAnalysis, Strategy,
    FinancialModel, FinancialAssumptions,
)
from services.llm import call_llm_plain
from services.gamma import generate_and_wait, _extract_gamma_url, _extract_export_url
from config.rules_loader import (
    get_esa_data,
    get_state_spending_data,
    get_spending_spotlight_national_trends,
)

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

# Fallback national average per-pupil spending (Reason Foundation Spending Spotlight 2025)
NATIONAL_AVG_PER_PUPIL_FALLBACK = 20_322

# ---------------------------------------------------------------------------
# Cover-image system — ensures Gamma picks correct state imagery for ALL states
# ---------------------------------------------------------------------------

US_STATE_CAPITALS: dict[str, str] = {
    "Alabama": "Montgomery", "Alaska": "Juneau", "Arizona": "Phoenix",
    "Arkansas": "Little Rock", "California": "Sacramento", "Colorado": "Denver",
    "Connecticut": "Hartford", "Delaware": "Dover", "Florida": "Tallahassee",
    "Georgia": "Atlanta", "Hawaii": "Honolulu", "Idaho": "Boise",
    "Illinois": "Springfield", "Indiana": "Indianapolis", "Iowa": "Des Moines",
    "Kansas": "Topeka", "Kentucky": "Frankfort", "Louisiana": "Baton Rouge",
    "Maine": "Augusta", "Maryland": "Annapolis", "Massachusetts": "Boston",
    "Michigan": "Lansing", "Minnesota": "Saint Paul", "Mississippi": "Jackson",
    "Missouri": "Jefferson City", "Montana": "Helena", "Nebraska": "Lincoln",
    "Nevada": "Carson City", "New Hampshire": "Concord", "New Jersey": "Trenton",
    "New Mexico": "Santa Fe", "New York": "Albany", "North Carolina": "Raleigh",
    "North Dakota": "Bismarck", "Ohio": "Columbus", "Oklahoma": "Oklahoma City",
    "Oregon": "Salem", "Pennsylvania": "Harrisburg", "Rhode Island": "Providence",
    "South Carolina": "Columbia", "South Dakota": "Pierre", "Tennessee": "Nashville",
    "Texas": "Austin", "Utah": "Salt Lake City", "Vermont": "Montpelier",
    "Virginia": "Richmond", "Washington": "Olympia", "West Virginia": "Charleston",
    "Wisconsin": "Madison", "Wyoming": "Cheyenne",
}

US_STATE_MAJOR_CITIES: dict[str, str] = {
    "Alabama": "Birmingham", "Alaska": "Anchorage", "Arizona": "Phoenix",
    "Arkansas": "Little Rock", "California": "Los Angeles or San Francisco",
    "Colorado": "Denver", "Connecticut": "Hartford or New Haven",
    "Delaware": "Wilmington", "Florida": "Miami or Orlando",
    "Georgia": "Atlanta", "Hawaii": "Honolulu", "Idaho": "Boise",
    "Illinois": "Chicago", "Indiana": "Indianapolis", "Iowa": "Des Moines",
    "Kansas": "Wichita", "Kentucky": "Louisville or Lexington",
    "Louisiana": "New Orleans", "Maine": "Portland",
    "Maryland": "Baltimore", "Massachusetts": "Boston",
    "Michigan": "Detroit", "Minnesota": "Minneapolis",
    "Mississippi": "Jackson", "Missouri": "Kansas City or St. Louis",
    "Montana": "Billings", "Nebraska": "Omaha",
    "Nevada": "Las Vegas", "New Hampshire": "Manchester",
    "New Jersey": "Newark or Jersey City", "New Mexico": "Albuquerque",
    "New York": "New York City", "North Carolina": "Charlotte or Raleigh",
    "North Dakota": "Fargo", "Ohio": "Columbus or Cleveland",
    "Oklahoma": "Oklahoma City or Tulsa", "Oregon": "Portland",
    "Pennsylvania": "Philadelphia or Pittsburgh",
    "Rhode Island": "Providence", "South Carolina": "Charleston or Columbia",
    "South Dakota": "Sioux Falls", "Tennessee": "Nashville or Memphis",
    "Texas": "Houston, Dallas, or San Antonio", "Utah": "Salt Lake City",
    "Vermont": "Burlington", "Virginia": "Virginia Beach or Richmond",
    "Washington": "Seattle", "West Virginia": "Charleston",
    "Wisconsin": "Milwaukee or Madison", "Wyoming": "Cheyenne",
}

# Explicit overrides for the most commonly confused states
STATE_COVER_IMAGE_OVERRIDES: dict[str, dict[str, str]] = {
    "Washington": {
        "use": "Seattle skyline with Space Needle and Mount Rainier, or Washington State Capitol in Olympia",
        "avoid": ("Washington D.C. monuments (White House, Capitol Building, "
                  "Lincoln Memorial) — those are the DISTRICT, not the state"),
    },
    "Georgia": {
        "use": "Atlanta skyline with Peachtree towers, Georgia State Capitol, or Savannah historic district",
        "avoid": "the country of Georgia (Tbilisi, Caucasus mountains), Miami (Florida), Charlotte (North Carolina)",
    },
    "Virginia": {
        "use": "Richmond skyline, Virginia State Capitol, Arlington skyline, or Shenandoah Valley",
        "avoid": "Washington D.C. monuments, Baltimore (Maryland) — do NOT use the White House or Lincoln Memorial",
    },
    "New York": {
        "use": "Manhattan skyline, Statue of Liberty, Empire State Building, Brooklyn Bridge, or Times Square",
        "avoid": "Philadelphia (Pennsylvania), Boston (Massachusetts), Newark (New Jersey)",
    },
    "New Jersey": {
        "use": "Atlantic City boardwalk, Newark skyline, Jersey Shore, or New Jersey State House in Trenton",
        "avoid": "Manhattan skyline (New York), Philadelphia (Pennsylvania) — do NOT show the Statue of Liberty",
    },
}


def _get_state_cover_image_instruction(state: str) -> str:
    """Return a geographically precise image instruction for any US state cover slide."""
    override = STATE_COVER_IMAGE_OVERRIDES.get(state)
    if override:
        return (
            f"[COVER IMAGE: Use a real, iconic photograph of {state}. "
            f"Specifically: {override['use']}. "
            f"DO NOT use imagery from other states or countries. "
            f"Specifically AVOID: {override['avoid']}. "
            f"The image must be unmistakably {state}.]"
        )

    capital = US_STATE_CAPITALS.get(state, "")
    major_city = US_STATE_MAJOR_CITIES.get(state, "")
    use_parts = []
    if major_city and major_city != capital:
        use_parts.append(f"the {major_city} skyline")
    if capital:
        use_parts.append(f"the {state} State Capitol in {capital}")
    use_parts.append(f"a famous landmark or landscape located in {state}")
    use_str = ", ".join(use_parts)

    return (
        f"[COVER IMAGE: Use a real, iconic photograph that is unmistakably the U.S. state of {state}. "
        f"Show: {use_str}. "
        f"CRITICAL: Do NOT use imagery from neighboring states or other countries. "
        f"The image must be verifiably located WITHIN {state}.]"
    )


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
    ss_data: dict | None = None,
    national_avg_per_pupil: float = NATIONAL_AVG_PER_PUPIL_FALLBACK,
) -> str:
    """Build the Gamma inputText with slide separators (\\n---\\n).

    Each section between separators becomes one slide/card in Gamma.
    """
    if ss_data is None:
        ss_data = {}
    slides: list[str] = []

    # --- Slide 1: Title ---
    cover_image_instruction = _get_state_cover_image_instruction(state)
    slides.append(
        f"# Alpha: AI-Powered Education for {state}\n\n"
        f"Better outcomes. Lower cost. Proven at scale.\n\n"
        f"CONFIDENTIAL\n\n"
        f"{cover_image_instruction}"
    )

    # --- Slide 2: The Problem ---
    problem_bullets = [
        f"- {state} K-12 system: {k12_students:,.0f} students across the state",
        f"- Per-pupil spending: ${per_pupil:,.0f}/student (national avg: ${national_avg_per_pupil:,.0f})",
    ]
    if ss_data.get("spending_rank"):
        problem_bullets.append(f"- Ranked #{ss_data['spending_rank']} in per-pupil spending nationally")
    if ss_data.get("naep_4th_reading_proficient_pct"):
        not_proficient = 100 - ss_data["naep_4th_reading_proficient_pct"]
        problem_bullets.append(f"- {not_proficient}% of 4th graders NOT proficient in reading (NAEP)")
    if ss_data.get("naep_4th_math_proficient_pct"):
        not_proficient_math = 100 - ss_data["naep_4th_math_proficient_pct"]
        problem_bullets.append(f"- {not_proficient_math}% of 4th graders NOT proficient in math (NAEP)")
    if ss_data.get("benefit_spending_per_pupil"):
        problem_bullets.append(
            f"- ${ss_data['benefit_spending_per_pupil']:,}/student goes to benefits (mostly pensions) — not classrooms"
        )
    problem_bullets.extend([
        "- This isn't a funding problem — it's a model problem",
        "- More money into the same system won't change outcomes",
    ])
    slides.append(
        f"# The Problem — {state} Needs a New Model\n\n" + "\n".join(problem_bullets)
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
        f"{state} spends ${per_pupil:,.0f}/student (national avg: ${national_avg_per_pupil:,.0f}).\n"
        f"Here's what Alpha costs:\n\n"
        f"- Intervention & Mark Rober Science: $2,000/student/year (outcomes-based)\n"
        f"  - {round(2000 / per_pupil * 100)}% of current per-pupil spend for transformational outcomes\n"
        f"- Full School Transformation: ~${timeback_cost:,}/student (20% of per-pupil)\n"
        f"  - Remaining 80% (${per_pupil - timeback_cost:,.0f}) covers guides, life skills, facility, ops\n"
        f"  - Same total budget. World-class outcomes."
    )
    if ss_data.get("benefit_spending_per_pupil"):
        econ_text += (
            f"\n\n- Currently ${ss_data['benefit_spending_per_pupil']:,}/student goes to employee benefits "
            f"(pension debt) — Alpha's model sidesteps this entirely"
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
        "Education is last. The governor who moves first wins.\n\n"
        "[DO NOT include any image on this slide. "
        "Use a clean, minimal design with text only — "
        "solid background, no photos, no icons, no placeholders.]"
    )

    return "\n---\n".join(slides)


def _build_state_deck_additional_instructions(state: str) -> str:
    """Build Gamma additional_instructions with state-specific image guidance."""
    override = STATE_COVER_IMAGE_OVERRIDES.get(state)
    if override:
        title_img = (
            f"TITLE SLIDE IMAGE — GEOGRAPHIC ACCURACY IS CRITICAL: "
            f"The first slide MUST feature a prominent, iconic image of {state}. "
            f"USE: {override['use']}. "
            f"DO NOT USE: {override['avoid']}. "
            f"Using imagery from the wrong state is a serious error. "
            f"Verify the landmark is actually located in {state} before selecting it."
        )
    else:
        capital = US_STATE_CAPITALS.get(state, "")
        major_city = US_STATE_MAJOR_CITIES.get(state, "")
        use_parts = []
        if major_city and major_city != capital:
            use_parts.append(f"the {major_city} skyline")
        if capital:
            use_parts.append(f"the {state} State Capitol in {capital}")
        use_parts.append(f"a famous landmark in {state}")
        use_str = ", ".join(use_parts)
        title_img = (
            f"TITLE SLIDE IMAGE — GEOGRAPHIC ACCURACY IS CRITICAL: "
            f"The first slide MUST feature a prominent, iconic image of the U.S. state of {state}. "
            f"USE: {use_str}. "
            f"Do NOT use imagery from neighboring states or other countries. "
            f"Verify the landmark is actually located in {state} before selecting it."
        )
    return (
        f"This is a governor pitch deck for {state}. "
        "Use a professional, data-driven tone. The audience is a state governor. "
        "Keep slides clean with clear hierarchy. Emphasise outcomes and proof points. "
        "Use the markdown headings (# Title) as card titles. "
        "Preserve all financial figures, percentages, and data points exactly as provided. "
        f"{title_img}"
    )


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

    # Get state-specific data (Spending Spotlight + ESA)
    esa_data = get_esa_data(state)
    ss_data = get_state_spending_data(state)
    national_trends = get_spending_spotlight_national_trends()

    # Prefer Spending Spotlight data, fall back to country_profile
    per_pupil = (
        ss_data.get("per_pupil_spending")
        or country_profile.education.avg_public_spend_per_student
        or 11_000
    )
    k12_students = (
        ss_data.get("k12_enrollment")
        or country_profile.education.k12_enrolled
        or 500_000
    )
    timeback_cost = round(per_pupil * PRICING["timeback_pct"] / 100)
    national_avg_per_pupil = national_trends.get(
        "per_pupil_spending", {}
    ).get("national_average_2023", NATIONAL_AVG_PER_PUPIL_FALLBACK)

    # Build state data context for LLM
    state_data_parts = []
    if country_profile.demographics.total_population:
        state_data_parts.append(f"Population: {country_profile.demographics.total_population:,.0f}")
    if k12_students:
        state_data_parts.append(f"K-12 students: {k12_students:,.0f}")
    if per_pupil:
        state_data_parts.append(f"Per-pupil spending: ${per_pupil:,.0f}")
        state_data_parts.append(f"National average per-pupil: ${national_avg_per_pupil:,.0f}")
    if ss_data.get("spending_rank"):
        state_data_parts.append(f"Spending rank: #{ss_data['spending_rank']} nationally")
    if ss_data.get("avg_teacher_salary"):
        state_data_parts.append(f"Avg teacher salary: ${ss_data['avg_teacher_salary']:,.0f}")
    if ss_data.get("benefit_spending_per_pupil"):
        state_data_parts.append(f"Benefit spending per pupil: ${ss_data['benefit_spending_per_pupil']:,.0f}")
    if ss_data.get("instructional_spending_pct"):
        state_data_parts.append(f"Instructional spending share: {ss_data['instructional_spending_pct']}%")
    if ss_data.get("enrollment_change_2020_2023_pct"):
        state_data_parts.append(f"Enrollment change (2020-2023): {ss_data['enrollment_change_2020_2023_pct']}%")
    if ss_data.get("naep_4th_reading_proficient_pct"):
        state_data_parts.append(
            f"NAEP 4th grade: {ss_data['naep_4th_reading_proficient_pct']}% reading proficient, "
            f"{ss_data.get('naep_4th_math_proficient_pct', 'N/A')}% math proficient"
        )
    if ss_data.get("naep_8th_reading_proficient_pct"):
        state_data_parts.append(
            f"NAEP 8th grade: {ss_data['naep_8th_reading_proficient_pct']}% reading proficient, "
            f"{ss_data.get('naep_8th_math_proficient_pct', 'N/A')}% math proficient"
        )
    if ss_data.get("student_teacher_ratio"):
        state_data_parts.append(f"Student-teacher ratio: {ss_data['student_teacher_ratio']}:1")
    if country_profile.education.pisa_scores:
        state_data_parts.append(f"Test scores: {country_profile.education.pisa_scores}")
    if country_profile.political_context.head_of_state:
        state_data_parts.append(f"Governor: {country_profile.political_context.head_of_state}")
    if esa_data:
        state_data_parts.append(f"ESA program: {esa_data.get('program_name', 'Yes')}")
        state_data_parts.append(f"ESA amount: ${esa_data.get('esa_amount', 'N/A')}/student")
    # Add national context from Spending Spotlight
    state_data_parts.append("\n--- National Context (Spending Spotlight 2025) ---")
    state_data_parts.append("Per-pupil spending rose 35.8% nationally (2002-2023) yet outcomes stagnated")
    state_data_parts.append("Avg teacher salary fell 6.1% despite increased spending")
    state_data_parts.append("Non-teaching staff grew 22.8% vs 4.1% enrollment growth")
    state_data_parts.append("Benefit spending per pupil rose 81.1% (pension debt)")
    state_data_parts.append("~40% of 4th graders below basic reading level (NAEP)")

    education_parts = []
    if education_analysis.system_diagnosis.primary_pain_points:
        pain_pts = "; ".join(education_analysis.system_diagnosis.primary_pain_points[:5])
        education_parts.append("Pain points: " + pain_pts)
    if education_analysis.system_diagnosis.government_pain_points:
        education_parts.append("Gov pain points: " +
                               "; ".join(education_analysis.system_diagnosis.government_pain_points[:5]))

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
        ss_data=ss_data, national_avg_per_pupil=national_avg_per_pupil,
    )

    # Generate via Gamma API
    try:
        result = await generate_and_wait(
            input_text,
            num_cards=11,
            text_mode="condense",
            card_split="inputTextBreaks",
            text_amount="extensive",
            additional_instructions=_build_state_deck_additional_instructions(state),
            export_as=export_as,
        )
    except Exception as exc:
        logger.warning("Gamma API unavailable, skipping state deck: %s", exc)
        return None, None, input_text

    # Use robust URL extraction (handles multiple key name variations)
    gamma_url = _extract_gamma_url(result)
    export_url = _extract_export_url(result)

    if not gamma_url and not export_url:
        logger.error(
            "Gamma generation completed for %s state deck but NO URLs found. "
            "Keys present: %s. Full response: %s",
            state, list(result.keys()), result,
        )
    else:
        logger.info("State deck generated via Gamma: url=%s, export=%s", gamma_url, export_url)

    return gamma_url, export_url, input_text
