#!/usr/bin/env python3
"""Build financial model JSON specs for the do:generate-xlsx skill.

Formula-driven architecture: all computed values are Excel formulas referencing
the Assumptions sheet. Only the Assumptions sheet contains hardcoded values.
Uses IB-standard color coding (blue font + yellow bg for inputs).

Usage:
  python scripts/build_model.py --input research.json --templates jv-counterparty,jv-alpha --output-dir outputs/
  python scripts/build_model.py --input research.json --templates us-state --output-dir outputs/
  python scripts/build_model.py --input research.json --templates lic-counterparty,lic-alpha --output-dir outputs/
  python scripts/build_model.py --input research.json --auto --output-dir outputs/
  python scripts/build_model.py --input research.json --templates jv-counterparty,jv-alpha --premium-schools --output-dir outputs/

Run via:
  uv run --directory plugins/do python skills/financial-model/scripts/build_model.py ...
"""

import argparse
import json
import math
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VALID_TEMPLATES = {
    "jv-counterparty", "jv-alpha",
    "lic-counterparty", "lic-alpha",
    "us-state",
}

YEARS = list(range(0, 11))  # Year 0 through Year 10
YEAR_LABELS = [f"Year {y}" for y in YEARS]
# Column mapping: Year 0 = B, Year 1 = C, ..., Year 10 = L
YEAR_COLS = {y: chr(66 + y) for y in range(11)}  # B through L

# Cost structure defaults (% of tuition)
COST_PCT = {
    "personnel": 0.24,
    "timeback": 0.20,
    "real_estate": 0.22,
    "curriculum": 0.10,
    "programs": 0.13,
    "admin_ga": 0.12,
}

# US school types
US_SCHOOL_TYPES = {
    "micro": {"size": 20, "tuition_default": 8500, "label": "Micro School"},
    "flagship": {"size": 250, "tuition_default": 20000, "label": "Flagship Campus"},
    "virtual": {"size": 999999, "tuition_default": 4000, "label": "Virtual (GT School)"},
    "stem_sports": {"size": 175, "tuition_default": 16000, "label": "STEM / Sports Academy"},
}

# ---------------------------------------------------------------------------
# IB Color Coding Constants
# ---------------------------------------------------------------------------

# Font colors
BLUE_FONT = "0000FF"    # hardcoded inputs (overridable)
BLACK_FONT = "000000"   # formulas / calculations
GREEN_FONT = "008000"   # cross-sheet references

# Background colors
YELLOW_BG = "FFF2CC"    # input cells
LIGHT_GRAY_BG = "D9D9D9"  # totals / subtotals
OUTPUT_BG = "D9E2F3"    # output / result cells
HEADER_BG = "002060"    # section headers

# Formatting constants
HEADER_FORMAT = {
    "bold": True,
    "font_size": 11,
    "font_color": "FFFFFF",
    "bg_color": HEADER_BG,
    "alignment": {"horizontal": "center", "vertical": "center"},
}

SUBHEADER_FORMAT = {
    "bold": True,
    "font_size": 10,
    "bg_color": "D6E4F0",
}

CURRENCY_FMT = '#,##0_);(#,##0)'
CURRENCY_DETAILED_FMT = '#,##0.00_);(#,##0.00)'
PCT_FMT = "0.0%"
NUMBER_FMT = "#,##0"
RATIO_FMT = "0.0x"


# ---------------------------------------------------------------------------
# Tier classification & scaling (unchanged — used for default values)
# ---------------------------------------------------------------------------

def classify_tier(data: dict) -> int:
    gdp_pc = data.get("economy", {}).get("gdp_per_capita", 0)
    if gdp_pc > 30000:
        return 1
    elif gdp_pc >= 10000:
        return 2
    else:
        return 3


def is_us_state(data: dict) -> bool:
    return data.get("target", {}).get("type") == "us_state"


def compute_scaling(data: dict, tier: int) -> dict:
    """Compute default values for the Assumptions sheet."""
    econ = data.get("economy", {})
    demo = data.get("demographics", {})
    edu = data.get("education", {})
    overrides = data.get("overrides", {})

    gdp_pc = econ.get("gdp_per_capita", 15000)
    school_age_pop = demo.get("school_age_population", 1000000)
    avg_tuition = edu.get("avg_private_school_tuition", 12000)

    demand_factors = {1: 1.0, 2: 0.5, 3: 0.2}
    demand_factor = overrides.get("demand_factor", demand_factors.get(tier, 0.5))

    ppp_factor = min(1.0, gdp_pc / 30000)
    upfront_ask = max(25_000_000, school_age_pop * 2 * ppp_factor)
    student_target_5yr = max(5000, int(school_age_pop * 0.01 * demand_factor))
    per_student_budget = max(5000, min(30000, avg_tuition * 0.8))

    return {
        "tier": tier,
        "ppp_factor": round(ppp_factor, 3),
        "upfront_ask": round(upfront_ask),
        "student_target_5yr": student_target_5yr,
        "per_student_budget": round(per_student_budget),
        "demand_factor": demand_factor,
        "gdp_per_capita": gdp_pc,
        "school_age_population": school_age_pop,
        "avg_private_tuition": avg_tuition,
    }


def compute_enrollment_defaults(scaling: dict) -> list[int]:
    """Compute default enrollment ramp Year 0-10. These become editable inputs."""
    target = scaling["student_target_5yr"]
    enrollment = [0] * 11

    phase1 = min(5000, target)
    enrollment[1] = phase1

    if target > phase1:
        for y in range(2, 6):
            prev = enrollment[y - 1]
            growth = 0.70 if y <= 3 else 0.35
            enrollment[y] = min(target, int(prev * (1 + growth)))
        enrollment[5] = target
    else:
        for y in range(2, 6):
            enrollment[y] = target

    for y in range(6, 11):
        enrollment[y] = int(enrollment[y - 1] * 1.05)

    return enrollment


def compute_fill_rate_defaults() -> list[float]:
    """Default fill rates Year 0-10."""
    return [0.0, 0.60, 0.75] + [0.90] * 8


# ---------------------------------------------------------------------------
# Business rule validation
# ---------------------------------------------------------------------------

def validate_business_rules(template_id: str, scaling: dict) -> list[str]:
    errors = []
    psb = scaling["per_student_budget"]

    if template_id.startswith("jv"):
        if psb * 0.10 < 1:
            errors.append("Management fee (10% of per-student budget) is below minimum")
        if scaling["upfront_ask"] < 25_000_000:
            errors.append(f"Upfront ask ${scaling['upfront_ask']:,.0f} is below $25M minimum")

    if template_id in ("jv-counterparty", "jv-alpha", "lic-counterparty", "lic-alpha"):
        if psb * 0.20 < 1:
            errors.append("Timeback license (20% of per-student budget) is below minimum")
        if scaling["upfront_ask"] < 25_000_000:
            errors.append("Upfront IP fee below $25M minimum")

    return errors


# ---------------------------------------------------------------------------
# Assumptions sheet cell address map
# ---------------------------------------------------------------------------

# Fixed row positions for the Assumptions sheet (country templates).
# Every formula in the model references these addresses via named ranges.
# Row numbers are 1-indexed (Excel convention).

ASSUMPTIONS_MAP = {
    # Row 1: header
    # Row 2: blank
    # Row 3: "Market & Scale" section header
    "target_name":      4,
    "tier":             5,
    "gdp_per_capita":   6,
    "school_age_pop":   7,
    "ppp_factor":       8,   # formula: =MIN(1, B6/30000)
    "demand_factor":    9,
    "student_target":  10,   # formula: =MAX(5000, B7*0.01*B9)
    # Row 11: blank
    # Row 12: "Pricing & Revenue" section header
    "per_student_budget": 13,  # formula: =MAX(5000, MIN(30000, B14*0.8))
    "avg_tuition":     14,
    "ancillary_per_student": 15,
    # Row 16: blank
    # Row 17: "Cost Structure" section header
    "cost_pct_personnel":  18,
    "cost_pct_timeback":   19,
    "cost_pct_real_estate": 20,
    "cost_pct_curriculum":  21,
    "cost_pct_programs":    22,
    "cost_pct_admin":       23,
    # Row 24: blank
    # Row 25: "Fee Structure" section header
    "mgmt_fee_pct":    26,
    "timeback_pct":    27,
    "upfront_ip_fee":  28,
    "annual_support":  29,  # licensing only, 0 for JV
    # Row 30: blank
    # Row 31: "Valuation & Returns" section header
    "ebitda_multiple": 32,
    "discount_rate":   33,
    "target_irr":      34,
    "exit_year":       35,
    "avg_school_size": 36,
    "cost_per_school": 37,
    # Row 38: blank
    # Row 39: "Enrollment Phasing" section header
    # Row 40: enrollment Year 0-10 (B40:L40)
    "enrollment_row":  40,
    # Row 41: fill rates Year 0-10 (B41:L41)
    "fill_rate_row":   41,
    # Row 42: blank
    # Row 43: "Alpha Cost Assumptions" section header (jv-alpha / lic-alpha)
    "teacher_salary":  44,
    "guide_salary_multiplier": 45,  # 95th pctl = 1.3x
}

# Named ranges: name -> Assumptions sheet cell reference
NAMED_RANGES = {
    "Tier":               f"'Assumptions'!$B${ASSUMPTIONS_MAP['tier']}",
    "GDPPerCapita":       f"'Assumptions'!$B${ASSUMPTIONS_MAP['gdp_per_capita']}",
    "SchoolAgePop":       f"'Assumptions'!$B${ASSUMPTIONS_MAP['school_age_pop']}",
    "PPPFactor":          f"'Assumptions'!$B${ASSUMPTIONS_MAP['ppp_factor']}",
    "DemandFactor":       f"'Assumptions'!$B${ASSUMPTIONS_MAP['demand_factor']}",
    "StudentTarget":      f"'Assumptions'!$B${ASSUMPTIONS_MAP['student_target']}",
    "PerStudentBudget":   f"'Assumptions'!$B${ASSUMPTIONS_MAP['per_student_budget']}",
    "AvgTuition":         f"'Assumptions'!$B${ASSUMPTIONS_MAP['avg_tuition']}",
    "AncillaryPerStudent": f"'Assumptions'!$B${ASSUMPTIONS_MAP['ancillary_per_student']}",
    "CostPctPersonnel":   f"'Assumptions'!$B${ASSUMPTIONS_MAP['cost_pct_personnel']}",
    "CostPctTimeback":    f"'Assumptions'!$B${ASSUMPTIONS_MAP['cost_pct_timeback']}",
    "CostPctRealEstate":  f"'Assumptions'!$B${ASSUMPTIONS_MAP['cost_pct_real_estate']}",
    "CostPctCurriculum":  f"'Assumptions'!$B${ASSUMPTIONS_MAP['cost_pct_curriculum']}",
    "CostPctPrograms":    f"'Assumptions'!$B${ASSUMPTIONS_MAP['cost_pct_programs']}",
    "CostPctAdmin":       f"'Assumptions'!$B${ASSUMPTIONS_MAP['cost_pct_admin']}",
    "MgmtFeePct":         f"'Assumptions'!$B${ASSUMPTIONS_MAP['mgmt_fee_pct']}",
    "TimebackPct":        f"'Assumptions'!$B${ASSUMPTIONS_MAP['timeback_pct']}",
    "UpfrontIPFee":       f"'Assumptions'!$B${ASSUMPTIONS_MAP['upfront_ip_fee']}",
    "AnnualSupport":      f"'Assumptions'!$B${ASSUMPTIONS_MAP['annual_support']}",
    "EBITDAMultiple":     f"'Assumptions'!$B${ASSUMPTIONS_MAP['ebitda_multiple']}",
    "DiscountRate":       f"'Assumptions'!$B${ASSUMPTIONS_MAP['discount_rate']}",
    "TargetIRR":          f"'Assumptions'!$B${ASSUMPTIONS_MAP['target_irr']}",
    "ExitYear":           f"'Assumptions'!$B${ASSUMPTIONS_MAP['exit_year']}",
    "AvgSchoolSize":      f"'Assumptions'!$B${ASSUMPTIONS_MAP['avg_school_size']}",
    "CostPerSchool":      f"'Assumptions'!$B${ASSUMPTIONS_MAP['cost_per_school']}",
    "TeacherSalary":      f"'Assumptions'!$B${ASSUMPTIONS_MAP['teacher_salary']}",
    "GuideSalaryMult":    f"'Assumptions'!$B${ASSUMPTIONS_MAP['guide_salary_multiplier']}",
}


