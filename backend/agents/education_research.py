"""Education System Research Agent — deep-dives into education data.

Analyzes what's broken, what reforms are underway, and where
2hr Learning's model creates the sharpest wedge.
"""

from __future__ import annotations

import logging

from models.schemas import (
    EducationAnalysis,
    SystemDiagnosis,
    ReformLandscape,
    TwoHrLearningFit,
    EntryMode,
    CountryProfile,
    TargetType,
)
from services.llm import call_llm
from services.perplexity import research_education

logger = logging.getLogger(__name__)

EDUCATION_SYNTHESIS_PROMPT = """You are the Education System Research Agent for 2hr Learning (Alpha).

Alpha's education operating system includes:
- **Timeback**: AI-powered learning platform that compresses core academics into 2 hours/day
- **AlphaCore**: The core curriculum and learning management system
- **Guide School**: Training program that turns traditional teachers into "Guides" for the new model
- **Incept eduLLM**: Custom education-focused large language model

Alpha's three commitments to every market:
1. Children will love school
2. Children will learn 2x faster
3. Children will develop life skills for the AI age

Your task: Analyze the education system of the target market and identify:
1. What is specifically broken (with data)
2. What reforms are being tried
3. Where Alpha's model creates the strongest differentiation
4. What localisation is needed
5. Whether the best entry mode is private, government partnership, or hybrid

Be specific. Use data. Cite pain points that Alpha's specific products solve.

For US states, focus on:
- ESA/voucher landscape and opportunity
- Charter school and micro-school culture
- Homeschool population and growth
- Regulatory environment for new school models
- Competitive landscape
"""


async def run_education_research(
    target: str,
    country_profile: CountryProfile,
) -> EducationAnalysis:
    """Execute the education research pipeline."""
    logger.info("Running education research for %s", target)
    is_us_state = country_profile.target.type == TargetType.US_STATE

    # --- Perplexity deep research ---
    perplexity_result = await research_education(target)
    research_text = perplexity_result.get("answer", "")

    # --- Build context from country profile ---
    context_parts = [
        f"Target: {target}",
        f"Type: {'US State' if is_us_state else 'Sovereign Nation'}",
    ]

    if country_profile.target.tier:
        context_parts.append(f"Tier: {country_profile.target.tier}")
    if country_profile.education.k12_enrolled:
        context_parts.append(f"K-12 Enrollment: {country_profile.education.k12_enrolled:,.0f}")
    if country_profile.education.avg_private_tuition:
        context_parts.append(f"Avg Private Tuition: ${country_profile.education.avg_private_tuition:,.0f}")
    if country_profile.education.pisa_scores:
        context_parts.append(f"PISA Scores: {country_profile.education.pisa_scores}")
    if country_profile.education.dropout_rate:
        context_parts.append(f"Dropout Rate: {country_profile.education.dropout_rate}%")
    if country_profile.regulatory.foreign_ownership_rules:
        context_parts.append(f"Foreign Ownership: {country_profile.regulatory.foreign_ownership_rules}")
    if country_profile.political_context.education_reform_priority:
        context_parts.append(f"Reform Priority: {country_profile.political_context.education_reform_priority}")
    if is_us_state and country_profile.us_state_esa:
        esa = country_profile.us_state_esa
        if esa.esa_amount:
            context_parts.append(f"ESA Amount: {esa.esa_amount}")
        if esa.students_on_vouchers:
            context_parts.append(f"Students on Vouchers: {esa.students_on_vouchers}")

    context = "\n".join(context_parts)

    # --- LLM synthesis ---
    user_prompt = (
        f"Country/State Profile Context:\n{context}\n\n"
        f"Perplexity Research:\n{research_text}\n\n"
        "Analyze this education system and produce a comprehensive education analysis. "
        "Be specific about pain points, reform landscape, and where 2hr Learning's "
        "model (Timeback, AlphaCore, Guide School, Incept eduLLM) creates the "
        "sharpest differentiation. Recommend the best entry mode."
    )

    try:
        result: EducationAnalysis = await call_llm(
            system_prompt=EDUCATION_SYNTHESIS_PROMPT,
            user_prompt=user_prompt,
            output_schema=EducationAnalysis,
        )  # type: ignore
        logger.info("Education research complete for %s", target)
        return result
    except Exception as exc:
        logger.error("Education research LLM synthesis failed: %s", exc)
        # Return a minimal analysis
        return EducationAnalysis(
            system_diagnosis=SystemDiagnosis(
                primary_pain_points=["Data synthesis failed — manual review needed"],
            ),
            reform_landscape=ReformLandscape(),
            two_hr_learning_fit=TwoHrLearningFit(
                model_recommendation=EntryMode.HYBRID,
                rationale="Default recommendation pending manual review",
            ),
        )
