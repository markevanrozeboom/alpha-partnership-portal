"""Strategy Agent — formulates go-to-market strategy and applies business rules.

Takes research outputs, enforces Section 2 business rules, and formulates
the partnership structure, school types, pricing, and phased rollout plan.
"""

from __future__ import annotations

import logging

from models.schemas import (
    Strategy,
    PartnershipStructure,
    Brand,
    SchoolTypeDeployment,
    PhaseRollout,
    ValueProposition,
    EntryMode,
    PartnershipType,
    CountryProfile,
    EducationAnalysis,
    TierClassification,
    TargetType,
    Gate1Decision,
)
from services.llm import call_llm

logger = logging.getLogger(__name__)

STRATEGY_PROMPT = """You are the Strategy Agent for 2hr Learning (Alpha).

You formulate the go-to-market strategy for Alpha's education operating system in a new market.
Alpha's stack: Timeback, AlphaCore, Guide School, Incept eduLLM.

## BUSINESS RULES (NON-NEGOTIABLE — you MUST enforce all of these):

1. Alpha ALWAYS retains IP ownership of Timeback, AlphaCore, Guide School, and Incept eduLLM.
2. Local partners or government fund real estate, marketing, and enrollment infrastructure.
3. A local IP layer (equivalent of AsasOne in UAE) is ALWAYS created and 100% owned by the local entity.
4. Management fee floor: 10% of per-student budget. NON-NEGOTIABLE.
5. Timeback license fee floor: 20% of per-student budget. NON-NEGOTIABLE.
6. Upfront IP development fee: minimum $25M for any country deal.
7. Management fee prepayment: minimum 2 years prepaid before operations begin.
8. Every proposal offers at least TWO school types.
9. Guide School must be established locally within the first 12 months.
10. All proposals include three commitments: (i) Children will love school, (ii) Children will learn 2x faster, (iii) Children will develop life skills for the AI age.

## SCALING FORMULA:
- PPP Factor = min(1.0, GDP_per_capita / $30,000)
- Upfront Ask = max($25M, school_age_pop × $2 × PPP_factor)
- Student Target (5yr) = max(5,000, school_age_pop × 0.01 × demand_factor)
- Per-Student Budget = max($5,000, min($30,000, private_school_avg_tuition × 0.8))
- Management Fee Rev. = Students × Per-Student Budget × 10% × 5 years
- Timeback License Rev. = Students × Per-Student Budget × 20% × 5 years

demand_factor: 1.0 for Tier 1, 0.5 for Tier 2, 0.2 for Tier 3

## TIER DEFINITIONS:
- Tier 1 ("UAE-Scale"): GDP/cap >$30K, pop >1M — Full JV model, $500M-$1.5B upfront
- Tier 2 ("Mid-Market"): GDP/cap $10K-$30K, or pop >50M — Scaled JV or licensing, $100M-$500M
- Tier 3 ("Emerging"): GDP/cap <$10K — Licensing or gov partnership, $25M-$100M

## US STATE MODEL (different from countries):
- No upfront government payment, no JV, no billion-dollar asks
- Revenue from: per-student tuition (private pay), ESA/voucher capture, state contracts
- School types: Micro School (12-25 students, $7K-$10K), Flagship Campus (250 students, $15K-$25K),
  Virtual/GT School (unlimited, $3K-$5K), STEM/Sports Academy (100-250, $12K-$20K)
- CAC < $500; LTV at ESA-level tuition over 5-year retention = $35K-$50K

## YOUR OUTPUT:
Produce a comprehensive strategy including entry mode, partnership structure, brand concept,
school types (minimum 2), phased rollout (Phase 0 through Phase 3), value propositions,
pitch angle, key asks, target student count, pricing, and upfront financial ask.

BE SPECIFIC. Use actual numbers from the research data. Calculate using the scaling formula.
"""


