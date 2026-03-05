"""Financial Modelling Agent — builds complete financial model.

Applies the Scaling Formula (Section 2D), PPP adjustment logic, and produces
structured data for XLSX generation including P&L, unit economics, capital
deployment, cash flow, and returns analysis.
"""

from __future__ import annotations

import logging
import math

from models.schemas import (
    FinancialModel,
    YearProjection,
    UnitEconomics,
    CapitalDeployment,
    ReturnsAnalysis,
    SensitivityScenario,
    CountryProfile,
    EducationAnalysis,
    Strategy,
    TierClassification,
    TargetType,
    Gate2Decision,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cost structure defaults (% of tuition)
# ---------------------------------------------------------------------------
COST_STRUCTURE = {
    "personnel_guides": 0.24,
    "timeback_license": 0.20,
    "real_estate_lease": 0.22,
    "curriculum_delivery": 0.10,
    "afternoon_programs": 0.13,
    "admin_marketing_ga": 0.12,
}

# Valuation defaults
DEFAULT_EBITDA_MULTIPLE = 15
DEFAULT_DISCOUNT_RATE = 0.12
DEFAULT_EXIT_YEAR = 10


async def run_financial_model(
    target: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    strategy: Strategy,
    gate2_decision: Gate2Decision | None = None,
) -> FinancialModel:
    """Build the complete financial model."""
    logger.info("Building financial model for %s", target)

    is_us_state = country_profile.target.type == TargetType.US_STATE
    tier = country_profile.target.tier

    # --- Resolve final assumptions (Gate 2 overrides > Strategy > Defaults) ---
    target_students_y5 = (
        (gate2_decision.confirmed_student_count if gate2_decision and gate2_decision.confirmed_student_count else None)
        or strategy.target_student_count_year5
        or 50_000
    )
    per_student_budget = (
        (gate2_decision.confirmed_pricing if gate2_decision and gate2_decision.confirmed_pricing else None)
        or strategy.per_student_budget
        or 15_000
    )

    # --- PPP Factor ---
    gdp_pc = country_profile.economy.gdp_per_capita or 15_000
    ppp_factor = min(1.0, gdp_pc / 30_000)

    # --- Demand Factor ---
    demand_factor = 1.0
    if tier == TierClassification.TIER_2:
        demand_factor = 0.5
    elif tier == TierClassification.TIER_3:
        demand_factor = 0.2

    # --- Build enrollment ramp ---
    enrollment_by_year = _build_enrollment_ramp(target_students_y5, years=10)

    # --- School count ---
    avg_school_size = 250 if not is_us_state else 100
    schools_by_year = [max(1, math.ceil(s / avg_school_size)) for s in enrollment_by_year]

    # --- Ancillary revenue per student ---
    ancillary_per_student = 500

    # --- Fee structure (non-negotiable) ---
    management_fee_pct = 0.10
    timeback_license_pct = 0.20
    upfront_ip_fee = strategy.upfront_ask or max(25_000_000, 0)

    # --- Build P&L projections ---
    pnl: list[YearProjection] = []
    cumulative_cash = 0.0
    payback_year: float | None = None

    for yr in range(1, 11):
        students = enrollment_by_year[yr - 1]
        schools = schools_by_year[yr - 1]

        # Revenue
        tuition_revenue = students * per_student_budget
        ancillary_revenue = students * ancillary_per_student
        total_revenue = tuition_revenue + ancillary_revenue

        # Fill rate adjustment (Year 1: 60%, Year 2: 75%, Year 3+: 90%)
        if yr == 1:
            fill_rate = 0.60
        elif yr == 2:
            fill_rate = 0.75
        else:
            fill_rate = 0.90
        total_revenue *= fill_rate

        # COGS (personnel + timeback + real estate + curriculum)
        cogs_pct = (
            COST_STRUCTURE["personnel_guides"]
            + COST_STRUCTURE["timeback_license"]
            + COST_STRUCTURE["real_estate_lease"]
            + COST_STRUCTURE["curriculum_delivery"]
        )
        cogs = total_revenue * cogs_pct
        gross_margin = total_revenue - cogs

        # OpEx (afternoon programs + admin/marketing/G&A)
        opex_pct = (
            COST_STRUCTURE["afternoon_programs"]
            + COST_STRUCTURE["admin_marketing_ga"]
        )
        opex = total_revenue * opex_pct

        ebitda = gross_margin - opex
        # Simplified tax
        tax_rate = 0.20
        net_income = ebitda * (1 - tax_rate)

        pnl.append(YearProjection(
            year=yr,
            students=students,
            schools=schools,
            revenue=round(total_revenue, 0),
            cogs=round(cogs, 0),
            gross_margin=round(gross_margin, 0),
            opex=round(opex, 0),
            ebitda=round(ebitda, 0),
            net_income=round(net_income, 0),
        ))

        # Track payback
        cumulative_cash += net_income
        if payback_year is None and cumulative_cash > upfront_ip_fee:
            payback_year = float(yr)

    # --- Unit Economics by school type ---
    unit_econ: list[UnitEconomics] = []
    for st in strategy.school_types:
        try:
            tuition_str = (st.tuition or "").replace("$", "").replace(",", "")
            # Handle range: take midpoint
            if "-" in tuition_str:
                parts = tuition_str.split("-")
                tuition_val = (float(parts[0].strip()) + float(parts[1].strip())) / 2
            else:
                tuition_val = float(tuition_str) if tuition_str else per_student_budget
        except (ValueError, IndexError):
            tuition_val = per_student_budget

        total_cost_pct = sum(COST_STRUCTURE.values())
        per_student_cost = tuition_val * total_cost_pct
        contribution = tuition_val - per_student_cost
        margin = (contribution / tuition_val * 100) if tuition_val > 0 else 0

        unit_econ.append(UnitEconomics(
            school_type=st.name,
            per_student_revenue=round(tuition_val, 0),
            per_student_cost=round(per_student_cost, 0),
            contribution_margin=round(contribution, 0),
            margin_pct=round(margin, 1),
        ))

    # --- Capital Deployment ---
    capital: list[CapitalDeployment] = []
    for yr in range(1, 11):
        students = enrollment_by_year[yr - 1]
        ip_dev = upfront_ip_fee * 0.4 if yr == 1 else (upfront_ip_fee * 0.3 if yr == 2 else upfront_ip_fee * 0.06)
        mgmt_fees = students * per_student_budget * management_fee_pct
        launch_cap = schools_by_year[yr - 1] * 500_000 if yr <= 5 else 0  # $500K per school launch
        re_cost = schools_by_year[yr - 1] * 2_000_000 if not is_us_state else schools_by_year[yr - 1] * 200_000

        capital.append(CapitalDeployment(
            year=yr,
            ip_development=round(ip_dev, 0),
            management_fees=round(mgmt_fees, 0),
            launch_capital=round(launch_cap, 0),
            real_estate=round(re_cost, 0),
            total=round(ip_dev + mgmt_fees + launch_cap + re_cost, 0),
        ))

    # --- Returns Analysis ---
    year5_ebitda = pnl[4].ebitda if len(pnl) >= 5 else 0
    year10_ebitda = pnl[9].ebitda if len(pnl) >= 10 else 0
    ev_at_exit = year10_ebitda * DEFAULT_EBITDA_MULTIPLE
    total_invested = sum(c.total for c in capital[:5])

    moic = ev_at_exit / total_invested if total_invested > 0 else 0

    # Simplified IRR calculation
    cash_flows = [-total_invested]
    for yr_proj in pnl:
        cash_flows.append(yr_proj.net_income)
    cash_flows[-1] += ev_at_exit  # Exit proceeds in year 10
    irr = _estimate_irr(cash_flows)

    # Total fee revenues
    total_mgmt_fee = sum(
        enrollment_by_year[i] * per_student_budget * management_fee_pct
        for i in range(5)
    )
    total_timeback_fee = sum(
        enrollment_by_year[i] * per_student_budget * timeback_license_pct
        for i in range(5)
    )

    returns = ReturnsAnalysis(
        irr=round(irr * 100, 1) if irr else None,
        moic=round(moic, 1),
        enterprise_value_at_exit=round(ev_at_exit, 0),
        payback_period_years=payback_year,
        ebitda_multiple=DEFAULT_EBITDA_MULTIPLE,
    )

    # --- Sensitivity Analysis ---
    sensitivity = [
        SensitivityScenario(
            variable="Tuition",
            base_case=round(per_student_budget, 0),
            downside=round(per_student_budget * 0.8, 0),
            upside=round(per_student_budget * 1.2, 0),
        ),
        SensitivityScenario(
            variable="Enrollment (Year 5)",
            base_case=float(target_students_y5),
            downside=float(int(target_students_y5 * 0.7)),
            upside=float(int(target_students_y5 * 1.3)),
        ),
        SensitivityScenario(
            variable="EBITDA Margin",
            base_case=round((1 - sum(COST_STRUCTURE.values())) * 100, 1),
            downside=round((1 - sum(COST_STRUCTURE.values()) - 0.05) * 100, 1),
            upside=round((1 - sum(COST_STRUCTURE.values()) + 0.05) * 100, 1),
        ),
        SensitivityScenario(
            variable="Exit Multiple",
            base_case=float(DEFAULT_EBITDA_MULTIPLE),
            downside=float(DEFAULT_EBITDA_MULTIPLE - 5),
            upside=float(DEFAULT_EBITDA_MULTIPLE + 5),
        ),
    ]

    model = FinancialModel(
        pnl_projection=pnl,
        unit_economics=unit_econ,
        capital_deployment=capital,
        returns_analysis=returns,
        sensitivity=sensitivity,
        ppp_factor=round(ppp_factor, 2),
        demand_factor=demand_factor,
        management_fee_pct=management_fee_pct,
        timeback_license_pct=timeback_license_pct,
        upfront_ip_fee=upfront_ip_fee,
        total_management_fee_revenue=round(total_mgmt_fee, 0),
        total_timeback_license_revenue=round(total_timeback_fee, 0),
    )

    logger.info("Financial model complete for %s", target)
    return model


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_enrollment_ramp(target_y5: int, years: int = 10) -> list[int]:
    """Build a realistic enrollment ramp from 0 to target at Year 5, continuing to grow."""
    ramp = []
    for yr in range(1, years + 1):
        if yr == 1:
            students = max(500, int(target_y5 * 0.05))
        elif yr == 2:
            students = max(2000, int(target_y5 * 0.15))
        elif yr == 3:
            students = int(target_y5 * 0.35)
        elif yr == 4:
            students = int(target_y5 * 0.65)
        elif yr == 5:
            students = target_y5
        elif yr <= 7:
            students = int(target_y5 * (1 + 0.15 * (yr - 5)))
        else:
            students = int(target_y5 * (1 + 0.15 * 2 + 0.08 * (yr - 7)))
        ramp.append(students)
    return ramp


def _estimate_irr(cash_flows: list[float], guess: float = 0.15, tol: float = 1e-6, max_iter: int = 100) -> float | None:
    """Estimate IRR using Newton-Raphson method."""
    rate = guess
    for _ in range(max_iter):
        npv = sum(cf / (1 + rate) ** t for t, cf in enumerate(cash_flows))
        dnpv = sum(-t * cf / (1 + rate) ** (t + 1) for t, cf in enumerate(cash_flows))
        if abs(dnpv) < 1e-12:
            return rate if abs(npv) < tol else None
        new_rate = rate - npv / dnpv
        if abs(new_rate - rate) < tol:
            return new_rate
        rate = new_rate
        # Clamp to reasonable range
        rate = max(-0.5, min(rate, 10.0))
    return rate if abs(sum(cf / (1 + rate) ** t for t, cf in enumerate(cash_flows))) < tol * 1000 else None
