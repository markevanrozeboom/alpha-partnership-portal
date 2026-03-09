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
    ppp_factor = max(0.3, min(2.0, gdp_cap / 50_000))

    # Base per-student budget from UAE deal scaled by PPP
    base_per_student = max(15_000, round(25_000 * ppp_factor / 500) * 500)

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

    # Target students from strategy or default
    target_students_y5 = strategy.target_student_count_year5 or round(200_000 * ppp_factor / 10_000) * 10_000
    target_students_y5 = max(10_000, target_students_y5)

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
            value=base_per_student, min_val=10_000, max_val=40_000, step=500,
            unit="$", category="pricing",
            description="Total operating cost per student per year"
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
        FinancialAssumption(
            key="upfront_ip_fee", label="Upfront IP/Development Fee ($M)",
            value=max(10, round(25 * ppp_factor)),
            min_val=5, max_val=100, step=1,
            unit="$M", category="fees",
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
    per_student = max(15_000, base_per_student)
    # Default: 2 cohorts for Tier 2, 1 cohort for Tier 3
    tier = country_profile.target.tier
    default_cohorts = 2 if tier == 2 else 1

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
            value=per_student, min_val=10_000, max_val=40_000, step=500,
            unit="$", category="pricing",
            description=f"PPP-adjusted from $25K (factor: {ppp_factor:.2f})",
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
        FinancialAssumption(
            key="upfront_ip_fee", label="Upfront IP Fee ($M)",
            value=max(5, round(10 * ppp_factor)),
            min_val=2, max_val=50, step=1,
            unit="$M", category="fees",
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
    prev_s = 0
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
# Excel export — IB-quality 8-sheet workbook with real Excel formulas
# Uses build_model.py from EduPitch skills (openpyxl-based)
# ---------------------------------------------------------------------------

def export_model_xlsx(
    target: str,
    model: FinancialModel,
    assumptions: FinancialAssumptions,
    country_profile: CountryProfile | None = None,
) -> str:
    """Export the financial model to an IB-quality formatted Excel workbook.

    Produces an 8-sheet workbook with real Excel formulas, IB-standard color
    coding (blue font + yellow bg for inputs), named ranges, conditional
    formatting, and cross-sheet references.
    """
    import json as _json
    import sys as _sys

    # Import the IB-quality model builder and XLSX generator
    _skills_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "skills")
    if _skills_dir not in _sys.path:
        _sys.path.insert(0, _skills_dir)

    try:
        from build_model import build_model as ib_build_model, classify_tier, is_us_state
        from generate_xlsx import build_workbook
    except ImportError:
        logger.warning("IB model builder not available, falling back to basic export")
        return _export_model_xlsx_basic(target, model, assumptions)

    # Build research data dict from the financial model's assumptions
    a = {item.key: item.value for item in assumptions.assumptions}

    gdp_pc = a.get("per_student_budget", 20000) / 0.8 * 50000 / 25000  # rough reverse
    if country_profile and country_profile.economy:
        gdp_pc = country_profile.economy.gdp_per_capita or 30000
        school_age_pop = country_profile.demographics.population_0_18 or 5_000_000
        avg_tuition = a.get("mid_tuition", a.get("per_student_budget", 15000))
    else:
        school_age_pop = max(1_000_000, int(a.get("students_year5", 150000) * 100))
        avg_tuition = a.get("mid_tuition", a.get("per_student_budget", 15000))

    research_data = {
        "target": {
            "name": target,
            "type": "us_state" if "state" in target.lower() or (country_profile and country_profile.target.type.value == "us_state") else "sovereign_nation",
            "region": "Unknown",
        },
        "demographics": {
            "total_population": school_age_pop * 5,
            "school_age_population": school_age_pop,
        },
        "economy": {
            "gdp_per_capita": gdp_pc,
            "inflation_rate": 3.0,
            "fx_rate_to_usd": 1.0,
        },
        "education": {
            "avg_private_school_tuition": avg_tuition,
            "premium_private_tuition": a.get("premium_tuition", avg_tuition * 1.5),
            "govt_education_spend_per_student": avg_tuition * 0.5,
            "private_enrollment_pct": 0.15,
            "total_k12_students": int(school_age_pop * 0.85),
        },
        "costs": {
            "teacher_salary_usd": int(avg_tuition * 2),
            "construction_cost_per_sqm": 1500,
            "school_facility_sqm_per_student": 8,
        },
        "regulatory": {
            "foreign_ownership_cap_pct": 1.0,
            "for_profit_allowed": True,
            "ppp_framework_exists": True,
        },
        "overrides": {},
    }

    # Add US state data if applicable
    if research_data["target"]["type"] == "us_state":
        esa_data = get_esa_data(target)
        research_data["us_state"] = {
            "esa_amount": esa_data.get("esa_amount", 8000) if isinstance(esa_data.get("esa_amount"), (int, float)) else 8000,
            "students_on_vouchers": esa_data.get("students_on_vouchers", 50000),
            "avg_private_tuition": esa_data.get("avg_private_tuition", 13000),
            "charter_penetration_pct": 0.12,
            "homeschool_population": 50000,
            "total_public_students": 5_000_000,
        }

    # Determine templates
    if is_us_state(research_data):
        template_ids = ["us-state"]
    else:
        tier = classify_tier(research_data)
        if tier == 1:
            template_ids = ["jv-counterparty", "jv-alpha"]
        elif tier == 3:
            template_ids = ["lic-counterparty", "lic-alpha"]
        else:
            template_ids = ["jv-counterparty", "jv-alpha"]

    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)

    generated_files = []
    for tid in template_ids:
        try:
            spec = ib_build_model(research_data, tid)

            # Generate XLSX using openpyxl
            wb = build_workbook(spec)
            safe_name = target.replace(" ", "_").replace("/", "_")
            filename = f"{safe_name}_{tid.replace('-', '_')}_model.xlsx"
            filepath = os.path.join(output_dir, filename)
            wb.save(filepath)
            wb.close()
            generated_files.append(filepath)
            logger.info("Generated IB-quality XLSX: %s (%d sheets)", filepath, len(spec["sheets"]))
        except Exception as exc:
            logger.error("IB model generation failed for %s: %s", tid, exc)
            continue

    # Return the first (primary) file path, or fall back to basic
    if generated_files:
        return generated_files[0]
    else:
        logger.warning("All IB model templates failed, falling back to basic export")
        return _export_model_xlsx_basic(target, model, assumptions)