def a_cell(key: str) -> str:
    """Return absolute Assumptions sheet cell ref like Assumptions!$B$6."""
    return f"'Assumptions'!$B${ASSUMPTIONS_MAP[key]}"


def a_row_cell(key: str, col: str) -> str:
    """Return Assumptions sheet cell for a row-based entry (enrollment, fill rates)."""
    return f"'Assumptions'!${col}${ASSUMPTIONS_MAP[key]}"


# ---------------------------------------------------------------------------
# Sheet builder: Assumptions
# ---------------------------------------------------------------------------

def build_assumptions_sheet(template_id: str, scaling: dict, data: dict,
                            enrollment: list[int], fill_rates: list[float]) -> dict:
    """Build the Assumptions sheet with hardcoded inputs and calculated fields."""
    AM = ASSUMPTIONS_MAP
    teacher_salary = data.get("costs", {}).get("teacher_salary_usd", 40000)

    # Build rows — must match ASSUMPTIONS_MAP exactly
    rows: list[list] = []

    # Row 1: header
    rows.append(["Parameter", "Value", "Source", "Overridable"])
    # Row 2: blank
    rows.append([])
    # Row 3: section header
    rows.append(["Market & Scale", None, None, None])
    # Row 4
    rows.append([
        "Target Country/State",
        data.get("target", {}).get("name", "TBD"),
        "User input", "No"
    ])
    # Row 5
    rows.append(["Tier Classification", scaling["tier"], "Calculated from GDP/cap", "No"])
    # Row 6
    rows.append(["GDP per Capita (USD)", scaling["gdp_per_capita"], "World Bank / IMF", "Yes"])
    # Row 7
    rows.append(["School-Age Population", scaling["school_age_population"], "World Bank / UNESCO", "Yes"])
    # Row 8: PPP Factor — FORMULA
    rows.append(["PPP Factor", None, "Calculated: MIN(1, GDP/30000)", "No"])
    # Row 9
    rows.append(["Demand Factor", scaling["demand_factor"], "Derived / overridable", "Yes"])
    # Row 10: Student Target — FORMULA
    rows.append(["Student Target (Year 5)", None, "Calculated: MAX(5000, Pop*0.01*Demand)", "No"])
    # Row 11: blank
    rows.append([])
    # Row 12: section header
    rows.append(["Pricing & Revenue", None, None, None])
    # Row 13: Per-Student Budget — FORMULA
    rows.append(["Per-Student Budget (USD)", None, "Calculated: MAX(5000, MIN(30000, Tuition*0.8))", "No"])
    # Row 14
    rows.append(["Avg Private School Tuition", scaling["avg_private_tuition"], "ISC / agent-scraped", "Yes"])
    # Row 15
    rows.append(["Ancillary Revenue per Student", 500, "Default", "Yes"])
    # Row 16: blank
    rows.append([])
    # Row 17: section header
    rows.append(["Cost Structure (% of Tuition)", None, None, None])
    # Row 18
    rows.append(["Personnel (Guides)", COST_PCT["personnel"], "Default 24%", "Yes"])
    # Row 19
    rows.append(["Timeback Platform License", COST_PCT["timeback"], "Non-negotiable 20% floor", "No"])
    # Row 20
    rows.append(["Real Estate", COST_PCT["real_estate"], "Default 22%", "Yes"])
    # Row 21
    rows.append(["Curriculum Delivery", COST_PCT["curriculum"], "Default 10%", "Yes"])
    # Row 22
    rows.append(["Specialized Programs", COST_PCT["programs"], "Default 13%", "Yes"])
    # Row 23
    rows.append(["Admin, Marketing, G&A", COST_PCT["admin_ga"], "Default 12%", "Yes"])
    # Row 24: blank
    rows.append([])
    # Row 25: section header
    rows.append(["Fee Structure", None, None, None])
    # Row 26
    rows.append(["Management Fee %", 0.10, "Non-negotiable floor", "No"])
    # Row 27
    rows.append(["Timeback License %", 0.20, "Non-negotiable floor", "No"])
    # Row 28
    rows.append(["Upfront IP Fee (USD)", scaling["upfront_ask"], "Scaling formula", "Yes"])
    # Row 29
    annual_support = 1_000_000 if template_id.startswith("lic") else 0
    rows.append(["Annual Support & Maintenance", annual_support, "Default $1M (licensing)", "Yes"])
    # Row 30: blank
    rows.append([])
    # Row 31: section header
    rows.append(["Valuation & Returns", None, None, None])
    # Row 32
    rows.append(["EBITDA Multiple", 16, "12-20x range", "Yes"])
    # Row 33
    rows.append(["Discount Rate", 0.12, "10-15% range", "Yes"])
    # Row 34
    rows.append(["Target IRR", 0.25, "20-30% range", "Yes"])
    # Row 35
    rows.append(["Exit Timeline (Year)", 10, "Default", "Yes"])
    # Row 36
    rows.append(["Avg School Size (students)", 500, "Default", "Yes"])
    # Row 37
    rows.append(["Cost per School Buildout", 5_000_000, "Default $5M", "Yes"])
    # Row 38: blank
    rows.append([])
    # Row 39: section header
    rows.append(["Enrollment Phasing", None, None, None])
    # Row 40: enrollment by year
    rows.append(["Enrollment Target"] + enrollment)
    # Row 41: fill rates by year
    rows.append(["Fill Rate"] + fill_rates)
    # Row 42: blank
    rows.append([])
    # Row 43: section header
    rows.append(["Alpha Cost Assumptions", None, None, None])
    # Row 44
    rows.append(["Teacher Salary (USD)", teacher_salary, "Market research", "Yes"])
    # Row 45
    rows.append(["Guide Salary Multiplier (95th pctl)", 1.3, "Default 1.3x", "Yes"])

    assert len(rows) == 45, f"Assumptions rows: expected 45, got {len(rows)}"

    # Formulas for calculated cells
    formulas = {
        f"B{AM['ppp_factor']}":       f"=MIN(1,B{AM['gdp_per_capita']}/30000)",
        f"B{AM['student_target']}":    f"=MAX(5000,B{AM['school_age_pop']}*0.01*B{AM['demand_factor']})",
        f"B{AM['per_student_budget']}": f"=MAX(5000,MIN(30000,B{AM['avg_tuition']}*0.8))",
    }

    # --- IB Color Coding ---
    # Blue font + yellow bg: overridable input cells
    overridable_cells = [
        f"B{AM['gdp_per_capita']}",
        f"B{AM['school_age_pop']}",
        f"B{AM['demand_factor']}",
        f"B{AM['avg_tuition']}",
        f"B{AM['ancillary_per_student']}",
        f"B{AM['cost_pct_personnel']}",
        f"B{AM['cost_pct_real_estate']}",
        f"B{AM['cost_pct_curriculum']}",
        f"B{AM['cost_pct_programs']}",
        f"B{AM['cost_pct_admin']}",
        f"B{AM['upfront_ip_fee']}",
        f"B{AM['annual_support']}",
        f"B{AM['ebitda_multiple']}",
        f"B{AM['discount_rate']}",
        f"B{AM['target_irr']}",
        f"B{AM['exit_year']}",
        f"B{AM['avg_school_size']}",
        f"B{AM['cost_per_school']}",
        f"B{AM['teacher_salary']}",
        f"B{AM['guide_salary_multiplier']}",
    ]
    # Enrollment and fill rate cells are also overridable
    for y in range(11):
        col = YEAR_COLS[y]
        overridable_cells.append(f"{col}{AM['enrollment_row']}")
        overridable_cells.append(f"{col}{AM['fill_rate_row']}")

    cell_formats = [
        # Overridable inputs: blue font, yellow bg
        {"cells": overridable_cells, "font_color": BLUE_FONT, "bg_color": YELLOW_BG, "bold": True},
    ]

    # Number formatting
    currency_cells = [
        f"B{AM['gdp_per_capita']}", f"B{AM['per_student_budget']}",
        f"B{AM['avg_tuition']}", f"B{AM['ancillary_per_student']}",
        f"B{AM['upfront_ip_fee']}", f"B{AM['annual_support']}",
        f"B{AM['cost_per_school']}", f"B{AM['teacher_salary']}",
    ]
    pct_cells = [
        f"B{AM['ppp_factor']}", f"B{AM['cost_pct_personnel']}",
        f"B{AM['cost_pct_timeback']}", f"B{AM['cost_pct_real_estate']}",
        f"B{AM['cost_pct_curriculum']}", f"B{AM['cost_pct_programs']}",
        f"B{AM['cost_pct_admin']}", f"B{AM['mgmt_fee_pct']}",
        f"B{AM['timeback_pct']}", f"B{AM['discount_rate']}",
        f"B{AM['target_irr']}",
    ]
    # Fill rates as %
    for y in range(11):
        pct_cells.append(f"{YEAR_COLS[y]}{AM['fill_rate_row']}")

    # Enrollment as number
    enrollment_cells = [f"{YEAR_COLS[y]}{AM['enrollment_row']}" for y in range(11)]

    number_formats = [
        {"cells": currency_cells, "format": CURRENCY_FMT},
        {"cells": pct_cells, "format": PCT_FMT},
        {"cells": enrollment_cells, "format": NUMBER_FMT},
    ]

    section_header_rows = [3, 12, 17, 25, 31, 39, 43]

    return {
        "name": "Assumptions",
        "data": rows,
        "formulas": formulas,
        "column_widths": [
            {"column": "A", "width": 38},
            {"column": "B", "width": 20},
            {"column": "C", "width": 35},
            {"column": "D", "width": 15},
        ] + [{"column": YEAR_COLS[y], "width": 14} for y in range(1, 11)],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}] + [
            {"row": r, "format": SUBHEADER_FORMAT} for r in section_header_rows
        ],
        "number_formats": number_formats,
        "cell_formats": cell_formats,
        "freeze_panes": "B2",
        "comments": [
            {"cell": f"B{AM['ppp_factor']}", "text": "Formula: MIN(1, GDP per capita / 30000)"},
            {"cell": f"B{AM['student_target']}", "text": "Formula: MAX(5000, School-age pop * 1% * Demand factor)"},
            {"cell": f"B{AM['per_student_budget']}", "text": "Formula: MAX(5000, MIN(30000, Avg tuition * 80%))"},
            {"cell": f"B{AM['cost_pct_timeback']}", "text": "Non-negotiable floor: 20% of per-student budget"},
            {"cell": f"B{AM['mgmt_fee_pct']}", "text": "Non-negotiable floor: 10% of per-student budget"},
        ],
    }