async def run_strategy(
    target: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    gate1_decision: Gate1Decision | None = None,
) -> Strategy:
    """Execute the Strategy Agent."""
    logger.info("Running strategy agent for %s", target)
    is_us_state = country_profile.target.type == TargetType.US_STATE
    tier = country_profile.target.tier

    # Determine entry mode from Gate 1 decision or education analysis recommendation
    entry_mode = EntryMode.HYBRID
    if gate1_decision and gate1_decision.entry_mode:
        entry_mode = gate1_decision.entry_mode
    elif education_analysis.two_hr_learning_fit.model_recommendation:
        entry_mode = education_analysis.two_hr_learning_fit.model_recommendation

    # Build context for LLM
    context_parts = [
        f"Target: {target}",
        f"Type: {'US State' if is_us_state else 'Sovereign Nation'}",
        f"Confirmed Entry Mode: {entry_mode.value}",
    ]

    if tier:
        context_parts.append(f"Tier: {tier}")

    # Demographics
    if country_profile.demographics.total_population:
        context_parts.append(f"Total Population: {country_profile.demographics.total_population:,.0f}")
    if country_profile.demographics.population_0_18:
        context_parts.append(f"School-age Population (0-18): {country_profile.demographics.population_0_18:,.0f}")

    # Economy
    if country_profile.economy.gdp_per_capita:
        context_parts.append(f"GDP per Capita: ${country_profile.economy.gdp_per_capita:,.0f}")
    if country_profile.economy.gdp:
        context_parts.append(f"GDP: ${country_profile.economy.gdp:,.0f}")
    if country_profile.economy.sovereign_wealth_fund:
        context_parts.append(f"SWF: {country_profile.economy.sovereign_wealth_fund}")

    # Education
    if country_profile.education.k12_enrolled:
        context_parts.append(f"K-12 Students: {country_profile.education.k12_enrolled:,.0f}")
    if country_profile.education.avg_private_tuition:
        context_parts.append(f"Avg Private Tuition: ${country_profile.education.avg_private_tuition:,.0f}")
    if country_profile.education.premium_private_tuition_range:
        context_parts.append(f"Premium Tuition Range: {country_profile.education.premium_private_tuition_range}")
    if country_profile.education.public_private_split:
        context_parts.append(f"Public/Private Split: {country_profile.education.public_private_split}")

    # Regulatory
    if country_profile.regulatory.foreign_ownership_rules:
        context_parts.append(f"Foreign Ownership Rules: {country_profile.regulatory.foreign_ownership_rules}")

    # Political
    if country_profile.political_context.national_vision_plan:
        context_parts.append(f"National Vision: {country_profile.political_context.national_vision_plan}")
    if country_profile.political_context.education_reform_priority:
        context_parts.append(f"Reform Priority: {country_profile.political_context.education_reform_priority}")

    # Competition
    if country_profile.competitive_landscape.market_gaps:
        context_parts.append(f"Market Gaps: {country_profile.competitive_landscape.market_gaps}")

    # US State ESA
    if is_us_state and country_profile.us_state_esa:
        esa = country_profile.us_state_esa
        if esa.esa_amount:
            context_parts.append(f"ESA Amount: {esa.esa_amount}")
        if esa.students_on_vouchers:
            context_parts.append(f"Students on Vouchers: {esa.students_on_vouchers}")
        if esa.eligibility:
            context_parts.append(f"ESA Eligibility: {esa.eligibility}")

    # Education Analysis
    context_parts.append("\n--- Education Analysis ---")
    if education_analysis.system_diagnosis.primary_pain_points:
        context_parts.append(f"Pain Points: {'; '.join(education_analysis.system_diagnosis.primary_pain_points)}")
    if education_analysis.reform_landscape.active_reforms:
        context_parts.append(f"Active Reforms: {'; '.join(education_analysis.reform_landscape.active_reforms)}")
    if education_analysis.two_hr_learning_fit.unique_value_propositions:
        context_parts.append(f"Alpha Value Props: {'; '.join(education_analysis.two_hr_learning_fit.unique_value_propositions)}")
    if education_analysis.two_hr_learning_fit.localisation_requirements:
        context_parts.append(f"Localisation Needs: {'; '.join(education_analysis.two_hr_learning_fit.localisation_requirements)}")

    if gate1_decision and gate1_decision.notes:
        context_parts.append(f"\nUser Notes from Gate 1: {gate1_decision.notes}")

    context = "\n".join(context_parts)

    user_prompt = (
        f"Research Context:\n{context}\n\n"
        "Formulate the complete go-to-market strategy for Alpha in this market. "
        "Apply the scaling formula with actual numbers. "
        "Ensure ALL business rules are enforced. "
        "Be specific with numbers, timelines, and pricing."
    )

    try:
        result: Strategy = await call_llm(
            system_prompt=STRATEGY_PROMPT,
            user_prompt=user_prompt,
            output_schema=Strategy,
        )  # type: ignore

        # --- Enforce business rules post-generation ---
        result.entry_mode = entry_mode
        result = _enforce_business_rules(result, country_profile, is_us_state, tier)

        logger.info("Strategy complete for %s", target)
        return result

    except Exception as exc:
        logger.error("Strategy agent failed: %s", exc)
        # Return minimum viable strategy
        return _build_fallback_strategy(target, country_profile, entry_mode, is_us_state, tier)