def _export_model_xlsx_basic(
    target: str,
    model: FinancialModel,
    assumptions: FinancialAssumptions,
) -> str:
    """Fallback basic XLSX export using openpyxl (no formulas)."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment

    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_financial_model.xlsx")

    wb = Workbook()

    # Styles
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="1A1A2E", end_color="1A1A2E", fill_type="solid")
    label_font = Font(bold=True)
    label_fill = PatternFill(start_color="F0F0F0", end_color="F0F0F0", fill_type="solid")

    # --- Assumptions Sheet ---
    ws = wb.active
    ws.title = "Assumptions"
    ws.column_dimensions["A"].width = 40
    ws.column_dimensions["B"].width = 15
    ws.column_dimensions["C"].width = 12
    ws.column_dimensions["D"].width = 12

    ws.cell(1, 1, f"Financial Model Assumptions — {target}").font = Font(bold=True, size=14, color="1A1A2E")
    row = 3
    current_cat = ""
    for a in assumptions.assumptions:
        if a.category != current_cat:
            current_cat = a.category
            for col, val in enumerate([current_cat.upper(), "Value", "Min", "Max"], 1):
                cell = ws.cell(row, col, val)
                cell.font = header_font
                cell.fill = header_fill
            row += 1
        ws.cell(row, 1, a.label).font = label_font
        ws.cell(row, 1).fill = label_fill
        display_val = a.value / 100 if a.unit == "%" else a.value
        ws.cell(row, 2, display_val)
        ws.cell(row, 3, a.min_val / 100 if a.unit == "%" else a.min_val)
        ws.cell(row, 4, a.max_val / 100 if a.unit == "%" else a.max_val)
        if a.unit == "%":
            for c in [2, 3, 4]:
                ws.cell(row, c).number_format = "0.0%"
        elif a.unit == "$":
            for c in [2, 3, 4]:
                ws.cell(row, c).number_format = "$#,##0"
        else:
            for c in [2, 3, 4]:
                ws.cell(row, c).number_format = "#,##0"
        row += 1

    # --- P&L Sheet ---
    ws2 = wb.create_sheet("P&L Projection")
    ws2.column_dimensions["A"].width = 25
    for col_letter in "BCDEF":
        ws2.column_dimensions[col_letter].width = 18
    ws2.cell(1, 1, f"5-Year P&L Projection — {target}").font = Font(bold=True, size=14, color="1A1A2E")
    headers = ["Metric", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"]
    for c, h in enumerate(headers, 1):
        cell = ws2.cell(3, c, h)
        cell.font = header_font
        cell.fill = header_fill
    metrics = [
        ("Students", "students", "#,##0"),
        ("Schools", "schools", "#,##0"),
        ("Revenue", "revenue", "$#,##0"),
        ("COGS", "cogs", "$#,##0"),
        ("Gross Margin", "gross_margin", "$#,##0"),
        ("OpEx", "opex", "$#,##0"),
        ("EBITDA", "ebitda", "$#,##0"),
        ("Net Income", "net_income", "$#,##0"),
        ("Free Cash Flow", "free_cash_flow", "$#,##0"),
        ("Cumulative Cash", "cumulative_cash", "$#,##0"),
    ]
    for r, (name, key, fmt) in enumerate(metrics, start=4):
        ws2.cell(r, 1, name).font = label_font
        ws2.cell(r, 1).fill = label_fill
        for c, proj in enumerate(model.pnl_projection, start=2):
            cell = ws2.cell(r, c, getattr(proj, key))
            cell.number_format = fmt

    # --- Unit Economics Sheet ---
    ws3 = wb.create_sheet("Unit Economics")
    ws3.cell(1, 1, "Unit Economics").font = Font(bold=True, size=14, color="1A1A2E")
    ue_headers = ["School Type", "Revenue/Student", "Cost/Student", "Margin/Student", "Margin %"]
    for c, h in enumerate(ue_headers, 1):
        cell = ws3.cell(3, c, h)
        cell.font = header_font
        cell.fill = header_fill
    for r, ue in enumerate(model.unit_economics, start=4):
        ws3.cell(r, 1, ue.school_type).font = label_font
        ws3.cell(r, 2, ue.per_student_revenue).number_format = "$#,##0"
        ws3.cell(r, 3, ue.per_student_cost).number_format = "$#,##0"
        ws3.cell(r, 4, ue.contribution_margin).number_format = "$#,##0"
        ws3.cell(r, 5, ue.margin_pct / 100).number_format = "0.0%"

    # --- Returns Sheet ---
    ws4 = wb.create_sheet("Returns Analysis")
    ws4.cell(1, 1, "Returns Analysis").font = Font(bold=True, size=14, color="1A1A2E")
    ret_data = [
        ("IRR", f"{model.returns_analysis.irr}%" if model.returns_analysis.irr else "N/A"),
        ("MOIC", f"{model.returns_analysis.moic}x"),
        ("Enterprise Value at Exit", f"${model.returns_analysis.enterprise_value_at_exit:,.0f}" if model.returns_analysis.enterprise_value_at_exit else "N/A"),
        ("Payback Period", f"{model.returns_analysis.payback_period_years} years" if model.returns_analysis.payback_period_years else "N/A"),
        ("Exit EBITDA Multiple", f"{model.returns_analysis.ebitda_multiple}x"),
        ("Total Management Fee Revenue (5yr)", f"${model.total_management_fee_revenue:,.0f}"),
        ("Total Timeback License Revenue (5yr)", f"${model.total_timeback_license_revenue:,.0f}"),
    ]
    for r, (label, val) in enumerate(ret_data, start=3):
        ws4.cell(r, 1, label).font = label_font
        ws4.cell(r, 2, val)

    wb.save(path)
    wb.close()
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
