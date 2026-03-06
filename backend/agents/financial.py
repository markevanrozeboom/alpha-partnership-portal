"""Financial Modelling Agent — investment-bank-quality financial model with interactive assumptions.

Phase 1: Generates configurable assumptions (sliders) from the strategy/country data.
Phase 2: Builds the full P&L, capital deployment, unit economics, returns analysis.
Recalculate: Deterministic recalculation when user adjusts sliders.
"""

from __future__ import annotations

import logging
import math
import os

import xlsxwriter

from models.schemas import (
    FinancialAssumption, FinancialAssumptions,
    FinancialModel, YearProjection, UnitEconomics, CapitalDeployment,
    ReturnsAnalysis, SensitivityScenario,
    Strategy, CountryProfile, EducationAnalysis,
)
from services.llm import call_llm_plain
from config import OUTPUT_DIR

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

    # Tuition ranges
    premium_tuition = max(15_000, round(base_per_student * 1.2 / 500) * 500)
    mid_tuition = max(12_000, round(base_per_student * 0.8 / 500) * 500)
    if country_profile.target.type.value == "us_state":
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
# Excel export
# ---------------------------------------------------------------------------

def export_model_xlsx(
    target: str,
    model: FinancialModel,
    assumptions: FinancialAssumptions,
) -> str:
    """Export the financial model to a formatted Excel workbook."""
    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_financial_model.xlsx")

    wb = xlsxwriter.Workbook(path)

    # Formats
    header_fmt = wb.add_format({
        "bold": True, "bg_color": "#1a1a2e", "font_color": "white",
        "border": 1, "font_size": 11, "align": "center",
    })
    money_fmt = wb.add_format({"num_format": "$#,##0", "border": 1})
    pct_fmt = wb.add_format({"num_format": "0.0%", "border": 1})
    num_fmt = wb.add_format({"num_format": "#,##0", "border": 1})
    label_fmt = wb.add_format({"bold": True, "border": 1, "bg_color": "#f0f0f0"})
    title_fmt = wb.add_format({
        "bold": True, "font_size": 14, "font_color": "#1a1a2e",
    })

    # --- Assumptions Sheet ---
    ws = wb.add_worksheet("Assumptions")
    ws.set_column("A:A", 40)
    ws.set_column("B:B", 15)
    ws.set_column("C:D", 12)
    ws.write(0, 0, f"Financial Model Assumptions — {target}", title_fmt)
    row = 2
    current_cat = ""
    for a in assumptions.assumptions:
        if a.category != current_cat:
            current_cat = a.category
            ws.write(row, 0, current_cat.upper(), header_fmt)
            ws.write(row, 1, "Value", header_fmt)
            ws.write(row, 2, "Min", header_fmt)
            ws.write(row, 3, "Max", header_fmt)
            row += 1
        ws.write(row, 0, a.label, label_fmt)
        fmt = money_fmt if a.unit == "$" else (pct_fmt if a.unit == "%" else num_fmt)
        ws.write(row, 1, a.value / 100 if a.unit == "%" else a.value, fmt)
        ws.write(row, 2, a.min_val / 100 if a.unit == "%" else a.min_val, fmt)
        ws.write(row, 3, a.max_val / 100 if a.unit == "%" else a.max_val, fmt)
        row += 1

    # --- P&L Sheet ---
    ws = wb.add_worksheet("P&L Projection")
    ws.set_column("A:A", 25)
    ws.set_column("B:F", 18)
    ws.write(0, 0, f"5-Year P&L Projection — {target}", title_fmt)
    headers = ["Metric", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"]
    for c, h in enumerate(headers):
        ws.write(2, c, h, header_fmt)
    metrics = [
        ("Students", "students", num_fmt),
        ("Schools", "schools", num_fmt),
        ("Revenue", "revenue", money_fmt),
        ("COGS", "cogs", money_fmt),
        ("Gross Margin", "gross_margin", money_fmt),
        ("OpEx", "opex", money_fmt),
        ("EBITDA", "ebitda", money_fmt),
        ("Net Income", "net_income", money_fmt),
        ("Free Cash Flow", "free_cash_flow", money_fmt),
        ("Cumulative Cash", "cumulative_cash", money_fmt),
    ]
    for r, (name, key, fmt) in enumerate(metrics, start=3):
        ws.write(r, 0, name, label_fmt)
        for c, proj in enumerate(model.pnl_projection, start=1):
            ws.write(r, c, getattr(proj, key), fmt)

    # --- Unit Economics Sheet ---
    ws = wb.add_worksheet("Unit Economics")
    ws.set_column("A:A", 20)
    ws.set_column("B:E", 18)
    ws.write(0, 0, "Unit Economics", title_fmt)
    ue_headers = ["School Type", "Revenue/Student", "Cost/Student", "Margin/Student", "Margin %"]
    for c, h in enumerate(ue_headers):
        ws.write(2, c, h, header_fmt)
    for r, ue in enumerate(model.unit_economics, start=3):
        ws.write(r, 0, ue.school_type, label_fmt)
        ws.write(r, 1, ue.per_student_revenue, money_fmt)
        ws.write(r, 2, ue.per_student_cost, money_fmt)
        ws.write(r, 3, ue.contribution_margin, money_fmt)
        ws.write(r, 4, ue.margin_pct / 100, pct_fmt)

    # --- Returns Sheet ---
    ws = wb.add_worksheet("Returns Analysis")
    ws.set_column("A:A", 30)
    ws.set_column("B:B", 20)
    ws.write(0, 0, "Returns Analysis", title_fmt)
    ret_data = [
        ("IRR", f"{model.returns_analysis.irr}%" if model.returns_analysis.irr else "N/A"),
        ("MOIC", f"{model.returns_analysis.moic}x"),
        ("Enterprise Value at Exit", f"${model.returns_analysis.enterprise_value_at_exit:,.0f}" if model.returns_analysis.enterprise_value_at_exit else "N/A"),
        ("Payback Period", f"{model.returns_analysis.payback_period_years} years" if model.returns_analysis.payback_period_years else "N/A"),
        ("Exit EBITDA Multiple", f"{model.returns_analysis.ebitda_multiple}x"),
        ("Total Management Fee Revenue (5yr)", f"${model.total_management_fee_revenue:,.0f}"),
        ("Total Timeback License Revenue (5yr)", f"${model.total_timeback_license_revenue:,.0f}"),
    ]
    for r, (label, val) in enumerate(ret_data, start=2):
        ws.write(r, 0, label, label_fmt)
        ws.write(r, 1, val)

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
