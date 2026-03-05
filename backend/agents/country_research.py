"""Country Research Agent — builds a comprehensive country/state profile.

Determines tier classification and populates the shared context store with
demographic, economic, education, regulatory, political, and competitive data.
"""

from __future__ import annotations

import logging

from models.schemas import (
    CountryProfile,
    TargetInfo,
    TargetType,
    TierClassification,
    Demographics,
    Economy,
    EducationData,
    Regulatory,
    PoliticalContext,
    CompetitiveLandscape,
    Competitor,
    USStateESA,
)
from services.llm import call_llm
from services.perplexity import research_country, research_us_state
from services.world_bank import get_country_data

logger = logging.getLogger(__name__)

# US States list for detection
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
    """Detect whether the target is a US state or a sovereign nation."""
    if target.lower().strip() in US_STATES:
        return TargetType.US_STATE
    return TargetType.SOVEREIGN_NATION


def _classify_tier(gdp_per_capita: float | None, population: float | None) -> TierClassification:
    """Classify country tier based on GDP per capita and population."""
    if gdp_per_capita is None:
        return TierClassification.TIER_2  # default to mid-market

    if gdp_per_capita > 30_000 and (population is None or population > 1_000_000):
        return TierClassification.TIER_1
    elif gdp_per_capita >= 10_000 or (population is not None and population > 50_000_000):
        return TierClassification.TIER_2
    else:
        return TierClassification.TIER_3


COUNTRY_SYNTHESIS_PROMPT = """You are the Country Research Agent for 2hr Learning (Alpha).

Given the raw research data below, synthesize it into a structured country profile.
Extract specific numbers wherever available. If a data point is not available in the
research, use your knowledge to provide a reasonable estimate and mark it as estimated.

Focus on data that is critical for an education company evaluating market entry:
- Population and school-age demographics
- Economic indicators (GDP, income distribution)
- Education system structure and spending
- Regulatory environment for private schools
- Political context and reform appetite
- Competitive landscape

IMPORTANT: Be specific with numbers. Don't say "high" or "moderate" — give actual
figures or well-sourced estimates.

Output the analysis as a structured JSON object matching the CountryProfile schema.
"""


async def run_country_research(target: str) -> CountryProfile:
    """Execute the full country/state research pipeline."""
    target_type = _detect_target_type(target)
    logger.info("Researching %s (type: %s)", target, target_type.value)

    profile = CountryProfile()
    profile.target = TargetInfo(
        name=target,
        type=target_type,
        region="",
    )

    # --- Parallel data gathering ---
    if target_type == TargetType.US_STATE:
        perplexity_result = await research_us_state(target)
        # No World Bank data for US states
        wb_data: dict = {}
    else:
        perplexity_result = await research_country(target)
        wb_data = await get_country_data(target)

    # Store citations
    citations = perplexity_result.get("citations", [])
    if isinstance(citations, list):
        profile.research_sources = [str(c) for c in citations]

    research_text = perplexity_result.get("answer", "")

    # --- Populate from World Bank structured data ---
    if wb_data:
        profile.demographics.total_population = wb_data.get("population")
        profile.demographics.population_0_18 = wb_data.get("population_0_14")  # approximate
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

    # --- Use LLM to synthesize Perplexity research into structured data ---
    user_prompt = (
        f"Target: {target} ({target_type.value})\n\n"
        f"World Bank Data:\n{wb_data}\n\n"
        f"Research Data:\n{research_text}\n\n"
        "Synthesize all available data into a comprehensive country profile. "
        "Fill in every field you can with specific numbers."
    )

    try:
        synthesized: CountryProfile = await call_llm(
            system_prompt=COUNTRY_SYNTHESIS_PROMPT,
            user_prompt=user_prompt,
            output_schema=CountryProfile,
        )  # type: ignore

        # Merge: prefer World Bank structured data, fill gaps from LLM synthesis
        _merge_profiles(profile, synthesized)
    except Exception as exc:
        logger.warning("LLM synthesis failed: %s — using partial data", exc)

    # --- Classify tier ---
    if target_type == TargetType.SOVEREIGN_NATION:
        profile.target.tier = _classify_tier(
            profile.economy.gdp_per_capita,
            profile.demographics.total_population,
        )
    else:
        # US states don't get tier classification
        profile.target.tier = None

    # Determine region from LLM synthesis or default
    if not profile.target.region:
        profile.target.region = "North America" if target_type == TargetType.US_STATE else ""

    logger.info(
        "Country research complete: %s (tier=%s)",
        target,
        profile.target.tier,
    )
    return profile


def _merge_profiles(base: CountryProfile, synthesized: CountryProfile) -> None:
    """Merge synthesized LLM data into the base profile, preferring existing World Bank data."""
    # Demographics
    for field in Demographics.model_fields:
        base_val = getattr(base.demographics, field)
        synth_val = getattr(synthesized.demographics, field)
        if base_val is None and synth_val is not None:
            setattr(base.demographics, field, synth_val)

    # Economy
    for field in Economy.model_fields:
        base_val = getattr(base.economy, field)
        synth_val = getattr(synthesized.economy, field)
        if base_val is None and synth_val is not None:
            setattr(base.economy, field, synth_val)

    # Education
    for field in EducationData.model_fields:
        base_val = getattr(base.education, field)
        synth_val = getattr(synthesized.education, field)
        if base_val is None and synth_val is not None:
            setattr(base.education, field, synth_val)

    # Regulatory — overwrite from synthesized since World Bank doesn't have this
    if synthesized.regulatory:
        for field in Regulatory.model_fields:
            synth_val = getattr(synthesized.regulatory, field)
            if synth_val is not None:
                setattr(base.regulatory, field, synth_val)

    # Political context
    if synthesized.political_context:
        for field in PoliticalContext.model_fields:
            synth_val = getattr(synthesized.political_context, field)
            if synth_val is not None:
                setattr(base.political_context, field, synth_val)

    # Competitive landscape
    if synthesized.competitive_landscape:
        if synthesized.competitive_landscape.major_operators:
            base.competitive_landscape.major_operators = synthesized.competitive_landscape.major_operators
        if synthesized.competitive_landscape.international_chains:
            base.competitive_landscape.international_chains = synthesized.competitive_landscape.international_chains
        if synthesized.competitive_landscape.edtech_penetration:
            base.competitive_landscape.edtech_penetration = synthesized.competitive_landscape.edtech_penetration
        if synthesized.competitive_landscape.market_gaps:
            base.competitive_landscape.market_gaps = synthesized.competitive_landscape.market_gaps

    # US State ESA
    if synthesized.us_state_esa and base.us_state_esa is None:
        base.us_state_esa = synthesized.us_state_esa

    # Target info
    if not base.target.region and synthesized.target.region:
        base.target.region = synthesized.target.region
