"""Financial Modelling Agent — investment-bank-quality financial model with interactive assumptions.

Phase 1: Generates configurable assumptions (sliders) from the strategy/country data.
Phase 2: Builds the full P&L, capital deployment, unit economics, returns analysis.
Recalculate: Deterministic recalculation when user adjusts sliders.
"""

from __future__ import annotations

import logging
import math
import os

from models.schemas import (
    FinancialAssumption, FinancialAssumptions,
    FinancialModel, YearProjection, UnitEconomics, CapitalDeployment,
    ReturnsAnalysis, SensitivityScenario,
    Strategy, CountryProfile, EducationAnalysis,
)
from services.llm import call_llm_plain
from config import OUTPUT_DIR
from config.rules_loader import (
    classify_tier as classify_country_tier,
    get_fee_floors, get_tier_defaults, get_esa_data,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Phase 1: Generate Assumptions
# ---------------------------------------------------------------------------

def generate_assumptions(
    target: str,
    country_profile: CountryProfile,
    strategy: Strategy,
) -> FinancialAssumptions:
    """Generate a set of configurable financial assumptions based on the strategy."""

    gdp_cap = country_profile.economy.gdp_per_capita or 30_000
    # PPP Factor: min(1.0, GDP_per_capita / $30,000) — SPECS 2D
    ppp_factor = min(1.0, gdp_cap / 30_000)

    # Per-Student Budget: max($5K, min($30K, private_school_avg_tuition × 0.8)) — SPECS 2D
    avg_private_tuition = country_profile.education.avg_private_tuition or round(25_000 * ppp_factor)
    base_per_student = max(5_000, min(30_000, round(avg_private_tuition * 0.8 / 500) * 500))

    # --- Tier 2/3 cohort-based model ---
    tier = country_profile.target.tier if country_profile.target.tier else None
    is_tier_23 = tier is not None and tier in (2, 3) and country_profile.target.type.value == "sovereign_nation"

    if is_tier_23:
        return _generate_cohort_assumptions(target, country_profile, strategy, ppp_factor, base_per_student)

    # --- Tier 1 / US State: Full model ---
    # Tuition ranges
    premium_tuition = max(15_000, round(base_per_student * 1.2 / 500) * 500)
    mid_tuition = max(12_000, round(base_per_student * 0.8 / 500) * 500)
    if country_profile.target.type.value == "us_state":
        # Load ESA-specific data from config if available
        esa_cfg = get_esa_data(target)
        if esa_cfg:
            esa_amount = esa_cfg.get("esa_amount", 8_000)
            base_per_student = max(esa_amount, 18_000)
            premium_tuition = max(25_000, esa_amount * 3)
            mid_tuition = max(15_000, esa_amount * 2)
            logger.info("Using ESA data for %s: $%s/student", target, esa_amount)
        else:
            base_per_student = 18_000
            premium_tuition = 25_000
            mid_tuition = 15_000

    # Student Target (5yr): must be ≥ 10% of school-age population (market size)
    school_age_pop = country_profile.demographics.population_0_18 or country_profile.education.k12_enrolled or 500_000
    # Floor: 10% of market size (school-age population)
    min_y5_from_market = int(school_age_pop * 0.10)
    target_students_y5 = strategy.target_student_count_year5 or max(5_000, min_y5_from_market)
    # Enforce 10% floor even if strategy suggested a lower number
    target_students_y5 = max(target_students_y5, min_y5_from_market)

    assumptions = [
        # --- Pricing ---
        FinancialAssumption(
            key="premium_tuition", label="Premium Tier Tuition (per student/year)",
            value=premium_tuition, min_val=15_000, max_val=50_000, step=500,
            unit="$", category="pricing",
            description="Annual tuition for flagship/premium schools"
        ),
        FinancialAssumption(
            key="mid_tuition", label="Mid-Tier Tuition (per student/year)",
            value=mid_tuition, min_val=10_000, max_val=35_000, step=500,
            unit="$", category="pricing",
            description="Annual tuition for mid-market schools"
        ),
        FinancialAssumption(
            key="per_student_budget", label="Per-Student Delivery Budget",
            value=base_per_student, min_val=5_000, max_val=30_000, step=500,
            unit="$", category="pricing",
            description="max($5K, min($30K, avg_private_tuition × 0.8))"
        ),

        # --- Scale ---
        FinancialAssumption(
            key="students_year1", label="Year 1 Students",
            value=min(5_000, target_students_y5 // 10), min_val=500, max_val=20_000, step=500,
            unit="students", category="scale",
            description="Students in flagship school(s) at launch"
        ),
        FinancialAssumption(
            key="students_year2", label="Year 2 Students",
            value=min(15_000, target_students_y5 // 5), min_val=2_000, max_val=50_000, step=1_000,
            unit="students", category="scale",
        ),
        FinancialAssumption(
            key="students_year3", label="Year 3 Students",
            value=min(50_000, target_students_y5 * 2 // 5), min_val=5_000, max_val=100_000, step=5_000,
            unit="students", category="scale",
        ),
        FinancialAssumption(
            key="students_year4", label="Year 4 Students",
            value=min(100_000, target_students_y5 * 3 // 5), min_val=10_000, max_val=200_000, step=5_000,
            unit="students", category="scale",
        ),
        FinancialAssumption(
            key="students_year5", label="Year 5 Students",
            value=target_students_y5, min_val=20_000, max_val=500_000, step=10_000,
            unit="students", category="scale",
        ),
        FinancialAssumption(
            key="avg_students_per_school", label="Avg Students per School",
            value=800, min_val=200, max_val=2000, step=50,
            unit="students", category="scale",
        ),

        # --- Costs ---
        FinancialAssumption(
            key="cogs_pct", label="COGS (% of Revenue)",
            value=55, min_val=40, max_val=75, step=1,
            unit="%", category="costs",
            description="Direct costs including teacher salaries, facilities, technology"
        ),
        FinancialAssumption(
            key="opex_pct", label="OpEx (% of Revenue)",
            value=20, min_val=10, max_val=35, step=1,
            unit="%", category="costs",
            description="G&A, marketing, central management overhead"
        ),
        FinancialAssumption(
            key="capex_per_school", label="CapEx per New School ($)",
            value=round(5_000_000 * ppp_factor / 100_000) * 100_000,
            min_val=1_000_000, max_val=20_000_000, step=500_000,
            unit="$", category="costs",
        ),

        # --- Alpha Fee Structure ---
        FinancialAssumption(
            key="management_fee_pct", label="Management Fee (% of School Revenue)",
            value=10, min_val=5, max_val=20, step=1,
            unit="%", category="fees",
            description="Alpha's management fee from the JV",
            locked=True
        ),
        FinancialAssumption(
            key="timeback_license_pct", label="Timeback License (% of Per-Student Budget)",
            value=20, min_val=10, max_val=30, step=1,
            unit="%", category="fees",
            description="Alpha's technology/IP licensing fee",
            locked=True
        ),

        # --- Upfront Payment Breakdown ---
        # Alpha Holdings receipts (upfront)
        FinancialAssumption(
            key="upfront_alphacore_license", label="AlphaCore License ($M)",
            value=250, min_val=50, max_val=500, step=10,
            unit="$M", category="fees",
            description="AlphaCore curriculum OS & LMS license — paid to Alpha Holdings",
        ),
        FinancialAssumption(
            key="upfront_mgmt_fee", label="Upfront Management Fee ($M)",
            # Target Students Y5 × Per-Student Budget × 10%
            value=max(1, round(target_students_y5 * base_per_student * 0.10 / 1_000_000)),
            min_val=1, max_val=500, step=5,
            unit="$M", category="fees",
            description="Target Students Y5 × Per-Student Budget × 10% — paid to Alpha Holdings",
        ),
        FinancialAssumption(
            key="upfront_timeback_fee", label="Upfront Timeback Fee ($M)",
            # Target Students Y5 × Per-Student Budget × 20%
            value=max(1, round(target_students_y5 * base_per_student * 0.20 / 1_000_000)),
            min_val=1, max_val=1000, step=5,
            unit="$M", category="fees",
            description="Target Students Y5 × Per-Student Budget × 20% — paid to Alpha Holdings",
        ),
        # Local expenses (counterparty cost, shown for deal sizing)
        FinancialAssumption(
            key="upfront_app_content_rd", label="Customized Country-Specific App Content R&D ($M)",
            value=250, min_val=50, max_val=500, step=10,
            unit="$M", category="fees",
            description="Local expense — country-specific EdTech app content R&D (owned by local entity)",
        ),
        FinancialAssumption(
            key="upfront_lifeskills_rd", label="Customized Country-Specific LifeSkills R&D ($M)",
            value=250, min_val=50, max_val=500, step=10,
            unit="$M", category="fees",
            description="Local expense — country-specific life skills curriculum R&D (owned by local entity)",
        ),
        FinancialAssumption(
            key="upfront_ip_fee", label="Total Upfront Ask ($M)",
            value=max(25, 250 + 250 + 250
                  + round(target_students_y5 * base_per_student * 0.10 / 1_000_000)
                  + round(target_students_y5 * base_per_student * 0.20 / 1_000_000)),
            min_val=25, max_val=2000, step=5,
            unit="$M", category="fees",
            description="AlphaCore License + App Content R&D + LifeSkills R&D + Mgmt Fee + Timeback (includes local expenses)",
        ),
        FinancialAssumption(
            key="guide_school_fee", label="Guide School Training Fee (per teacher, $)",
            value=round(15_000 * ppp_factor / 1_000) * 1_000,
            min_val=5_000, max_val=30_000, step=1_000,
            unit="$", category="fees",
        ),

        # --- Returns ---
        FinancialAssumption(
            key="exit_ebitda_multiple", label="Exit EBITDA Multiple",
            value=15, min_val=8, max_val=25, step=1,
            unit="x", category="returns",
        ),
        FinancialAssumption(
            key="discount_rate", label="Discount Rate (%)",
            value=12, min_val=8, max_val=20, step=1,
            unit="%", category="returns",
        ),
        FinancialAssumption(
            key="tax_rate", label="Tax Rate (%)",
            value=20, min_val=0, max_val=35, step=1,
            unit="%", category="returns",
        ),
    ]

    return FinancialAssumptions(assumptions=assumptions)


def _generate_cohort_assumptions(
    target: str,
    country_profile: CountryProfile,
    strategy: Strategy,
    ppp_factor: float,
    base_per_student: float,
) -> FinancialAssumptions:
    """Generate simplified cohort-based assumptions for Tier 2/3 countries.

    Each cohort = 25,000 students. The model asks: how many cohorts can
    the government (or private sector) realistically support?
    """
    cohort_size = 25_000
    per_student = max(5_000, base_per_student)
    # Default: 2 cohorts for Tier 2, 1 cohort for Tier 3
    tier = country_profile.target.tier
    default_cohorts = 2 if tier == 2 else 1
    total_students = default_cohorts * cohort_size

    # Fixed development cost per line item ($M): Tier 2 = $150M each, Tier 3 = $100M each
    # (AlphaCore License, App Content R&D, LifeSkills R&D — 3 items)
    tier_item_cost = 150 if tier == 2 else 100
    tier_dev_cost = tier_item_cost * 3  # total fixed: T2=$450M, T3=$300M

    assumptions = [
        FinancialAssumption(
            key="num_cohorts", label="Number of 25K-Student Cohorts",
            value=default_cohorts, min_val=1, max_val=8, step=1,
            unit="cohorts", category="scale",
            description="Each cohort = 25,000 students. UAE = 8 cohorts.",
        ),
        FinancialAssumption(
            key="cohort_size", label="Students per Cohort",
            value=cohort_size, min_val=10_000, max_val=50_000, step=5_000,
            unit="students", category="scale",
            description="Fixed cohort size (default: 25,000)",
            locked=True,
        ),
        FinancialAssumption(
            key="per_student_budget", label="Per-Student Budget (PPP-adjusted)",
            value=per_student, min_val=5_000, max_val=30_000, step=500,
            unit="$", category="pricing",
            description=f"max($5K, min($30K, tuition×0.8)) — PPP factor: {ppp_factor:.2f}",
        ),
        FinancialAssumption(
            key="cohort_ramp_years", label="Years to Full Cohort Deployment",
            value=3, min_val=1, max_val=5, step=1,
            unit="years", category="scale",
            description="Phased rollout timeline",
        ),
        # Alpha fees (locked)
        FinancialAssumption(
            key="management_fee_pct", label="Management Fee (% of Revenue)",
            value=10, min_val=5, max_val=20, step=1,
            unit="%", category="fees",
            locked=True,
        ),
        FinancialAssumption(
            key="timeback_license_pct", label="Timeback License (% of Per-Student Budget)",
            value=20, min_val=10, max_val=30, step=1,
            unit="%", category="fees",
            locked=True,
        ),
        # --- Upfront Payment Breakdown ---
        # Alpha Holdings receipts (upfront)
        FinancialAssumption(
            key="upfront_alphacore_license", label="AlphaCore License ($M)",
            value=tier_item_cost, min_val=10, max_val=500, step=5,
            unit="$M", category="fees",
            description="AlphaCore curriculum OS & LMS license — paid to Alpha Holdings",
        ),
        FinancialAssumption(
            key="upfront_mgmt_fee", label="Upfront Management Fee ($M)",
            value=max(1, round(total_students * per_student * 0.10 / 1_000_000)),
            min_val=1, max_val=500, step=5,
            unit="$M", category="fees",
            description="Target Students Y5 × Per-Student Budget × 10% — paid to Alpha Holdings",
        ),
        FinancialAssumption(
            key="upfront_timeback_fee", label="Upfront Timeback Fee ($M)",
            value=max(1, round(total_students * per_student * 0.20 / 1_000_000)),
            min_val=1, max_val=1000, step=5,
            unit="$M", category="fees",
            description="Target Students Y5 × Per-Student Budget × 20% — paid to Alpha Holdings",
        ),
        # Local expenses (counterparty cost, shown for deal sizing)
        FinancialAssumption(
            key="upfront_app_content_rd", label="Customized Country-Specific App Content R&D ($M)",
            value=tier_item_cost, min_val=10, max_val=500, step=5,
            unit="$M", category="fees",
            description="Local expense — country-specific EdTech app content R&D (owned by local entity)",
        ),
        FinancialAssumption(
            key="upfront_lifeskills_rd", label="Customized Country-Specific LifeSkills R&D ($M)",
            value=tier_item_cost, min_val=10, max_val=500, step=5,
            unit="$M", category="fees",
            description="Local expense — country-specific life skills curriculum R&D (owned by local entity)",
        ),
        FinancialAssumption(
            key="upfront_ip_fee", label="Total Upfront Ask ($M)",
            value=max(25, tier_dev_cost
                  + round(total_students * per_student * 0.10 / 1_000_000)
                  + round(total_students * per_student * 0.20 / 1_000_000)),
            min_val=25, max_val=2000, step=5,
            unit="$M", category="fees",
            description="AlphaCore License + App Content R&D + LifeSkills R&D + Mgmt Fee + Timeback (includes local expenses)",
        ),
        # Costs
        FinancialAssumption(
            key="cogs_pct", label="COGS (% of Revenue)",
            value=55, min_val=40, max_val=75, step=1,
            unit="%", category="costs",
        ),
        FinancialAssumption(
            key="opex_pct", label="OpEx (% of Revenue)",
            value=22, min_val=10, max_val=35, step=1,
            unit="%", category="costs",
        ),
        FinancialAssumption(
            key="avg_students_per_school", label="Avg Students per School",
            value=800, min_val=200, max_val=2000, step=50,
            unit="students", category="scale",
        ),
        FinancialAssumption(
            key="capex_per_school", label="CapEx per New School ($)",
            value=round(4_000_000 * ppp_factor / 100_000) * 100_000,
            min_val=500_000, max_val=15_000_000, step=500_000,
            unit="$", category="costs",
        ),
        # Returns
        FinancialAssumption(
            key="exit_ebitda_multiple", label="Exit EBITDA Multiple",
            value=12, min_val=6, max_val=20, step=1,
            unit="x", category="returns",
        ),
        FinancialAssumption(
            key="discount_rate", label="Discount Rate (%)",
            value=14, min_val=8, max_val=25, step=1,
            unit="%", category="returns",
        ),
        FinancialAssumption(
            key="tax_rate", label="Tax Rate (%)",
            value=20, min_val=0, max_val=35, step=1,
            unit="%", category="returns",
        ),
    ]

    return FinancialAssumptions(assumptions=assumptions)


# ---------------------------------------------------------------------------
# Phase 2 / Recalculate: Build model from assumptions
# ---------------------------------------------------------------------------

def build_model(
    assumptions: FinancialAssumptions,
    target: str,
    strategy: Strategy,
) -> FinancialModel:
    """Deterministic financial model calculation from assumptions."""
    a = {item.key: item.value for item in assumptions.assumptions}

    # Detect cohort-based model (Tier 2/3)
    if "num_cohorts" in a:
        return _build_cohort_model(a)

    premium_tuition = a.get("premium_tuition", 25_000)
    mid_tuition = a.get("mid_tuition", 15_000)
    per_student_budget = a.get("per_student_budget", 20_000)
    cogs_pct = a.get("cogs_pct", 55) / 100
    opex_pct = a.get("opex_pct", 20) / 100
    mgmt_fee_pct = a.get("management_fee_pct", 10) / 100
    timeback_pct = a.get("timeback_license_pct", 20) / 100
    upfront_ip = a.get("upfront_ip_fee", 25) * 1_000_000
    capex_per_school = a.get("capex_per_school", 5_000_000)
    avg_per_school = a.get("avg_students_per_school", 800)
    exit_multiple = a.get("exit_ebitda_multiple", 15)
    discount_rate = a.get("discount_rate", 12) / 100
    tax_rate = a.get("tax_rate", 20) / 100
    guide_fee = a.get("guide_school_fee", 15_000)

    # Student counts by year
    student_counts = [
        int(a.get("students_year1", 3000)),
        int(a.get("students_year2", 10000)),
        int(a.get("students_year3", 40000)),
        int(a.get("students_year4", 80000)),
        int(a.get("students_year5", 150000)),
    ]

    # Blended tuition (60% mid, 40% premium)
    blended_tuition = mid_tuition * 0.6 + premium_tuition * 0.4

    # --- P&L Projections ---
    projections: list[YearProjection] = []
    cumulative_cash = 0.0
    prev_schools = 0
    total_mgmt_rev = 0.0
    total_timeback_rev = 0.0

    for yr_idx in range(5):
        year = yr_idx + 1
        students = student_counts[yr_idx]
        schools = max(1, math.ceil(students / avg_per_school))
        new_schools = max(0, schools - prev_schools)

        revenue = students * blended_tuition
        cogs = revenue * cogs_pct
        gross_margin = revenue - cogs
        opex = revenue * opex_pct
        ebitda = gross_margin - opex
        net_income = ebitda * (1 - tax_rate)

        # CapEx for new schools
        capex = new_schools * capex_per_school
        fcf = net_income - capex
        cumulative_cash += fcf

        # Alpha's revenue from this year
        mgmt_rev = revenue * mgmt_fee_pct
        timeback_rev = students * per_student_budget * timeback_pct
        total_mgmt_rev += mgmt_rev
        total_timeback_rev += timeback_rev

        projections.append(YearProjection(
            year=year, students=students, schools=schools,
            revenue=round(revenue), cogs=round(cogs),
            gross_margin=round(gross_margin), opex=round(opex),
            ebitda=round(ebitda), net_income=round(net_income),
            free_cash_flow=round(fcf), cumulative_cash=round(cumulative_cash),
        ))
        prev_schools = schools

    # --- Unit Economics ---
    unit_econ = [
        UnitEconomics(
            school_type="Premium",
            per_student_revenue=premium_tuition,
            per_student_cost=round(premium_tuition * cogs_pct),
            contribution_margin=round(premium_tuition * (1 - cogs_pct)),
            margin_pct=round((1 - cogs_pct) * 100, 1),
        ),
        UnitEconomics(
            school_type="Mid-Market",
            per_student_revenue=mid_tuition,
            per_student_cost=round(mid_tuition * cogs_pct),
            contribution_margin=round(mid_tuition * (1 - cogs_pct)),
            margin_pct=round((1 - cogs_pct) * 100, 1),
        ),
    ]

    # --- Capital Deployment ---
    cap_deploy: list[CapitalDeployment] = []
    for yr_idx in range(5):
        year = yr_idx + 1
        students = student_counts[yr_idx]
        schools = max(1, math.ceil(students / avg_per_school))
        new_schools_yr = max(0, schools - (0 if yr_idx == 0 else max(1, math.ceil(student_counts[yr_idx - 1] / avg_per_school))))

        ip_dev = upfront_ip if year == 1 else 0
        mgmt = projections[yr_idx].revenue * mgmt_fee_pct
        launch = new_schools_yr * capex_per_school
        teachers_needed = max(0, students // 20)  # 20:1 ratio
        guide_total = teachers_needed * guide_fee if year <= 2 else (teachers_needed * guide_fee * 0.3)

        cap_deploy.append(CapitalDeployment(
            year=year, ip_development=round(ip_dev),
            management_fees=round(mgmt), launch_capital=round(launch),
            real_estate=round(launch * 0.6),
            total=round(ip_dev + mgmt + launch + guide_total),
        ))

    # --- Returns Analysis ---
    y5_ebitda = projections[4].ebitda if projections else 0
    ev_exit = y5_ebitda * exit_multiple
    total_invested = sum(cd.total for cd in cap_deploy)
    moic = ev_exit / total_invested if total_invested > 0 else 0

    # Simple IRR approximation
    cash_flows = [-cap_deploy[i].total for i in range(5)]
    cash_flows[4] += ev_exit
    irr = _approx_irr(cash_flows)

    payback = None
    for p in projections:
        if p.cumulative_cash > 0:
            payback = float(p.year)
            break

    returns = ReturnsAnalysis(
        irr=round(irr * 100, 1) if irr else None,
        moic=round(moic, 2),
        enterprise_value_at_exit=round(ev_exit),
        payback_period_years=payback,
        ebitda_multiple=exit_multiple,
    )

    # --- Sensitivity ---
    sensitivity = [
        SensitivityScenario(
            variable="Year 5 Students",
            base_case=student_counts[4],
            downside=student_counts[4] * 0.7,
            upside=student_counts[4] * 1.3,
        ),
        SensitivityScenario(
            variable="Blended Tuition",
            base_case=blended_tuition,
            downside=blended_tuition * 0.85,
            upside=blended_tuition * 1.15,
        ),
        SensitivityScenario(
            variable="COGS %",
            base_case=cogs_pct * 100,
            downside=(cogs_pct + 0.05) * 100,
            upside=(cogs_pct - 0.05) * 100,
        ),
        SensitivityScenario(
            variable="Exit Multiple",
            base_case=exit_multiple,
            downside=exit_multiple * 0.7,
            upside=exit_multiple * 1.3,
        ),
    ]

    return FinancialModel(
        pnl_projection=projections,
        unit_economics=unit_econ,
        capital_deployment=cap_deploy,
        returns_analysis=returns,
        sensitivity=sensitivity,
        ppp_factor=round(per_student_budget / 25_000, 2),
        demand_factor=1.0,
        management_fee_pct=mgmt_fee_pct,
        timeback_license_pct=timeback_pct,
        upfront_ip_fee=upfront_ip,
        upfront_alphacore_license=a.get("upfront_alphacore_license", 250) * 1_000_000,
        upfront_app_content_rd=a.get("upfront_app_content_rd", 250) * 1_000_000,
        upfront_lifeskills_rd=a.get("upfront_lifeskills_rd", 250) * 1_000_000,
        upfront_mgmt_fee=a.get("upfront_mgmt_fee", 0) * 1_000_000,
        upfront_timeback_fee=a.get("upfront_timeback_fee", 0) * 1_000_000,
        total_management_fee_revenue=round(total_mgmt_rev),
        total_timeback_license_revenue=round(total_timeback_rev),
    )


def _build_cohort_model(a: dict) -> FinancialModel:
    """Build a simplified cohort-based model for Tier 2/3 countries."""
    num_cohorts = int(a.get("num_cohorts", 1))
    cohort_size = int(a.get("cohort_size", 25_000))
    per_student = a.get("per_student_budget", 20_000)
    ramp_years = int(a.get("cohort_ramp_years", 3))
    cogs_pct = a.get("cogs_pct", 55) / 100
    opex_pct = a.get("opex_pct", 22) / 100
    mgmt_fee_pct = a.get("management_fee_pct", 10) / 100
    timeback_pct = a.get("timeback_license_pct", 20) / 100
    upfront_ip = a.get("upfront_ip_fee", 10) * 1_000_000
    avg_per_school = a.get("avg_students_per_school", 800)
    capex_per_school = a.get("capex_per_school", 4_000_000)
    exit_multiple = a.get("exit_ebitda_multiple", 12)
    tax_rate = a.get("tax_rate", 20) / 100

    total_students = num_cohorts * cohort_size

    # Ramp: linear from 1 cohort's worth to full deployment over ramp_years
    projections: list[YearProjection] = []
    cumulative_cash = 0.0
    prev_schools = 0
    total_mgmt = 0.0
    total_timeback = 0.0

    for yr in range(1, 6):
        if yr <= ramp_years:
            frac = yr / ramp_years
            students = min(total_students, max(cohort_size, int(total_students * frac)))
        else:
            students = total_students

        schools = max(1, math.ceil(students / avg_per_school))
        new_schools = max(0, schools - prev_schools)

        revenue = students * per_student
        cogs = revenue * cogs_pct
        gm = revenue - cogs
        opex = revenue * opex_pct
        ebitda = gm - opex
        net_income = ebitda * (1 - tax_rate)
        capex = new_schools * capex_per_school + (upfront_ip if yr == 1 else 0)
        fcf = net_income - capex
        cumulative_cash += fcf

        mgmt_rev = revenue * mgmt_fee_pct
        tb_rev = students * per_student * timeback_pct
        total_mgmt += mgmt_rev
        total_timeback += tb_rev

        projections.append(YearProjection(
            year=yr, students=students, schools=schools,
            revenue=round(revenue), cogs=round(cogs),
            gross_margin=round(gm), opex=round(opex),
            ebitda=round(ebitda), net_income=round(net_income),
            free_cash_flow=round(fcf), cumulative_cash=round(cumulative_cash),
        ))
        prev_schools = schools

    # Unit economics (single tier for cohort model)
    unit_econ = [
        UnitEconomics(
            school_type="Cohort (25K students)",
            per_student_revenue=per_student,
            per_student_cost=round(per_student * cogs_pct),
            contribution_margin=round(per_student * (1 - cogs_pct)),
            margin_pct=round((1 - cogs_pct) * 100, 1),
        ),
    ]

    # Capital deployment
    cap_deploy: list[CapitalDeployment] = []
    for yr in range(5):
        p = projections[yr]
        ns = max(0, p.schools - (projections[yr - 1].schools if yr > 0 else 0))
        ip = upfront_ip if yr == 0 else 0
        launch = ns * capex_per_school
        cap_deploy.append(CapitalDeployment(
            year=yr + 1, ip_development=round(ip),
            management_fees=round(p.revenue * mgmt_fee_pct),
            launch_capital=round(launch),
            real_estate=round(launch * 0.6),
            total=round(ip + launch + p.revenue * mgmt_fee_pct),
        ))

    # Returns
    y5_ebitda = projections[4].ebitda
    ev = y5_ebitda * exit_multiple
    total_invested = sum(cd.total for cd in cap_deploy)
    moic = ev / total_invested if total_invested > 0 else 0

    cfs = [-cd.total for cd in cap_deploy]
    cfs[4] += ev
    irr = _approx_irr(cfs)

    payback = None
    for p in projections:
        if p.cumulative_cash > 0:
            payback = float(p.year)
            break

    returns = ReturnsAnalysis(
        irr=round(irr * 100, 1) if irr else None,
        moic=round(moic, 2),
        enterprise_value_at_exit=round(ev),
        payback_period_years=payback,
        ebitda_multiple=exit_multiple,
    )

    sensitivity = [
        SensitivityScenario(
            variable="Number of Cohorts",
            base_case=num_cohorts,
            downside=max(1, num_cohorts - 1),
            upside=num_cohorts + 2,
        ),
        SensitivityScenario(
            variable="Per-Student Budget",
            base_case=per_student,
            downside=per_student * 0.85,
            upside=per_student * 1.15,
        ),
    ]

    return FinancialModel(
        pnl_projection=projections,
        unit_economics=unit_econ,
        capital_deployment=cap_deploy,
        returns_analysis=returns,
        sensitivity=sensitivity,
        ppp_factor=round(per_student / 25_000, 2),
        demand_factor=1.0,
        management_fee_pct=mgmt_fee_pct,
        timeback_license_pct=timeback_pct,
        upfront_ip_fee=upfront_ip,
        upfront_alphacore_license=a.get("upfront_alphacore_license", 100) * 1_000_000,
        upfront_app_content_rd=a.get("upfront_app_content_rd", 100) * 1_000_000,
        upfront_lifeskills_rd=a.get("upfront_lifeskills_rd", 100) * 1_000_000,
        upfront_mgmt_fee=a.get("upfront_mgmt_fee", 0) * 1_000_000,
        upfront_timeback_fee=a.get("upfront_timeback_fee", 0) * 1_000_000,
        total_management_fee_revenue=round(total_mgmt),
        total_timeback_license_revenue=round(total_timeback),
    )


def recalculate_model(
    current_assumptions: FinancialAssumptions,
    adjustments: dict[str, float],
    target: str,
    strategy: Strategy,
) -> tuple[FinancialAssumptions, FinancialModel]:
    """Apply user adjustments and recalculate the model."""
    for item in current_assumptions.assumptions:
        if item.key in adjustments:
            new_val = adjustments[item.key]
            if item.locked:
                logger.warning("Attempted to change locked assumption %s", item.key)
                continue
            item.value = max(item.min_val, min(item.max_val, new_val))
    model = build_model(current_assumptions, target, strategy)
    return current_assumptions, model


# ---------------------------------------------------------------------------
# Excel export — professionally formatted multi-sheet workbook
# Writes actual computed values (no formula-only cells) for full compatibility
# ---------------------------------------------------------------------------

def export_model_xlsx(
    target: str,
    model: FinancialModel,
    assumptions: FinancialAssumptions,
    country_profile: CountryProfile | None = None,
) -> str:
    """Export the financial model to a professionally formatted Excel workbook.

    Writes actual computed values (not formula-only) so the workbook displays
    correctly in any spreadsheet application. Produces a multi-sheet workbook
    with IB-standard formatting.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_financial_model.xlsx")

    wb = Workbook()

    # --- Styles ---
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="002060", end_color="002060", fill_type="solid")
    subheader_font = Font(bold=True, size=10)
    subheader_fill = PatternFill(start_color="D6E4F0", end_color="D6E4F0", fill_type="solid")
    label_font = Font(bold=True)
    label_fill = PatternFill(start_color="F0F0F0", end_color="F0F0F0", fill_type="solid")
    input_font = Font(bold=True, color="0000FF")
    input_fill = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid")
    total_font = Font(bold=True)
    total_fill = PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid")
    ebitda_font = Font(bold=True, size=11)
    ebitda_fill = PatternFill(start_color="D9E2F3", end_color="D9E2F3", fill_type="solid")
    thin_border = Border(bottom=Side(style="thin", color="000000"))

    def header_row(ws, row, values):
        for c, v in enumerate(values, 1):
            cell = ws.cell(row, c, v)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")

    def label_row(ws, row, col, value, bold=True):
        cell = ws.cell(row, col, value)
        if bold:
            cell.font = label_font
            cell.fill = label_fill

    a_dict = {item.key: item.value for item in assumptions.assumptions}

    # ================================================================
    # Sheet 1: Assumptions
    # ================================================================
    ws = wb.active
    ws.title = "Assumptions"
    ws.column_dimensions["A"].width = 42
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 10
    ws.column_dimensions["D"].width = 10

    ws.cell(1, 1, f"Financial Model — {target}").font = Font(bold=True, size=14, color="002060")
    ws.cell(2, 1, "Key Assumptions (Blue = adjustable input)").font = Font(italic=True, color="666666")
    header_row(ws, 4, ["Assumption", "Value", "Min", "Max"])

    row = 5
    current_cat = ""
    for a in assumptions.assumptions:
        if a.category != current_cat:
            current_cat = a.category
            row += 1
            cell = ws.cell(row, 1, current_cat.upper())
            cell.font = subheader_font
            cell.fill = subheader_fill
            for c2 in range(2, 5):
                ws.cell(row, c2).fill = subheader_fill
            row += 1

        ws.cell(row, 1, a.label).font = label_font
        ws.cell(row, 1).fill = label_fill

        # Write actual numeric values
        display_val = a.value / 100 if a.unit == "%" else a.value
        min_val = a.min_val / 100 if a.unit == "%" else a.min_val
        max_val = a.max_val / 100 if a.unit == "%" else a.max_val

        for c, val in [(2, display_val), (3, min_val), (4, max_val)]:
            cell = ws.cell(row, c, val)
            if a.unit == "%":
                cell.number_format = "0.0%"
            elif a.unit in ("$", "$M"):
                cell.number_format = "$#,##0" if a.unit == "$" else '$#,##0"M"'
            elif a.unit == "x":
                cell.number_format = "0.0x"
            else:
                cell.number_format = "#,##0"

        # IB color coding for inputs
        if not a.locked:
            ws.cell(row, 2).font = input_font
            ws.cell(row, 2).fill = input_fill
        row += 1

    # ================================================================
    # Sheet 2: P&L Projection (5-year)
    # ================================================================
    ws2 = wb.create_sheet("P&L Projection")
    ws2.column_dimensions["A"].width = 25
    for i in range(2, 7):
        ws2.column_dimensions[get_column_letter(i)].width = 18

    ws2.cell(1, 1, f"5-Year P&L Projection — {target}").font = Font(bold=True, size=14, color="002060")
    header_row(ws2, 3, ["Metric"] + [f"Year {p.year}" for p in model.pnl_projection])

    pnl_metrics = [
        ("Students", "students", "#,##0", False),
        ("Schools", "schools", "#,##0", False),
        ("", None, None, None),  # spacer
        ("Revenue", "revenue", "$#,##0", False),
        ("COGS", "cogs", "($#,##0)", False),
        ("Gross Margin", "gross_margin", "$#,##0", True),
        ("", None, None, None),  # spacer
        ("Operating Expenses", "opex", "($#,##0)", False),
        ("EBITDA", "ebitda", "$#,##0", "ebitda"),
        ("Net Income", "net_income", "$#,##0", False),
        ("", None, None, None),  # spacer
        ("Free Cash Flow", "free_cash_flow", "$#,##0", False),
        ("Cumulative Cash", "cumulative_cash", "$#,##0", False),
    ]

    r = 4
    for name, key, fmt, is_total in pnl_metrics:
        if key is None:
            r += 1
            continue
        label_row(ws2, r, 1, name)
        for c, proj in enumerate(model.pnl_projection, start=2):
            cell = ws2.cell(r, c, getattr(proj, key))
            cell.number_format = fmt
            cell.alignment = Alignment(horizontal="right")
            if is_total == "ebitda":
                cell.font = ebitda_font
                cell.fill = ebitda_fill
            elif is_total:
                cell.font = total_font
                cell.fill = total_fill
                cell.border = thin_border
        r += 1

    # Alpha Revenue Summary
    r += 1
    ws2.cell(r, 1, "ALPHA REVENUE SUMMARY").font = subheader_font
    ws2.cell(r, 1).fill = subheader_fill
    r += 1
    alpha_items = [
        ("Management Fee Revenue (5yr Total)", model.total_management_fee_revenue, "$#,##0"),
        ("Timeback License Revenue (5yr Total)", model.total_timeback_license_revenue, "$#,##0"),
        ("Upfront IP Fee", model.upfront_ip_fee, "$#,##0"),
        ("Total Alpha Revenue (5yr)", model.total_management_fee_revenue + model.total_timeback_license_revenue + model.upfront_ip_fee, "$#,##0"),
    ]
    for name, val, fmt in alpha_items:
        label_row(ws2, r, 1, name)
        cell = ws2.cell(r, 2, val)
        cell.number_format = fmt
        cell.alignment = Alignment(horizontal="right")
        if "Total" in name:
            cell.font = ebitda_font
            cell.fill = ebitda_fill
        r += 1

    # ================================================================
    # Sheet 3: Unit Economics
    # ================================================================
    ws3 = wb.create_sheet("Unit Economics")
    ws3.column_dimensions["A"].width = 30
    ws3.column_dimensions["B"].width = 20
    ws3.column_dimensions["C"].width = 20
    ws3.column_dimensions["D"].width = 20
    ws3.column_dimensions["E"].width = 15

    ws3.cell(1, 1, "Per-Student Unit Economics").font = Font(bold=True, size=14, color="002060")
    header_row(ws3, 3, ["School Type", "Revenue/Student", "Cost/Student", "Margin/Student", "Margin %"])

    for r, ue in enumerate(model.unit_economics, start=4):
        ws3.cell(r, 1, ue.school_type).font = label_font
        ws3.cell(r, 2, ue.per_student_revenue).number_format = "$#,##0"
        ws3.cell(r, 3, ue.per_student_cost).number_format = "$#,##0"
        cell4 = ws3.cell(r, 4, ue.contribution_margin)
        cell4.number_format = "$#,##0"
        cell4.font = total_font
        cell4.fill = ebitda_fill
        ws3.cell(r, 5, ue.margin_pct / 100).number_format = "0.0%"

    # ================================================================
    # Sheet 4: Capital Deployment
    # ================================================================
    if model.capital_deployment:
        ws_cap = wb.create_sheet("Capital Deployment")
        ws_cap.column_dimensions["A"].width = 30
        for i in range(2, 7):
            ws_cap.column_dimensions[get_column_letter(i)].width = 18

        ws_cap.cell(1, 1, "Capital Deployment Schedule").font = Font(bold=True, size=14, color="002060")
        header_row(ws_cap, 3, ["Item"] + [f"Year {cd.year}" for cd in model.capital_deployment])

        cap_items = [
            ("IP Development", "ip_development"),
            ("Management Fees", "management_fees"),
            ("Launch Capital", "launch_capital"),
            ("Real Estate", "real_estate"),
            ("Total Capital", "total"),
        ]
        r = 4
        for name, key in cap_items:
            label_row(ws_cap, r, 1, name)
            for c, cd in enumerate(model.capital_deployment, start=2):
                cell = ws_cap.cell(r, c, getattr(cd, key))
                cell.number_format = "$#,##0"
                cell.alignment = Alignment(horizontal="right")
                if key == "total":
                    cell.font = total_font
                    cell.fill = total_fill
            r += 1

    # ================================================================
    # Sheet 5: Returns Analysis
    # ================================================================
    ws4 = wb.create_sheet("Returns Analysis")
    ws4.column_dimensions["A"].width = 42
    ws4.column_dimensions["B"].width = 25

    ws4.cell(1, 1, "Returns & Valuation Analysis").font = Font(bold=True, size=14, color="002060")

    ret = model.returns_analysis
    returns_items = [
        ("KEY METRICS", None, None, True),
        ("IRR (Internal Rate of Return)", ret.irr / 100 if ret.irr else None, "0.0%", False),
        ("MOIC (Multiple on Invested Capital)", ret.moic, "0.0x", False),
        ("Enterprise Value at Exit", ret.enterprise_value_at_exit, "$#,##0", False),
        ("Payback Period", ret.payback_period_years, '0.0" years"', False),
        ("Exit EBITDA Multiple", ret.ebitda_multiple, "0.0x", False),
        ("", None, None, None),
        ("ALPHA FEE SUMMARY", None, None, True),
        ("Management Fee (% of School Revenue)", model.management_fee_pct * 100, "0.0%", False),
        ("Timeback License (% of Per-Student Budget)", model.timeback_license_pct * 100, "0.0%", False),
        ("Upfront IP/Development Fee", model.upfront_ip_fee, "$#,##0", False),
        ("Total Management Fee Revenue (5yr)", model.total_management_fee_revenue, "$#,##0", False),
        ("Total Timeback License Revenue (5yr)", model.total_timeback_license_revenue, "$#,##0", False),
    ]

    r = 3
    for name, val, fmt, is_header in returns_items:
        if is_header is None:
            r += 1
            continue
        if is_header:
            ws4.cell(r, 1, name).font = subheader_font
            ws4.cell(r, 1).fill = subheader_fill
            ws4.cell(r, 2).fill = subheader_fill
        else:
            label_row(ws4, r, 1, name)
            if val is not None:
                cell = ws4.cell(r, 2, val)
                cell.number_format = fmt
                cell.font = Font(bold=True, size=12)
                cell.fill = ebitda_fill
            else:
                ws4.cell(r, 2, "N/A")
        r += 1

    # ================================================================
    # Sheet 6: Sensitivity Analysis
    # ================================================================
    ws5 = wb.create_sheet("Sensitivity Analysis")
    ws5.column_dimensions["A"].width = 25
    for col_letter in "BCDE":
        ws5.column_dimensions[col_letter].width = 18

    ws5.cell(1, 1, "Sensitivity Analysis").font = Font(bold=True, size=14, color="002060")
    header_row(ws5, 3, ["Variable", "Base Case", "Downside", "Upside"])

    for r, s in enumerate(model.sensitivity, start=4):
        ws5.cell(r, 1, s.variable).font = label_font
        ws5.cell(r, 2, s.base_case).number_format = "#,##0"
        ws5.cell(r, 3, s.downside).number_format = "#,##0"
        ws5.cell(r, 4, s.upside).number_format = "#,##0"

    # ================================================================
    # Save
    # ================================================================
    wb.save(path)
    wb.close()
    logger.info("Exported financial model XLSX: %s (6 sheets, all computed values)", path)
    return path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _approx_irr(cash_flows: list[float], guess: float = 0.15) -> float | None:
    """Newton-Raphson IRR approximation."""
    rate = guess
    for _ in range(200):
        npv = sum(cf / (1 + rate) ** t for t, cf in enumerate(cash_flows))
        d_npv = sum(-t * cf / (1 + rate) ** (t + 1) for t, cf in enumerate(cash_flows))
        if abs(d_npv) < 1e-12:
            break
        new_rate = rate - npv / d_npv
        if abs(new_rate - rate) < 1e-8:
            return new_rate
        rate = new_rate
    return rate if -1 < rate < 10 else None