def _enforce_business_rules(
    strategy: Strategy,
    profile: CountryProfile,
    is_us_state: bool,
    tier: TierClassification | None,
) -> Strategy:
    """Enforce Section 2C non-negotiable business rules."""

    # Rule 8: At least two school types
    if len(strategy.school_types) < 2:
        if is_us_state:
            strategy.school_types = [
                SchoolTypeDeployment(
                    name="Micro School", focus="Core academics + life skills",
                    target_market="ESA families", size="12-25 students", tuition="$7,000-$10,000"
                ),
                SchoolTypeDeployment(
                    name="Virtual (GT School)", focus="Online learning + homeschool support",
                    target_market="Homeschool, rural, ESA-funded", size="Unlimited", tuition="$3,000-$5,000"
                ),
            ]
        else:
            strategy.school_types = [
                SchoolTypeDeployment(
                    name="Flagship Campus", focus="Full Alpha experience",
                    target_market="Upper-middle income families", size="250 students", tuition="$15,000-$25,000"
                ),
                SchoolTypeDeployment(
                    name="STEM Academy", focus="STEM + technology emphasis",
                    target_market="Tech-forward families", size="100-250 students", tuition="$12,000-$20,000"
                ),
            ]

    # Rule 6: Minimum $25M upfront for country deals
    if not is_us_state and (strategy.upfront_ask is None or strategy.upfront_ask < 25_000_000):
        # Apply scaling formula
        school_age_pop = profile.demographics.population_0_18 or 1_000_000
        gdp_pc = profile.economy.gdp_per_capita or 15_000
        ppp_factor = min(1.0, gdp_pc / 30_000)
        strategy.upfront_ask = max(25_000_000, school_age_pop * 2 * ppp_factor)

    # Rule 4 & 5: Fee floors
    if strategy.per_student_budget:
        # Ensure management fee >= 10%
        # Ensure timeback license >= 20%
        pass  # These are enforced in the financial model

    # Ensure phased rollout exists
    if not strategy.phased_rollout:
        strategy.phased_rollout = [
            PhaseRollout(phase="Phase 0", timeline="Months 0-6", student_count=0,
                        milestones=["Licensing & regulatory approval", "Guide School establishment", "Real estate secured"]),
            PhaseRollout(phase="Phase 1", timeline="Months 6-18", student_count=5000,
                        milestones=["First schools open", "Initial enrollment", "Operational validation"]),
            PhaseRollout(phase="Phase 2", timeline="Year 2-3", student_count=25000,
                        milestones=["Expansion phase", "Additional school types", "Market penetration"]),
            PhaseRollout(phase="Phase 3", timeline="Year 3-5", student_count=strategy.target_student_count_year5 or 50000,
                        milestones=["Scale phase", "Full market presence", "Exit readiness"]),
        ]

    # Ensure value propositions include the three commitments
    commitment_pillars = {"Children will love school", "Children will learn 2x faster", "Life skills for the AI age"}
    existing_pillars = {vp.pillar for vp in strategy.value_propositions}
    if not commitment_pillars.issubset(existing_pillars):
        strategy.value_propositions = [
            ValueProposition(pillar="Children will love school",
                           proof_points=["Student satisfaction scores", "Engagement metrics", "Attendance rates"]),
            ValueProposition(pillar="Children will learn 2x faster",
                           proof_points=["Timeback compresses core academics into 2 hours", "Assessment data", "Grade advancement"]),
            ValueProposition(pillar="Life skills for the AI age",
                           proof_points=["Afternoon specialization programs", "Real-world projects", "AI literacy"]),
        ] + strategy.value_propositions

    return strategy