# ---------------------------------------------------------------------------
# Helper: formula generation for year columns
# ---------------------------------------------------------------------------

def yr(y: int) -> str:
    """Return column letter for year index."""
    return YEAR_COLS[y]


def formulas_for_years(template: str, row: int, formula_fn) -> dict:
    """Generate formulas for columns B-L (Year 0-10) for a given row.

    formula_fn(col, y) -> formula string for that cell.
    Returns dict of cell_ref -> formula.
    """
    result = {}
    for y in range(11):
        col = yr(y)
        f = formula_fn(col, y)
        if f:
            result[f"{col}{row}"] = f
    return result


# ---------------------------------------------------------------------------
# Sheet builder: Student Rollout
# ---------------------------------------------------------------------------

def build_student_rollout_sheet(template_id: str) -> dict:
    """Build Student Rollout sheet with formulas referencing Assumptions."""
    AM = ASSUMPTIONS_MAP
    enroll_row = AM["enrollment_row"]
    fill_row = AM["fill_rate_row"]

    # Row layout:
    # 1: header (Year 0 ... Year 10)
    # 2: Gross Enrollment -> refs Assumptions enrollment row
    # 3: Fill Rate -> refs Assumptions fill rate row
    # 4: Effective Students -> enrollment * fill rate
    # 5: blank
    # 6: Schools at Scale -> CEILING(effective / school size)
    # 7: New Schools Opened -> schools[y] - schools[y-1]
    # 8: Avg School Size -> ref Assumptions
    # 9: blank
    # 10: Cumulative Enrollment

    header = [""] + YEAR_LABELS
    rows = [header]
    # Rows 2-10 are labels only — values come from formulas
    rows.append(["Gross Enrollment"] + [None] * 11)      # row 2
    rows.append(["Fill Rate"] + [None] * 11)               # row 3
    rows.append(["Effective Students"] + [None] * 11)      # row 4
    rows.append([])                                         # row 5
    rows.append(["Schools at Scale"] + [None] * 11)        # row 6
    rows.append(["New Schools Opened"] + [None] * 11)      # row 7
    rows.append(["Avg School Size"] + [None] * 11)         # row 8
    rows.append([])                                         # row 9
    rows.append(["Cumulative Enrollment"] + [None] * 11)   # row 10

    formulas = {}
    green_cells = []

    for y in range(11):
        c = yr(y)
        # Row 2: Gross Enrollment = Assumptions enrollment
        formulas[f"{c}2"] = f"='Assumptions'!{c}${enroll_row}"
        green_cells.append(f"{c}2")

        # Row 3: Fill Rate = Assumptions fill rate
        formulas[f"{c}3"] = f"='Assumptions'!{c}${fill_row}"
        green_cells.append(f"{c}3")

        # Row 4: Effective Students = enrollment * fill rate
        formulas[f"{c}4"] = f"={c}2*{c}3"

        # Row 6: Schools = CEILING(effective / avg school size, 1)
        formulas[f"{c}6"] = f"=IF({c}4=0,0,CEILING({c}4/AvgSchoolSize,1))"

        # Row 7: New Schools = current - previous (Year 0 = all new)
        if y == 0:
            formulas[f"{c}7"] = f"={c}6"
        else:
            prev_c = yr(y - 1)
            formulas[f"{c}7"] = f"=MAX(0,{c}6-{prev_c}6)"

        # Row 8: Avg School Size (constant from Assumptions)
        formulas[f"{c}8"] = "=AvgSchoolSize"
        green_cells.append(f"{c}8")

        # Row 10: Cumulative Enrollment
        formulas[f"{c}10"] = f"=SUM($B$4:{c}4)"

    cell_formats = [
        {"cells": green_cells, "font_color": GREEN_FONT},
    ]

    return {
        "name": "Student Rollout",
        "data": rows,
        "formulas": formulas,
        "column_widths": [{"column": "A", "width": 30}] + [
            {"column": yr(i), "width": 14} for i in range(11)
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [
            {"ranges": ["B2:L2", "B4:L4", "B6:L8", "B10:L10"], "format": NUMBER_FMT},
            {"ranges": ["B3:L3"], "format": PCT_FMT},
        ],
        "cell_formats": cell_formats,
        "freeze_panes": "B2",
    }


# ---------------------------------------------------------------------------
# Sheet builder: P&L Projection
# ---------------------------------------------------------------------------

def build_pnl_sheet(template_id: str, data: dict) -> dict:
    """Build P&L sheet with all formulas referencing Assumptions + Student Rollout."""
    AM = ASSUMPTIONS_MAP
    SR = "'Student Rollout'"  # sheet ref prefix

    rows: list[list] = []
    formulas: dict[str, str] = {}
    green_cells: list[str] = []
    total_cells: list[str] = []

    header = [""] + YEAR_LABELS
    rows.append(header)  # row 1

    if template_id == "jv-counterparty":
        # Row 2: REVENUE section header
        rows.append(["REVENUE"] + [None] * 11)
        # Row 3: Tuition Revenue = Effective Students * Per-Student Budget
        rows.append(["Tuition Revenue"] + [None] * 11)
        # Row 4: Ancillary Revenue
        rows.append(["Ancillary Revenue"] + [None] * 11)
        # Row 5: Total Revenue
        rows.append(["Total Revenue"] + [None] * 11)
        # Row 6: blank
        rows.append([])
        # Row 7: OPERATING COSTS section header
        rows.append(["OPERATING COSTS"] + [None] * 11)
        # Row 8-14: cost lines
        rows.append(["Personnel (Guides)"] + [None] * 11)
        rows.append(["Timeback Platform License"] + [None] * 11)
        rows.append(["Real Estate"] + [None] * 11)
        rows.append(["Curriculum Delivery"] + [None] * 11)
        rows.append(["Specialized Programs"] + [None] * 11)
        rows.append(["Management Fee (to Alpha)"] + [None] * 11)
        rows.append(["Admin, Marketing, G&A"] + [None] * 11)
        # Row 15: Total Operating Costs
        rows.append(["Total Operating Costs"] + [None] * 11)
        # Row 16: blank
        rows.append([])
        # Row 17: EBITDA
        rows.append(["EBITDA"] + [None] * 11)
        # Row 18: EBITDA Margin
        rows.append(["EBITDA Margin"] + [None] * 11)

        for y in range(11):
            c = yr(y)
            eff = f"{SR}!{c}4"  # effective students from Student Rollout row 4

            formulas[f"{c}3"] = f"={eff}*PerStudentBudget"
            green_cells.append(f"{c}3")
            formulas[f"{c}4"] = f"={eff}*AncillaryPerStudent"
            green_cells.append(f"{c}4")
            formulas[f"{c}5"] = f"={c}3+{c}4"
            total_cells.append(f"{c}5")

            formulas[f"{c}8"]  = f"={c}3*CostPctPersonnel"
            formulas[f"{c}9"]  = f"={c}3*CostPctTimeback"
            formulas[f"{c}10"] = f"={c}3*CostPctRealEstate"
            formulas[f"{c}11"] = f"={c}3*CostPctCurriculum"
            formulas[f"{c}12"] = f"={c}3*CostPctPrograms"
            formulas[f"{c}13"] = f"={eff}*PerStudentBudget*MgmtFeePct"
            green_cells.append(f"{c}13")
            formulas[f"{c}14"] = f"={c}3*CostPctAdmin"
            formulas[f"{c}15"] = f"=SUM({c}8:{c}14)"
            total_cells.append(f"{c}15")

            formulas[f"{c}17"] = f"={c}5-{c}15"
            formulas[f"{c}18"] = f"=IF({c}5=0,0,{c}17/{c}5)"

    elif template_id == "jv-alpha":
        # Alpha perspective: fee revenue vs costs to enter
        rows.append(["ALPHA REVENUE"] + [None] * 11)               # 2
        rows.append(["Upfront IP / License Fees"] + [None] * 11)   # 3
        rows.append(["Management Fee Prepayment"] + [None] * 11)   # 4
        rows.append(["Management Fee (Ongoing)"] + [None] * 11)    # 5
        rows.append(["Timeback License Fee"] + [None] * 11)        # 6
        rows.append(["Total Alpha Revenue"] + [None] * 11)         # 7
        rows.append([])                                              # 8
        rows.append(["ALPHA COSTS TO ENTER"] + [None] * 11)        # 9
        rows.append(["Team Deployment"] + [None] * 11)              # 10
        rows.append(["Legal / Regulatory"] + [None] * 11)           # 11
        rows.append(["Guide School Buildout"] + [None] * 11)       # 12
        rows.append(["Guide Salaries (95th pctl)"] + [None] * 11)  # 13
        rows.append(["Curriculum Specialist"] + [None] * 11)        # 14
        rows.append(["Localization"] + [None] * 11)                 # 15
        rows.append(["Working Capital"] + [None] * 11)              # 16
        rows.append(["Total Alpha Costs"] + [None] * 11)            # 17
        rows.append([])                                              # 18
        rows.append(["ALPHA EBITDA"] + [None] * 11)                 # 19
        rows.append(["Alpha EBITDA Margin"] + [None] * 11)          # 20

        for y in range(11):
            c = yr(y)
            eff = f"{SR}!{c}4"

            # Revenue
            if y == 0:
                formulas[f"{c}3"] = "=UpfrontIPFee"
                green_cells.append(f"{c}3")
                # Prepayment: min(5000, StudentTarget) * PSB * MgmtFeePct * 2
                formulas[f"{c}4"] = "=MIN(5000,StudentTarget)*PerStudentBudget*MgmtFeePct*2"
                green_cells.append(f"{c}4")
            else:
                formulas[f"{c}3"] = "=0"
                formulas[f"{c}4"] = "=0"

            formulas[f"{c}5"] = f"={eff}*PerStudentBudget*MgmtFeePct"
            green_cells.append(f"{c}5")
            formulas[f"{c}6"] = f"={eff}*PerStudentBudget*TimebackPct"
            green_cells.append(f"{c}6")
            formulas[f"{c}7"] = f"=SUM({c}3:{c}6)"
            total_cells.append(f"{c}7")

            # Costs — these are schedule-based, using diminishing hardcoded patterns
            # Team deployment: $200K Y0, $50K ongoing
            if y == 0:
                formulas[f"{c}10"] = "=200000"
                formulas[f"{c}11"] = "=300000"
                formulas[f"{c}12"] = "=500000"
                formulas[f"{c}16"] = "=1000000"
            elif y == 1:
                formulas[f"{c}10"] = "=50000"
                formulas[f"{c}11"] = "=50000"
                formulas[f"{c}12"] = "=300000"
                formulas[f"{c}16"] = "=500000"
            else:
                formulas[f"{c}10"] = "=50000"
                formulas[f"{c}11"] = "=50000"
                formulas[f"{c}12"] = "=100000"
                formulas[f"{c}16"] = "=0"

            # Guide salaries: guides per 25 students * teacher salary * multiplier
            formulas[f"{c}13"] = f"=IF({eff}=0,0,CEILING({eff}/25,1)*TeacherSalary*GuideSalaryMult)"
            green_cells.append(f"{c}13")

            # Curriculum specialist
            if y < 3:
                formulas[f"{c}14"] = "=180000"
            else:
                formulas[f"{c}14"] = "=150000"

            # Localization
            if y == 0:
                formulas[f"{c}15"] = "=500000"
            elif y == 1:
                formulas[f"{c}15"] = "=300000"
            elif y == 2:
                formulas[f"{c}15"] = "=200000"
            else:
                formulas[f"{c}15"] = "=100000"

            formulas[f"{c}17"] = f"=SUM({c}10:{c}16)"
            total_cells.append(f"{c}17")

            formulas[f"{c}19"] = f"={c}7-{c}17"
            formulas[f"{c}20"] = f"=IF({c}7=0,0,{c}19/{c}7)"

    elif template_id == "lic-counterparty":
        rows.append(["REVENUE"] + [None] * 11)                            # 2
        rows.append(["Tuition Revenue"] + [None] * 11)                    # 3
        rows.append(["Ancillary Revenue"] + [None] * 11)                  # 4
        rows.append(["Total Revenue"] + [None] * 11)                      # 5
        rows.append([])                                                     # 6
        rows.append(["OPERATING COSTS"] + [None] * 11)                    # 7
        rows.append(["Personnel (Guides) — own staff"] + [None] * 11)     # 8
        rows.append(["Timeback License Fee (to Alpha)"] + [None] * 11)    # 9
        rows.append(["Real Estate — own expense"] + [None] * 11)          # 10
        rows.append(["Curriculum Delivery — own expense"] + [None] * 11)  # 11
        rows.append(["Specialized Programs — own expense"] + [None] * 11) # 12
        rows.append(["Annual Support & Maintenance (to Alpha)"] + [None] * 11)  # 13
        rows.append(["Admin, Marketing, G&A"] + [None] * 11)              # 14
        rows.append(["Total Operating Costs"] + [None] * 11)              # 15
        rows.append([])                                                     # 16
        rows.append(["EBITDA"] + [None] * 11)                             # 17
        rows.append(["EBITDA Margin"] + [None] * 11)                      # 18

        for y in range(11):
            c = yr(y)
            eff = f"{SR}!{c}4"

            formulas[f"{c}3"] = f"={eff}*PerStudentBudget"
            green_cells.append(f"{c}3")
            formulas[f"{c}4"] = f"={eff}*AncillaryPerStudent"
            green_cells.append(f"{c}4")
            formulas[f"{c}5"] = f"={c}3+{c}4"
            total_cells.append(f"{c}5")

            formulas[f"{c}8"]  = f"={c}3*CostPctPersonnel"
            formulas[f"{c}9"]  = f"={eff}*PerStudentBudget*TimebackPct"
            green_cells.append(f"{c}9")
            formulas[f"{c}10"] = f"={c}3*CostPctRealEstate"
            formulas[f"{c}11"] = f"={c}3*CostPctCurriculum"
            formulas[f"{c}12"] = f"={c}3*CostPctPrograms"
            formulas[f"{c}13"] = "=AnnualSupport"
            green_cells.append(f"{c}13")
            formulas[f"{c}14"] = f"={c}3*CostPctAdmin"
            formulas[f"{c}15"] = f"=SUM({c}8:{c}14)"
            total_cells.append(f"{c}15")

            formulas[f"{c}17"] = f"={c}5-{c}15"
            formulas[f"{c}18"] = f"=IF({c}5=0,0,{c}17/{c}5)"

    elif template_id == "lic-alpha":
        rows.append(["ALPHA REVENUE"] + [None] * 11)                       # 2
        rows.append(["Upfront IP Fee"] + [None] * 11)                      # 3
        rows.append(["Timeback License (Per-Student Royalty)"] + [None] * 11)  # 4
        rows.append(["Annual Support & Maintenance"] + [None] * 11)        # 5
        rows.append(["Total Alpha Revenue"] + [None] * 11)                 # 6
        rows.append([])                                                      # 7
        rows.append(["ALPHA COSTS"] + [None] * 11)                         # 8
        rows.append(["Team Deployment / Advisory"] + [None] * 11)          # 9
        rows.append(["Legal / Regulatory"] + [None] * 11)                  # 10
        rows.append(["Guide Training Delivery"] + [None] * 11)            # 11
        rows.append(["Curriculum Specialist"] + [None] * 11)               # 12
        rows.append(["QA / Certification Visits"] + [None] * 11)          # 13
        rows.append(["Curriculum Updates Delivery"] + [None] * 11)        # 14
        rows.append(["Total Alpha Costs"] + [None] * 11)                   # 15
        rows.append([])                                                      # 16
        rows.append(["ALPHA EBITDA"] + [None] * 11)                        # 17
        rows.append(["Alpha EBITDA Margin"] + [None] * 11)                 # 18

        for y in range(11):
            c = yr(y)
            eff = f"{SR}!{c}4"

            # Revenue
            formulas[f"{c}3"] = "=UpfrontIPFee" if y == 0 else "=0"
            if y == 0:
                green_cells.append(f"{c}3")
            formulas[f"{c}4"] = f"={eff}*PerStudentBudget*TimebackPct"
            green_cells.append(f"{c}4")
            formulas[f"{c}5"] = "=AnnualSupport"
            green_cells.append(f"{c}5")
            formulas[f"{c}6"] = f"=SUM({c}3:{c}5)"
            total_cells.append(f"{c}6")

            # Costs — lighter than JV
            if y == 0:
                formulas[f"{c}9"]  = "=150000"
                formulas[f"{c}10"] = "=200000"
                formulas[f"{c}11"] = "=300000"
            elif y == 1:
                formulas[f"{c}9"]  = "=75000"
                formulas[f"{c}10"] = "=25000"
                formulas[f"{c}11"] = "=200000"
            else:
                formulas[f"{c}9"]  = "=75000"
                formulas[f"{c}10"] = "=25000"
                formulas[f"{c}11"] = "=100000"

            formulas[f"{c}12"] = "=150000" if y < 3 else "=100000"
            formulas[f"{c}13"] = "=0" if y == 0 else "=100000"
            formulas[f"{c}14"] = "=0" if y == 0 else ("=50000" if y == 1 else "=75000")

            formulas[f"{c}15"] = f"=SUM({c}9:{c}14)"
            total_cells.append(f"{c}15")

            formulas[f"{c}17"] = f"={c}6-{c}15"
            formulas[f"{c}18"] = f"=IF({c}6=0,0,{c}17/{c}6)"

    # Determine which row is EBITDA and margin based on template
    if template_id in ("jv-counterparty", "lic-counterparty"):
        ebitda_row, margin_row = 17, 18
    elif template_id == "jv-alpha":
        ebitda_row, margin_row = 19, 20
    else:  # lic-alpha
        ebitda_row, margin_row = 17, 18

    cell_formats = [
        {"cells": green_cells, "font_color": GREEN_FONT},
        {"cells": total_cells, "bold": True, "bg_color": LIGHT_GRAY_BG},
    ]
    # EBITDA row bold
    ebitda_cells = [f"{yr(y)}{ebitda_row}" for y in range(11)]
    cell_formats.append({"cells": ebitda_cells, "bold": True, "bg_color": OUTPUT_BG})

    # Number formatting
    margin_cells = [f"{yr(y)}{margin_row}" for y in range(11)]
    num_rows = len(rows)

    return {
        "name": "P&L Projection",
        "data": rows,
        "formulas": formulas,
        "column_widths": [{"column": "A", "width": 38}] + [
            {"column": yr(i), "width": 16} for i in range(11)
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [
            {"ranges": [f"B2:L{num_rows}"], "format": CURRENCY_FMT},
            {"cells": margin_cells, "format": PCT_FMT},
        ],
        "cell_formats": cell_formats,
        "freeze_panes": "B2",
    }


# ---------------------------------------------------------------------------
# Sheet builder: Unit Economics
# ---------------------------------------------------------------------------

def build_unit_economics_sheet(template_id: str) -> dict:
    """Build Unit Economics sheet with formulas referencing Assumptions."""
    rows: list[list] = []
    formulas: dict[str, str] = {}
    green_cells: list[str] = []

    rows.append(["Per-Student Economics", "Amount (USD)", "% of Tuition"])  # 1
    rows.append([])  # 2
    rows.append(["REVENUE PER STUDENT", None, None])  # 3
    rows.append(["Tuition", None, None])  # 4
    rows.append(["Ancillary", None, None])  # 5
    rows.append(["Total Revenue per Student", None, None])  # 6
    rows.append([])  # 7
    rows.append(["COSTS PER STUDENT", None, None])  # 8
    rows.append(["Personnel (Guides)", None, None])  # 9
    rows.append(["Timeback Platform", None, None])  # 10
    rows.append(["Real Estate", None, None])  # 11
    rows.append(["Curriculum Delivery", None, None])  # 12
    rows.append(["Specialized Programs", None, None])  # 13
    rows.append(["Admin, Marketing, G&A", None, None])  # 14

    # Revenue formulas
    formulas["B4"] = "=PerStudentBudget"
    green_cells.append("B4")
    formulas["C4"] = "=1"
    formulas["B5"] = "=AncillaryPerStudent"
    green_cells.append("B5")
    formulas["C5"] = "=B5/B4"
    formulas["B6"] = "=B4+B5"
    formulas["C6"] = "=B6/B4"

    # Cost formulas
    cost_rows = {
        9: "CostPctPersonnel",
        10: "CostPctTimeback",
        11: "CostPctRealEstate",
        12: "CostPctCurriculum",
        13: "CostPctPrograms",
        14: "CostPctAdmin",
    }
    for r, named_range in cost_rows.items():
        formulas[f"B{r}"] = f"=PerStudentBudget*{named_range}"
        formulas[f"C{r}"] = f"={named_range}"

    next_row = 15

    if template_id.startswith("jv"):
        rows.append(["Management Fee (to Alpha)", None, None])  # 15
        formulas["B15"] = "=PerStudentBudget*MgmtFeePct"
        formulas["C15"] = "=MgmtFeePct"
        next_row = 16

    rows.append([])  # blank
    next_row += 1
    total_row = next_row
    rows.append(["Total Cost per Student", None, None])
    if template_id.startswith("jv"):
        formulas[f"B{total_row}"] = "=SUM(B9:B15)"
    else:
        formulas[f"B{total_row}"] = "=SUM(B9:B14)"
    formulas[f"C{total_row}"] = f"=B{total_row}/B4"

    margin_row = total_row + 1
    rows.append(["Contribution Margin per Student", None, None])
    formulas[f"B{margin_row}"] = f"=B6-B{total_row}"
    formulas[f"C{margin_row}"] = f"=B{margin_row}/B4"

    cell_formats = [
        {"cells": green_cells, "font_color": GREEN_FONT},
        {"cells": [f"B{total_row}", f"B{margin_row}"], "bold": True, "bg_color": OUTPUT_BG},
    ]

    return {
        "name": "Unit Economics",
        "data": rows,
        "formulas": formulas,
        "column_widths": [
            {"column": "A", "width": 35},
            {"column": "B", "width": 20},
            {"column": "C", "width": 18},
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [
            {"ranges": [f"B2:B{margin_row}"], "format": CURRENCY_FMT},
            {"ranges": [f"C2:C{margin_row}"], "format": PCT_FMT},
        ],
        "cell_formats": cell_formats,
        "freeze_panes": "A2",
    }


# ---------------------------------------------------------------------------
# Sheet builder: Capital Deployment
# ---------------------------------------------------------------------------

def build_capital_deployment_sheet(template_id: str) -> dict:
    """Build Capital Deployment sheet with formulas."""
    SR = "'Student Rollout'"
    rows: list[list] = []
    formulas: dict[str, str] = {}
    green_cells: list[str] = []
    total_cells: list[str] = []

    header = [""] + YEAR_LABELS
    rows.append(header)  # row 1

    if template_id in ("jv-counterparty", "jv-alpha"):
        rows.append(["IP Development & Localization"] + [None] * 11)  # 2
        rows.append(["Management Fee Prepayment"] + [None] * 11)      # 3
        rows.append(["Launch Capital"] + [None] * 11)                  # 4
        rows.append(["RE Buildout (via dev partners)"] + [None] * 11) # 5
        rows.append(["Scholarship / Backstop Funding"] + [None] * 11) # 6
        rows.append([])                                                 # 7
        rows.append(["Total Capital per Year"] + [None] * 11)         # 8
        rows.append(["Cumulative Capital Deployed"] + [None] * 11)    # 9

        launch_schedule = [50_000_000, 30_000_000, 20_000_000, 10_000_000, 10_000_000] + [0] * 6

        for y in range(11):
            c = yr(y)
            # IP Fee: Year 0 only
            formulas[f"{c}2"] = "=UpfrontIPFee" if y == 0 else "=0"
            if y == 0:
                green_cells.append(f"{c}2")

            # Mgmt fee prepayment: Year 0 only
            if y == 0:
                formulas[f"{c}3"] = "=MIN(5000,StudentTarget)*PerStudentBudget*MgmtFeePct*2"
                green_cells.append(f"{c}3")
            else:
                formulas[f"{c}3"] = "=0"

            # Launch capital (schedule)
            formulas[f"{c}4"] = f"={launch_schedule[y]}"

            # RE Buildout = new schools * cost per school
            formulas[f"{c}5"] = f"={SR}!{c}7*CostPerSchool"
            green_cells.append(f"{c}5")

            # Scholarship: 50% of effective students * $10K (Year 1+)
            if y == 0:
                formulas[f"{c}6"] = "=0"
            else:
                formulas[f"{c}6"] = f"={SR}!{c}4*10000*0.5"
                green_cells.append(f"{c}6")

            formulas[f"{c}8"] = f"=SUM({c}2:{c}6)"
            total_cells.append(f"{c}8")
            formulas[f"{c}9"] = f"=SUM($B$8:{c}8)"

    elif template_id.startswith("lic"):
        rows.append(["Upfront IP Fee"] + [None] * 11)     # 2
        rows.append(["Launch Capital"] + [None] * 11)       # 3
        rows.append(["Facility Buildout"] + [None] * 11)   # 4
        rows.append([])                                      # 5
        rows.append(["Total Capital per Year"] + [None] * 11)  # 6
        rows.append(["Cumulative Capital Deployed"] + [None] * 11)  # 7

        launch_lic = [20_000_000, 15_000_000, 10_000_000, 5_000_000, 5_000_000] + [0] * 6
        facility = [10_000_000, 8_000_000, 5_000_000, 3_000_000, 3_000_000] + [0] * 6

        for y in range(11):
            c = yr(y)
            formulas[f"{c}2"] = "=UpfrontIPFee" if y == 0 else "=0"
            if y == 0:
                green_cells.append(f"{c}2")
            formulas[f"{c}3"] = f"={launch_lic[y]}"
            formulas[f"{c}4"] = f"={facility[y]}"
            formulas[f"{c}6"] = f"=SUM({c}2:{c}4)"
            total_cells.append(f"{c}6")
            formulas[f"{c}7"] = f"=SUM($B$6:{c}6)"

    num_rows = len(rows)

    cell_formats = [
        {"cells": green_cells, "font_color": GREEN_FONT},
        {"cells": total_cells, "bold": True, "bg_color": LIGHT_GRAY_BG},
    ]

    return {
        "name": "Capital Deployment",
        "data": rows,
        "formulas": formulas,
        "column_widths": [{"column": "A", "width": 38}] + [
            {"column": yr(i), "width": 18} for i in range(11)
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [
            {"ranges": [f"B2:L{num_rows}"], "format": CURRENCY_FMT},
        ],
        "cell_formats": cell_formats,
        "freeze_panes": "B2",
    }


# ---------------------------------------------------------------------------
# Sheet builder: Cash Flow
# ---------------------------------------------------------------------------

def build_cashflow_sheet(template_id: str) -> dict:
    """Build Cash Flow sheet with cross-sheet formula references."""
    PNL = "'P&L Projection'"
    CAP = "'Capital Deployment'"

    rows: list[list] = []
    formulas: dict[str, str] = {}
    green_cells: list[str] = []

    header = [""] + YEAR_LABELS
    rows.append(header)                                      # 1
    rows.append(["Operating Cash Flow (EBITDA)"] + [None] * 11)  # 2
    rows.append(["Capital Expenditures"] + [None] * 11)      # 3
    rows.append(["Free Cash Flow"] + [None] * 11)            # 4
    rows.append([])                                           # 5
    rows.append(["Cumulative Cash Flow"] + [None] * 11)      # 6
    rows.append(["Payback Period", None] + [None] * 10)      # 7

    # Determine which P&L row has EBITDA and which Cap Deploy row has totals
    if template_id in ("jv-counterparty", "lic-counterparty", "lic-alpha"):
        ebitda_pnl_row = 17
    elif template_id == "jv-alpha":
        ebitda_pnl_row = 19
    else:
        ebitda_pnl_row = 17

    if template_id in ("jv-counterparty", "jv-alpha"):
        cap_total_row = 8
    else:
        cap_total_row = 6

    for y in range(11):
        c = yr(y)
        # EBITDA from P&L
        formulas[f"{c}2"] = f"={PNL}!{c}{ebitda_pnl_row}"
        green_cells.append(f"{c}2")

        # Capital expenditures (negated)
        formulas[f"{c}3"] = f"=-{CAP}!{c}{cap_total_row}"
        green_cells.append(f"{c}3")

        # Free Cash Flow
        formulas[f"{c}4"] = f"={c}2+{c}3"

        # Cumulative
        formulas[f"{c}6"] = f"=SUM($B$4:{c}4)"

    # Payback period: find first year where cumulative > 0
    formulas["B7"] = '=IFERROR(INDEX(B1:L1,MATCH(TRUE,B6:L6>0,0)),"N/A")'

    cell_formats = [
        {"cells": green_cells, "font_color": GREEN_FONT},
        {"cells": [f"{yr(y)}4" for y in range(11)], "bold": True},
    ]

    return {
        "name": "Cash Flow",
        "data": rows,
        "formulas": formulas,
        "column_widths": [{"column": "A", "width": 35}] + [
            {"column": yr(i), "width": 18} for i in range(11)
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [
            {"ranges": ["B2:L6"], "format": CURRENCY_FMT},
        ],
        "cell_formats": cell_formats,
        "freeze_panes": "B2",
        "conditional_formatting": [
            {
                "range": "B4:L4",
                "rule_type": "cell_is",
                "operator": "lessThan",
                "formula": ["0"],
                "font_color": "FF0000",
                "bg_color": "FFC7CE",
            },
            {
                "range": "B4:L4",
                "rule_type": "cell_is",
                "operator": "greaterThan",
                "formula": ["0"],
                "font_color": "006100",
                "bg_color": "C6EFCE",
            },
        ],
    }


# ---------------------------------------------------------------------------
# Sheet builder: Returns Analysis
# ---------------------------------------------------------------------------

def build_returns_sheet(template_id: str) -> dict:
    """Build Returns Analysis sheet with IRR/NPV formulas."""
    PNL = "'P&L Projection'"
    CF = "'Cash Flow'"
    CAP = "'Capital Deployment'"

    rows: list[list] = []
    formulas: dict[str, str] = {}
    green_cells: list[str] = []

    rows.append(["Returns Analysis", "Value"])          # 1
    rows.append([])                                      # 2
    rows.append(["KEY METRICS", None])                   # 3
    rows.append(["Year 5 EBITDA", None])                 # 4
    rows.append(["Year 10 EBITDA", None])                # 5
    rows.append(["Exit Multiple", None])                 # 6
    rows.append(["Enterprise Value at Exit", None])      # 7
    rows.append([])                                      # 8
    rows.append(["Total Capital Invested", None])        # 9
    rows.append(["MOIC (Multiple on Invested Capital)", None])  # 10
    rows.append(["IRR (Internal Rate of Return)", None]) # 11
    rows.append(["NPV", None])                           # 12
    rows.append([])                                      # 13
    rows.append(["VALUATION PARAMETERS", None])          # 14
    rows.append(["EBITDA Multiple Range", "12-20x"])     # 15
    rows.append(["Discount Rate", None])                 # 16
    rows.append(["Target IRR", None])                    # 17
    rows.append(["Exit Timeline", None])                 # 18

    # Determine EBITDA row in P&L
    if template_id in ("jv-counterparty", "lic-counterparty", "lic-alpha"):
        ebitda_pnl_row = 17
    elif template_id == "jv-alpha":
        ebitda_pnl_row = 19
    else:
        ebitda_pnl_row = 17

    # Cumulative cap deploy row
    if template_id in ("jv-counterparty", "jv-alpha"):
        cap_cumul_row = 9
    else:
        cap_cumul_row = 7

    # Year 5 = column G, Year 10 = column L
    formulas["B4"] = f"={PNL}!G{ebitda_pnl_row}"
    green_cells.append("B4")
    formulas["B5"] = f"={PNL}!L{ebitda_pnl_row}"
    green_cells.append("B5")
    formulas["B6"] = "=EBITDAMultiple"
    green_cells.append("B6")
    formulas["B7"] = "=B5*B6"

    # Total Capital = cumulative at end
    formulas["B9"] = f"={CAP}!L{cap_cumul_row}"
    green_cells.append("B9")
    formulas["B10"] = "=IF(B9=0,0,B7/B9)"

    # IRR on Free Cash Flow row (Cash Flow row 4)
    formulas["B11"] = f"=IFERROR(IRR({CF}!B4:L4),\"N/A\")"
    green_cells.append("B11")

    # NPV
    formulas["B12"] = f"=IFERROR(NPV(DiscountRate,{CF}!C4:L4)+{CF}!B4,\"N/A\")"
    green_cells.append("B12")

    formulas["B16"] = "=DiscountRate"
    green_cells.append("B16")
    formulas["B17"] = "=TargetIRR"
    green_cells.append("B17")
    formulas["B18"] = "=ExitYear"
    green_cells.append("B18")

    cell_formats = [
        {"cells": green_cells, "font_color": GREEN_FONT},
        {"cells": ["B7", "B10", "B11"], "bold": True, "bg_color": OUTPUT_BG},
    ]

    return {
        "name": "Returns Analysis",
        "data": rows,
        "formulas": formulas,
        "column_widths": [
            {"column": "A", "width": 42},
            {"column": "B", "width": 25},
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [
            {"cells": ["B4", "B5", "B7", "B9", "B12"], "format": CURRENCY_FMT},
            {"cells": ["B10"], "format": RATIO_FMT},
            {"cells": ["B11", "B16", "B17"], "format": PCT_FMT},
        ],
        "cell_formats": cell_formats,
        "freeze_panes": "A2",
    }


# ---------------------------------------------------------------------------
# Sheet builder: Sensitivity Analysis
# ---------------------------------------------------------------------------

def build_sensitivity_sheet(template_id: str, scaling: dict) -> dict:
    """Build Sensitivity Analysis with scenario formulas.

    Each variable block shows how varying that input affects key outputs.
    Uses direct formulas (not Excel DATA TABLEs) for portability.
    """
    PNL = "'P&L Projection'"
    CF = "'Cash Flow'"

    if template_id in ("jv-counterparty", "lic-counterparty", "lic-alpha"):
        ebitda_pnl_row = 17
    elif template_id == "jv-alpha":
        ebitda_pnl_row = 19
    else:
        ebitda_pnl_row = 17

    rows: list[list] = []
    formulas: dict[str, str] = {}
    green_cells: list[str] = []

    # Header
    rows.append(["Sensitivity Variable", "Base Case", "-20%", "-10%", "+10%", "+20%", "Impact On"])  # 1
    rows.append([])  # 2

    # Tuition sensitivity
    rows.append(["Per-Student Budget", None, None, None, None, None, "Revenue, EBITDA, IRR"])  # 3
    formulas["B3"] = "=PerStudentBudget"
    green_cells.append("B3")
    formulas["C3"] = "=PerStudentBudget*0.8"
    formulas["D3"] = "=PerStudentBudget*0.9"
    formulas["E3"] = "=PerStudentBudget*1.1"
    formulas["F3"] = "=PerStudentBudget*1.2"

    # Enrollment sensitivity
    rows.append(["Student Target", None, None, None, None, None, "Revenue, Schools, CapEx"])  # 4
    formulas["B4"] = "=StudentTarget"
    green_cells.append("B4")
    formulas["C4"] = "=StudentTarget*0.8"
    formulas["D4"] = "=StudentTarget*0.9"
    formulas["E4"] = "=StudentTarget*1.1"
    formulas["F4"] = "=StudentTarget*1.2"

    # EBITDA Margin scenario
    rows.append(["EBITDA Margin (Y5)", None, None, None, None, None, "Returns, Payback"])  # 5
    formulas["B5"] = f"=IF({PNL}!G5=0,0,{PNL}!G{ebitda_pnl_row}/{PNL}!G5)"
    green_cells.append("B5")
    formulas["C5"] = "=B5-0.05"
    formulas["D5"] = "=B5-0.025"
    formulas["E5"] = "=B5+0.025"
    formulas["F5"] = "=B5+0.05"

    # Exit Multiple
    rows.append(["Exit Multiple", None, None, None, None, None, "EV, IRR, MOIC"])  # 6
    formulas["B6"] = "=EBITDAMultiple"
    green_cells.append("B6")
    formulas["C6"] = "=EBITDAMultiple*0.75"
    formulas["D6"] = "=EBITDAMultiple*0.875"
    formulas["E6"] = "=EBITDAMultiple*1.125"
    formulas["F6"] = "=EBITDAMultiple*1.25"

    # Fill Rate
    rows.append(["Fill Rate (steady state)", None, None, None, None, None, "Revenue Ramp"])  # 7
    formulas["B7"] = f"='Assumptions'!L{ASSUMPTIONS_MAP['fill_rate_row']}"
    green_cells.append("B7")
    formulas["C7"] = "=B7-0.15"
    formulas["D7"] = "=B7-0.10"
    formulas["E7"] = "=B7+0.05"
    formulas["F7"] = "=MIN(1,B7+0.05)"

    if template_id in ("jv-counterparty", "jv-alpha", "lic-counterparty", "lic-alpha"):
        rows.append(["PPP Factor", None, None, None, None, None, "All USD Assumptions"])  # 8
        formulas["B8"] = "=PPPFactor"
        green_cells.append("B8")
        formulas["C8"] = "=MAX(0,PPPFactor-0.2)"
        formulas["D8"] = "=MAX(0,PPPFactor-0.1)"
        formulas["E8"] = "=MIN(1,PPPFactor+0.1)"
        formulas["F8"] = "=MIN(1,PPPFactor+0.2)"

    if template_id.startswith("lic"):
        next_r = len(rows) + 1
        rows.append(["Timeback License %", None, None, None, None, None,
                      "COGS (licensee) / Revenue (Alpha)"])
        formulas[f"B{next_r}"] = "=TimebackPct"
        green_cells.append(f"B{next_r}")
        formulas[f"C{next_r}"] = "=TimebackPct-0.05"
        formulas[f"D{next_r}"] = "=TimebackPct-0.02"
        formulas[f"E{next_r}"] = "=TimebackPct+0.03"
        formulas[f"F{next_r}"] = "=TimebackPct+0.05"

        next_r2 = len(rows) + 1
        rows.append(["Annual Support Fee", None, None, None, None, None,
                      "COGS (licensee) / Revenue (Alpha)"])
        formulas[f"B{next_r2}"] = "=AnnualSupport"
        green_cells.append(f"B{next_r2}")
        formulas[f"C{next_r2}"] = "=AnnualSupport*0.75"
        formulas[f"D{next_r2}"] = "=AnnualSupport*0.875"
        formulas[f"E{next_r2}"] = "=AnnualSupport*1.125"
        formulas[f"F{next_r2}"] = "=AnnualSupport*1.25"

    num_rows = len(rows)

    cell_formats = [
        {"cells": green_cells, "font_color": GREEN_FONT},
    ]

    return {
        "name": "Sensitivity Analysis",
        "data": rows,
        "formulas": formulas,
        "column_widths": [
            {"column": "A", "width": 28},
            {"column": "B", "width": 16},
            {"column": "C", "width": 14},
            {"column": "D", "width": 14},
            {"column": "E", "width": 14},
            {"column": "F", "width": 14},
            {"column": "G", "width": 30},
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "cell_formats": cell_formats,
        "freeze_panes": "A2",
        "number_formats": [
            {"cells": [f"B3", "C3", "D3", "E3", "F3"], "format": CURRENCY_FMT},
            {"cells": [f"B4", "C4", "D4", "E4", "F4"], "format": NUMBER_FMT},
            {"cells": [f"B5", "C5", "D5", "E5", "F5",
                        f"B7", "C7", "D7", "E7", "F7"], "format": PCT_FMT},
            {"cells": [f"B6", "C6", "D6", "E6", "F6"], "format": RATIO_FMT},
        ],
        "conditional_formatting": [
            {
                "range": f"C3:D{num_rows}",
                "rule_type": "color_scale",
                "start_color": "FFC7CE",
                "end_color": "FFFFFF",
            },
            {
                "range": f"E3:F{num_rows}",
                "rule_type": "color_scale",
                "start_color": "FFFFFF",
                "end_color": "C6EFCE",
            },
        ],
    }


# ---------------------------------------------------------------------------
# US State template builder
# ---------------------------------------------------------------------------

def build_us_state_model(data: dict) -> list[dict]:
    """Build all 8 sheets for the US State template (formula-driven)."""
    us = data.get("us_state", {})
    esa = us.get("esa_amount", 8000)
    avg_tuition = us.get("avg_private_tuition", 13000)
    micro_tuition = min(esa, 8500)
    virtual_tuition = 4000

    # Compute default enrollment
    enrollment_micro = [0] * 11
    enrollment_virtual = [0] * 11
    enrollment_micro[1] = 100
    enrollment_virtual[1] = 500
    for y in range(2, 6):
        enrollment_micro[y] = int(enrollment_micro[y-1] * 2.5)
        enrollment_virtual[y] = int(enrollment_virtual[y-1] * 2.0)
    for y in range(6, 11):
        enrollment_micro[y] = int(enrollment_micro[y-1] * 1.10)
        enrollment_virtual[y] = int(enrollment_virtual[y-1] * 1.10)

    fill_rates = compute_fill_rate_defaults()
    sheets = []

    # --- US Assumptions sheet ---
    # Simplified cell map for US state
    us_rows: list[list] = []
    us_rows.append(["Parameter", "Value", "Source", "Overridable"])  # 1
    us_rows.append([])  # 2
    us_rows.append(["State Info", None, None, None])  # 3
    us_rows.append(["State", data.get("target", {}).get("name", "TBD"), "User input", "No"])  # 4
    us_rows.append(["ESA Amount per Student", esa, "State DOE / EdChoice", "Yes"])  # 5
    us_rows.append(["Students on ESA/Vouchers", us.get("students_on_vouchers", 0), "State DOE", "Yes"])  # 6
    us_rows.append(["Avg Private School Tuition", avg_tuition, "NCES", "Yes"])  # 7
    us_rows.append(["Total Public School Students", us.get("total_public_students", 0), "NCES", "Yes"])  # 8
    us_rows.append([])  # 9
    us_rows.append(["School Types", None, None, None])  # 10
    us_rows.append(["Micro School Tuition", micro_tuition, "At ESA level", "Yes"])  # 11
    us_rows.append(["Virtual (GT School) Tuition", virtual_tuition, "Default", "Yes"])  # 12
    us_rows.append(["Ancillary Revenue per Student", 500, "Default", "Yes"])  # 13
    us_rows.append([])  # 14
    us_rows.append(["Unit Economics", None, None, None])  # 15
    us_rows.append(["Target CAC", 500, "Default <$500", "Yes"])  # 16
    us_rows.append(["Retention (years)", 5, "Default", "Yes"])  # 17
    us_rows.append(["LTV (at ESA tuition)", None, "Calculated", "No"])  # 18
    us_rows.append(["LTV:CAC Ratio", None, "Calculated", "No"])  # 19
    us_rows.append([])  # 20
    us_rows.append(["Cost Structure (% of Tuition)", None, None, None])  # 21
    us_rows.append(["Personnel (Guides)", 0.24, "Default 24%", "Yes"])  # 22
    us_rows.append(["Timeback Platform (Internal COGS)", 0.20, "Non-negotiable 20%", "No"])  # 23
    us_rows.append(["Real Estate", 0.22, "Default 22%", "Yes"])  # 24
    us_rows.append(["Curriculum Delivery", 0.10, "Default 10%", "Yes"])  # 25
    us_rows.append(["Programs & Life Skills", 0.13, "Default 13%", "Yes"])  # 26
    us_rows.append(["Admin, Marketing, G&A", 0.12, "Default 12%", "Yes"])  # 27
    us_rows.append([])  # 28
    us_rows.append(["Valuation & Returns", None, None, None])  # 29
    us_rows.append(["EBITDA Multiple", 16, "12-20x range", "Yes"])  # 30
    us_rows.append(["Discount Rate", 0.12, "10-15% range", "Yes"])  # 31
    us_rows.append([])  # 32
    us_rows.append(["Enrollment Phasing", None, None, None])  # 33
    us_rows.append(["Micro School Enrollment"] + enrollment_micro)  # 34
    us_rows.append(["Virtual Enrollment"] + enrollment_virtual)  # 35
    us_rows.append(["Fill Rate"] + fill_rates)  # 36
    us_rows.append(["Micro School Size", 20, "Default", "Yes"])  # 37
    us_rows.append(["Cost per Micro School Setup", 100_000, "Default $100K", "Yes"])  # 38

    us_formulas = {
        "B18": "=B5*B17",   # LTV = ESA * retention
        "B19": "=IF(B16=0,0,B18/B16)",  # LTV:CAC
    }

    us_overridable = [
        "B5", "B6", "B7", "B8", "B11", "B12", "B13", "B16", "B17",
        "B22", "B24", "B25", "B26", "B27", "B30", "B31", "B37", "B38",
    ]
    # Enrollment and fill rate cells
    for y in range(11):
        c = YEAR_COLS[y]
        us_overridable.extend([f"{c}34", f"{c}35", f"{c}36"])

    sheets.append({
        "name": "Assumptions",
        "data": us_rows,
        "formulas": us_formulas,
        "column_widths": [
            {"column": "A", "width": 35}, {"column": "B", "width": 20},
            {"column": "C", "width": 25}, {"column": "D", "width": 15},
        ] + [{"column": YEAR_COLS[y], "width": 14} for y in range(1, 11)],
        "header_rows": [
            {"row": 1, "format": HEADER_FORMAT},
            {"row": 3, "format": SUBHEADER_FORMAT},
            {"row": 10, "format": SUBHEADER_FORMAT},
            {"row": 15, "format": SUBHEADER_FORMAT},
            {"row": 21, "format": SUBHEADER_FORMAT},
            {"row": 29, "format": SUBHEADER_FORMAT},
            {"row": 33, "format": SUBHEADER_FORMAT},
        ],
        "cell_formats": [
            {"cells": us_overridable, "font_color": BLUE_FONT, "bg_color": YELLOW_BG, "bold": True},
        ],
        "freeze_panes": "B2",
    })

    # --- US P&L ---
    pnl_rows = [[""] + YEAR_LABELS]  # 1
    pnl_rows.append(["REVENUE"] + [None]*11)  # 2
    pnl_rows.append(["Micro School Tuition"] + [None]*11)  # 3
    pnl_rows.append(["Virtual Tuition"] + [None]*11)  # 4
    pnl_rows.append(["Total Tuition Revenue"] + [None]*11)  # 5
    pnl_rows.append(["Ancillary Revenue"] + [None]*11)  # 6
    pnl_rows.append(["Total Revenue"] + [None]*11)  # 7
    pnl_rows.append([])  # 8
    pnl_rows.append(["COGS"] + [None]*11)  # 9
    pnl_rows.append(["Personnel (Guides)"] + [None]*11)  # 10
    pnl_rows.append(["Timeback Platform (Internal COGS)"] + [None]*11)  # 11
    pnl_rows.append(["Real Estate"] + [None]*11)  # 12
    pnl_rows.append(["Curriculum Delivery"] + [None]*11)  # 13
    pnl_rows.append(["Programs & Life Skills"] + [None]*11)  # 14
    pnl_rows.append([])  # 15
    pnl_rows.append(["OPEX"] + [None]*11)  # 16
    pnl_rows.append(["Admin, Marketing, G&A"] + [None]*11)  # 17
    pnl_rows.append([])  # 18
    pnl_rows.append(["Total Costs"] + [None]*11)  # 19
    pnl_rows.append(["EBITDA"] + [None]*11)  # 20
    pnl_rows.append(["EBITDA Margin"] + [None]*11)  # 21

    pnl_formulas = {}
    pnl_green = []
    for y in range(11):
        c = yr(y)
        # Effective students
        eff_micro = f"('Assumptions'!{c}34*'Assumptions'!{c}36)"
        eff_virtual = f"('Assumptions'!{c}35*'Assumptions'!{c}36)"
        eff_total = f"({eff_micro}+{eff_virtual})"

        pnl_formulas[f"{c}3"] = f"={eff_micro}*'Assumptions'!$B$11"
        pnl_green.append(f"{c}3")
        pnl_formulas[f"{c}4"] = f"={eff_virtual}*'Assumptions'!$B$12"
        pnl_green.append(f"{c}4")
        pnl_formulas[f"{c}5"] = f"={c}3+{c}4"
        pnl_formulas[f"{c}6"] = f"={eff_total}*'Assumptions'!$B$13"
        pnl_green.append(f"{c}6")
        pnl_formulas[f"{c}7"] = f"={c}5+{c}6"

        pnl_formulas[f"{c}10"] = f"={c}5*'Assumptions'!$B$22"
        pnl_formulas[f"{c}11"] = f"={c}5*'Assumptions'!$B$23"
        pnl_formulas[f"{c}12"] = f"={c}5*'Assumptions'!$B$24"
        pnl_formulas[f"{c}13"] = f"={c}5*'Assumptions'!$B$25"
        pnl_formulas[f"{c}14"] = f"={c}5*'Assumptions'!$B$26"
        pnl_formulas[f"{c}17"] = f"={c}5*'Assumptions'!$B$27"

        pnl_formulas[f"{c}19"] = f"=SUM({c}10:{c}14)+{c}17"
        pnl_formulas[f"{c}20"] = f"={c}7-{c}19"
        pnl_formulas[f"{c}21"] = f"=IF({c}7=0,0,{c}20/{c}7)"

    sheets.append({
        "name": "P&L Projection",
        "data": pnl_rows,
        "formulas": pnl_formulas,
        "column_widths": [{"column": "A", "width": 35}] + [
            {"column": yr(i), "width": 15} for i in range(11)
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [
            {"ranges": ["B2:L19"], "format": CURRENCY_FMT},
            {"ranges": ["B21:L21"], "format": PCT_FMT},
        ],
        "cell_formats": [
            {"cells": pnl_green, "font_color": GREEN_FONT},
            {"cells": [f"{yr(y)}7" for y in range(11)], "bold": True, "bg_color": LIGHT_GRAY_BG},
            {"cells": [f"{yr(y)}20" for y in range(11)], "bold": True, "bg_color": OUTPUT_BG},
        ],
        "freeze_panes": "B2",
    })

    # --- US Student Rollout ---
    sr_rows = [[""] + YEAR_LABELS]  # 1
    sr_rows.append(["Micro School Students"] + [None]*11)  # 2
    sr_rows.append(["Virtual Students"] + [None]*11)  # 3
    sr_rows.append(["Total Enrollment"] + [None]*11)  # 4
    sr_rows.append(["Fill Rate"] + [None]*11)  # 5
    sr_rows.append(["Effective Micro"] + [None]*11)  # 6
    sr_rows.append(["Effective Virtual"] + [None]*11)  # 7
    sr_rows.append(["Effective Total"] + [None]*11)  # 8
    sr_rows.append([])  # 9
    sr_rows.append(["Micro Schools Open"] + [None]*11)  # 10

    sr_formulas = {}
    sr_green = []
    for y in range(11):
        c = yr(y)
        sr_formulas[f"{c}2"] = f"='Assumptions'!{c}34"
        sr_green.append(f"{c}2")
        sr_formulas[f"{c}3"] = f"='Assumptions'!{c}35"
        sr_green.append(f"{c}3")
        sr_formulas[f"{c}4"] = f"={c}2+{c}3"
        sr_formulas[f"{c}5"] = f"='Assumptions'!{c}36"
        sr_green.append(f"{c}5")
        sr_formulas[f"{c}6"] = f"={c}2*{c}5"
        sr_formulas[f"{c}7"] = f"={c}3*{c}5"
        sr_formulas[f"{c}8"] = f"={c}6+{c}7"
        sr_formulas[f"{c}10"] = f"=IF({c}6=0,0,CEILING({c}6/'Assumptions'!$B$37,1))"

    sheets.append({
        "name": "Student Rollout",
        "data": sr_rows,
        "formulas": sr_formulas,
        "column_widths": [{"column": "A", "width": 25}] + [
            {"column": yr(i), "width": 14} for i in range(11)
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [
            {"ranges": ["B2:L4", "B6:L8", "B10:L10"], "format": NUMBER_FMT},
            {"ranges": ["B5:L5"], "format": PCT_FMT},
        ],
        "cell_formats": [{"cells": sr_green, "font_color": GREEN_FONT}],
        "freeze_panes": "B2",
    })

    # --- US Unit Economics ---
    ue_rows = [
        ["Per-Student (Micro School)", "Amount", "% of Tuition"],  # 1
        [],  # 2
        ["Tuition", None, None],  # 3
        ["Ancillary", None, None],  # 4
        ["Total Revenue", None, None],  # 5
        [],  # 6
        ["Personnel", None, None],  # 7
        ["Timeback (Internal COGS)", None, None],  # 8
        ["Real Estate", None, None],  # 9
        ["Curriculum", None, None],  # 10
        ["Programs", None, None],  # 11
        ["Admin/G&A", None, None],  # 12
        ["Total Costs", None, None],  # 13
        ["Contribution Margin", None, None],  # 14
        [],  # 15
        ["CAC", None, None],  # 16
        ["LTV (5yr)", None, None],  # 17
        ["LTV:CAC", None, None],  # 18
    ]
    ue_formulas = {
        "B3": "='Assumptions'!$B$11",
        "C3": "=1",
        "B4": "='Assumptions'!$B$13",
        "C4": "=B4/B3",
        "B5": "=B3+B4",
        "C5": "=B5/B3",
        "B7": "=B3*'Assumptions'!$B$22",
        "C7": "='Assumptions'!$B$22",
        "B8": "=B3*'Assumptions'!$B$23",
        "C8": "='Assumptions'!$B$23",
        "B9": "=B3*'Assumptions'!$B$24",
        "C9": "='Assumptions'!$B$24",
        "B10": "=B3*'Assumptions'!$B$25",
        "C10": "='Assumptions'!$B$25",
        "B11": "=B3*'Assumptions'!$B$26",
        "C11": "='Assumptions'!$B$26",
        "B12": "=B3*'Assumptions'!$B$27",
        "C12": "='Assumptions'!$B$27",
        "B13": "=SUM(B7:B12)",
        "C13": "=B13/B3",
        "B14": "=B5-B13",
        "C14": "=B14/B3",
        "B16": "='Assumptions'!$B$16",
        "B17": "='Assumptions'!$B$18",
        "B18": "=IF(B16=0,0,B17/B16)",
    }

    sheets.append({
        "name": "Unit Economics",
        "data": ue_rows,
        "formulas": ue_formulas,
        "column_widths": [{"column": "A", "width": 30}, {"column": "B", "width": 18}, {"column": "C", "width": 15}],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [
            {"ranges": ["B3:B18"], "format": CURRENCY_FMT},
            {"ranges": ["C3:C14"], "format": PCT_FMT},
            {"cells": ["B18"], "format": RATIO_FMT},
        ],
        "cell_formats": [
            {"cells": ["B3", "B4", "B16", "B17"], "font_color": GREEN_FONT},
            {"cells": ["B13", "B14"], "bold": True, "bg_color": OUTPUT_BG},
        ],
        "freeze_panes": "A2",
    })

    # --- US Capital Deployment ---
    cap_rows = [[""] + YEAR_LABELS]  # 1
    cap_rows.append(["Micro School Buildout"] + [None]*11)  # 2
    cap_rows.append(["Marketing / CAC Budget"] + [None]*11)  # 3
    cap_rows.append(["Working Capital"] + [None]*11)  # 4
    cap_rows.append([])  # 5
    cap_rows.append(["Total Capital per Year"] + [None]*11)  # 6
    cap_rows.append(["Cumulative Capital"] + [None]*11)  # 7

    cap_formulas = {}
    cap_green = []
    for y in range(11):
        c = yr(y)
        # Micro schools * setup cost
        cap_formulas[f"{c}2"] = f"='Student Rollout'!{c}10*'Assumptions'!$B$38"
        cap_green.append(f"{c}2")
        # CAC budget = total effective * CAC
        cap_formulas[f"{c}3"] = f"='Student Rollout'!{c}8*'Assumptions'!$B$16"
        cap_green.append(f"{c}3")
        # Working capital: $1M Y0, $500K Y1
        if y == 0:
            cap_formulas[f"{c}4"] = "=1000000"
        elif y == 1:
            cap_formulas[f"{c}4"] = "=500000"
        else:
            cap_formulas[f"{c}4"] = "=0"
        cap_formulas[f"{c}6"] = f"=SUM({c}2:{c}4)"
        cap_formulas[f"{c}7"] = f"=SUM($B$6:{c}6)"

    sheets.append({
        "name": "Capital Deployment",
        "data": cap_rows,
        "formulas": cap_formulas,
        "column_widths": [{"column": "A", "width": 30}] + [
            {"column": yr(i), "width": 16} for i in range(11)
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [{"ranges": ["B2:L7"], "format": CURRENCY_FMT}],
        "cell_formats": [{"cells": cap_green, "font_color": GREEN_FONT}],
        "freeze_panes": "B2",
    })

    # --- US Cash Flow ---
    cf_rows = [[""] + YEAR_LABELS]  # 1
    cf_rows.append(["EBITDA"] + [None]*11)  # 2
    cf_rows.append(["Capital Expenditures"] + [None]*11)  # 3
    cf_rows.append(["Free Cash Flow"] + [None]*11)  # 4
    cf_rows.append([])  # 5
    cf_rows.append(["Cumulative Cash Flow"] + [None]*11)  # 6
    cf_rows.append(["Payback Period", None] + [None]*10)  # 7

    cf_formulas = {}
    cf_green = []
    for y in range(11):
        c = yr(y)
        cf_formulas[f"{c}2"] = f"='P&L Projection'!{c}20"
        cf_green.append(f"{c}2")
        cf_formulas[f"{c}3"] = f"=-'Capital Deployment'!{c}6"
        cf_green.append(f"{c}3")
        cf_formulas[f"{c}4"] = f"={c}2+{c}3"
        cf_formulas[f"{c}6"] = f"=SUM($B$4:{c}4)"
    cf_formulas["B7"] = '=IFERROR(INDEX(B1:L1,MATCH(TRUE,B6:L6>0,0)),"N/A")'

    sheets.append({
        "name": "Cash Flow",
        "data": cf_rows,
        "formulas": cf_formulas,
        "column_widths": [{"column": "A", "width": 30}] + [
            {"column": yr(i), "width": 16} for i in range(11)
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [{"ranges": ["B2:L6"], "format": CURRENCY_FMT}],
        "cell_formats": [{"cells": cf_green, "font_color": GREEN_FONT}],
        "freeze_panes": "B2",
        "conditional_formatting": [
            {"range": "B4:L4", "rule_type": "cell_is", "operator": "lessThan",
             "formula": ["0"], "font_color": "FF0000", "bg_color": "FFC7CE"},
            {"range": "B4:L4", "rule_type": "cell_is", "operator": "greaterThan",
             "formula": ["0"], "font_color": "006100", "bg_color": "C6EFCE"},
        ],
    })

    # --- US Returns ---
    ret_rows = [
        ["Returns Analysis", "Value"],  # 1
        [],  # 2
        ["Year 5 EBITDA", None],  # 3
        ["Year 10 EBITDA", None],  # 4
        ["Exit Multiple", None],  # 5
        ["Enterprise Value at Exit", None],  # 6
        [],  # 7
        ["Total Capital Invested (Y0-5)", None],  # 8
        ["MOIC", None],  # 9
        ["IRR", None],  # 10
        ["NPV", None],  # 11
    ]
    ret_formulas = {
        "B3": "='P&L Projection'!G20",
        "B4": "='P&L Projection'!L20",
        "B5": "='Assumptions'!$B$30",
        "B6": "=B4*B5",
        "B8": "='Capital Deployment'!L7",
        "B9": "=IF(B8=0,0,B6/B8)",
        "B10": "=IFERROR(IRR('Cash Flow'!B4:L4),\"N/A\")",
        "B11": "=IFERROR(NPV('Assumptions'!$B$31,'Cash Flow'!C4:L4)+'Cash Flow'!B4,\"N/A\")",
    }

    sheets.append({
        "name": "Returns Analysis",
        "data": ret_rows,
        "formulas": ret_formulas,
        "column_widths": [{"column": "A", "width": 35}, {"column": "B", "width": 25}],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "number_formats": [
            {"cells": ["B3", "B4", "B6", "B8", "B11"], "format": CURRENCY_FMT},
            {"cells": ["B9"], "format": RATIO_FMT},
            {"cells": ["B10"], "format": PCT_FMT},
        ],
        "cell_formats": [
            {"cells": ["B3", "B4", "B5", "B8"], "font_color": GREEN_FONT},
            {"cells": ["B6", "B9", "B10"], "bold": True, "bg_color": OUTPUT_BG},
        ],
    })

    # --- US Sensitivity ---
    sens_rows = [
        ["Variable", "Base", "-20%", "+20%", "Impact On"],  # 1
        ["Tuition (Micro)", None, None, None, "Revenue, EBITDA"],  # 2
        ["Enrollment", None, None, None, "Revenue, Schools, CapEx"],  # 3
        ["ESA Amount", None, None, None, "Revenue Floor"],  # 4
        ["CAC", None, None, None, "Marketing Budget, LTV:CAC"],  # 5
        ["Fill Rate", None, None, None, "Revenue Ramp"],  # 6
    ]
    sens_formulas = {
        "B2": "='Assumptions'!$B$11",
        "C2": "=B2*0.8", "D2": "=B2*1.2",
        "B3": f"='Assumptions'!G34+'Assumptions'!G35",  # Y5 total
        "C3": "=B3*0.7", "D3": "=B3*1.3",
        "B4": "='Assumptions'!$B$5",
        "C4": "=B4*0.8", "D4": "=B4*1.2",
        "B5": "='Assumptions'!$B$16",
        "C5": "=B5*0.8", "D5": "=B5*1.2",
        "B6": "='Assumptions'!L36",
        "C6": "=MAX(0,B6-0.15)", "D6": "=MIN(1,B6+0.05)",
    }

    sheets.append({
        "name": "Sensitivity Analysis",
        "data": sens_rows,
        "formulas": sens_formulas,
        "column_widths": [
            {"column": "A", "width": 25}, {"column": "B", "width": 15},
            {"column": "C", "width": 15}, {"column": "D", "width": 15},
            {"column": "E", "width": 30},
        ],
        "header_rows": [{"row": 1, "format": HEADER_FORMAT}],
        "cell_formats": [
            {"cells": ["B2", "B3", "B4", "B5", "B6"], "font_color": GREEN_FONT},
        ],
        "number_formats": [
            {"cells": ["B2", "C2", "D2", "B4", "C4", "D4", "B5", "C5", "D5"], "format": CURRENCY_FMT},
            {"cells": ["B3", "C3", "D3"], "format": NUMBER_FMT},
            {"cells": ["B6", "C6", "D6"], "format": PCT_FMT},
        ],
    })

    return sheets


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def build_model(data: dict, template_id: str, premium_schools: bool = False) -> dict:
    """Build a complete spreadsheet spec for one template."""
    target_name = data.get("target", {}).get("name", "unknown").replace(" ", "_").lower()

    if template_id == "us-state":
        sheets = build_us_state_model(data)
        return {
            "metadata": {
                "title": f"Financial Model — {data.get('target', {}).get('name', 'US State')} — Owner-Operator",
                "creator": "EduPitch / Alpha Holdings",
                "description": f"US State financial model for {data.get('target', {}).get('name', 'US State')}",
            },
            "sheets": sheets,
            "named_ranges": [],
        }

    tier = classify_tier(data)
    scaling = compute_scaling(data, tier)
    enrollment = compute_enrollment_defaults(scaling)
    fill_rates = compute_fill_rate_defaults()

    # Validate business rules
    errors = validate_business_rules(template_id, scaling)
    if errors:
        print("BUSINESS RULE VIOLATIONS:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)

    # Build 8 sheets
    sheets = [
        build_assumptions_sheet(template_id, scaling, data, enrollment, fill_rates),
        build_pnl_sheet(template_id, data),
        build_student_rollout_sheet(template_id),
        build_unit_economics_sheet(template_id),
        build_capital_deployment_sheet(template_id),
        build_cashflow_sheet(template_id),
        build_returns_sheet(template_id),
        build_sensitivity_sheet(template_id, scaling),
    ]

    perspective_labels = {
        "jv-counterparty": "JV — Counterparty View",
        "jv-alpha": "JV — Alpha Internal",
        "lic-counterparty": "Licensing — Counterparty View",
        "lic-alpha": "Licensing — Alpha Internal",
    }

    # Build named ranges list
    named_ranges_list = [
        {"name": name, "value": ref}
        for name, ref in NAMED_RANGES.items()
    ]

    return {
        "metadata": {
            "title": f"Financial Model — {data.get('target', {}).get('name', 'Country')} — {perspective_labels.get(template_id, template_id)}",
            "creator": "EduPitch / Alpha Holdings",
            "description": f"Tier {tier} {template_id} financial model (formula-driven)",
        },
        "sheets": sheets,
        "named_ranges": named_ranges_list,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Build financial model JSON specs for spreadsheet generation",
    )
    parser.add_argument("--input", required=True, help="Research data JSON file")
    parser.add_argument("--templates", help="Comma-separated template IDs (or 'auto')")
    parser.add_argument("--auto", action="store_true", help="Auto-select templates from tier")
    parser.add_argument("--output-dir", default="outputs", help="Output directory for spec JSON files")
    parser.add_argument("--premium-schools", action="store_true", help="Include Alpha Premium Schools add-on (Tier 1)")

    args = parser.parse_args()

    data = json.loads(Path(args.input).read_text())
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Determine templates
    if args.auto or not args.templates:
        if is_us_state(data):
            template_ids = ["us-state"]
        else:
            tier = classify_tier(data)
            if tier == 1:
                template_ids = ["jv-counterparty", "jv-alpha"]
            elif tier == 3:
                template_ids = ["lic-counterparty", "lic-alpha"]
            else:
                template_ids = ["jv-counterparty", "jv-alpha"]
            print(f"Auto-selected tier {tier}: {', '.join(template_ids)}")
    else:
        template_ids = [t.strip() for t in args.templates.split(",")]

    for tid in template_ids:
        if tid not in VALID_TEMPLATES:
            print(f"Unknown template: {tid}. Valid: {VALID_TEMPLATES}", file=sys.stderr)
            sys.exit(1)

    target_name = data.get("target", {}).get("name", "unknown").replace(" ", "_").lower()

    for tid in template_ids:
        print(f"\nBuilding {tid}...")
        spec = build_model(data, tid, premium_schools=args.premium_schools)

        outfile = output_dir / f"{target_name}_{tid.replace('-', '_')}_spec.json"
        outfile.write_text(json.dumps(spec, indent=2))
        print(f"  Written: {outfile}")
        print(f"  Sheets: {len(spec['sheets'])}")
        for s in spec["sheets"]:
            rows = len(s.get("data", []))
            formulas_count = len(s.get("formulas", {}))
            cell_fmts = sum(len(cf.get("cells", [])) + len(cf.get("ranges", []))
                           for cf in s.get("cell_formats", []))
            print(f"    - {s['name']}: {rows} rows, {formulas_count} formulas, {cell_fmts} styled cells")

    print(f"\nDone. {len(template_ids)} spec(s) written to {output_dir}/")
    print("Next: generate XLSX with do:generate-xlsx")


if __name__ == "__main__":
    main()