def _build_fallback_strategy(
    target: str,
    profile: CountryProfile,
    entry_mode: EntryMode,
    is_us_state: bool,
    tier: TierClassification | None,
) -> Strategy:
    """Build a minimum viable strategy when LLM fails."""
    school_age_pop = profile.demographics.population_0_18 or 1_000_000
    gdp_pc = profile.economy.gdp_per_capita or 15_000
    ppp_factor = min(1.0, gdp_pc / 30_000)
    avg_tuition = profile.education.avg_private_tuition or 10_000

    demand_factor = 1.0
    if tier == TierClassification.TIER_2:
        demand_factor = 0.5
    elif tier == TierClassification.TIER_3:
        demand_factor = 0.2

    student_target = max(5000, int(school_age_pop * 0.01 * demand_factor))
    per_student_budget = max(5000, min(30000, avg_tuition * 0.8))
    upfront_ask = max(25_000_000, school_age_pop * 2 * ppp_factor) if not is_us_state else 0

    return Strategy(
        entry_mode=entry_mode,
        partnership_structure=PartnershipStructure(
            type=PartnershipType.JV if tier == TierClassification.TIER_1 else PartnershipType.LICENSING,
            ip_structure="Alpha retains all IP; local entity owns local IP layer",
        ),
        brand=Brand(jv_name_suggestion=f"Alpha {target}"),
        school_types=[
            SchoolTypeDeployment(name="Flagship Campus", size="250 students",
                               tuition=f"${per_student_budget:,.0f}"),
            SchoolTypeDeployment(name="Virtual (GT School)", size="Unlimited",
                               tuition="$3,000-$5,000"),
        ],
        phased_rollout=[
            PhaseRollout(phase="Phase 0", timeline="Months 0-6", student_count=0,
                        milestones=["Setup"]),
            PhaseRollout(phase="Phase 1", timeline="Months 6-18", student_count=5000,
                        milestones=["Launch"]),
            PhaseRollout(phase="Phase 2", timeline="Year 2-3", student_count=int(student_target * 0.5),
                        milestones=["Expand"]),
            PhaseRollout(phase="Phase 3", timeline="Year 3-5", student_count=student_target,
                        milestones=["Scale"]),
        ],
        value_propositions=[
            ValueProposition(pillar="Children will love school", proof_points=["Student satisfaction"]),
            ValueProposition(pillar="Children will learn 2x faster", proof_points=["Timeback platform"]),
            ValueProposition(pillar="Life skills for the AI age", proof_points=["AI-era curriculum"]),
        ],
        target_student_count_year5=student_target,
        per_student_budget=per_student_budget,
        upfront_ask=upfront_ask,
    )
