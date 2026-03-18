# Portal Mode — Financial Proposal Rules, Assumptions & Calculations
## Complete Reference for Verification

**Generated:** March 16, 2026  
**Scope:** Express Pipeline ("Portal" mode) — Head of State inputs only a country name or US state name  
**Source files:** `backend/agents/financial.py`, `backend/agents/strategy.py`, `backend/agents/term_sheet.py`, `backend/config/rules/*.yaml`, `backend/graph/express_pipeline.py`, `backend/models/schemas.py`

---

## Table of Contents

1. [Pipeline Overview](#1-pipeline-overview)
2. [Target Classification (Country vs US State, Tier 1/2/3)](#2-target-classification)
3. [Data Sources (Where Numbers Come From)](#3-data-sources)
4. [Core Scaling Formulas](#4-core-scaling-formulas)
5. [Non-Negotiable Business Rules](#5-non-negotiable-business-rules)
6. [Financial Assumptions — Tier 1 / US State (Full Model)](#6-financial-assumptions--tier-1--us-state)
7. [Financial Assumptions — Tier 2/3 (Cohort Model)](#7-financial-assumptions--tier-23-cohort-model)
8. [P&L Projection Calculations (Year-by-Year)](#8-pl-projection-calculations)
9. [Upfront Ask Breakdown](#9-upfront-ask-breakdown)
10. [Unit Economics Calculations](#10-unit-economics-calculations)
11. [Capital Deployment Calculations](#11-capital-deployment-calculations)
12. [Returns Analysis Calculations](#12-returns-analysis-calculations)
13. [Sensitivity Analysis](#13-sensitivity-analysis)
14. [Term Sheet Deal Parameters](#14-term-sheet-deal-parameters)
15. [US State-Specific Rules (ESA/Voucher)](#15-us-state-specific-rules)
16. [Strategy Agent Rules (Feed into Financial Model)](#16-strategy-agent-rules)
17. [Document Generation Rules (How Financial Data Appears in Output)](#17-document-generation-rules)
18. [Complete Line Item Reference Table](#18-complete-line-item-reference-table)

---

## 1. Pipeline Overview

In **portal mode** (`express_pipeline.py`), the system runs end-to-end with **zero human inputs** beyond the country/state name:

```
Country/State Name
    → Step 1: Country Research (Perplexity + World Bank API + Spending Spotlight)
    → Step 2: Education Research (Perplexity + LLM synthesis)
    → Step 3: Strategy Development (LLM with rules constraints)
    → Step 4: Financial Model (generate_assumptions → build_model)
    → Step 5: Document Generation (term sheet + deck + memorandum + XLSX)
    → Step 6: PDF Conversion
```

**Key insight:** All financial assumptions are auto-generated from the country/education research data using deterministic rules. The user does NOT adjust any sliders in portal mode.

---

## 2. Target Classification

### 2.1 Country vs US State Detection
- **Source:** `country_research.py` → `_detect_target_type()`
- **Rule:** If the input matches any of the 50 US states + DC (case-insensitive), it is classified as `us_state`. Otherwise, it is `sovereign_nation`.

### 2.2 Tier Classification for Sovereign Nations
- **Source:** `config/rules/country_tiers.yaml` + `rules_loader.py` → `classify_tier()`
- **Method:**
  1. **First:** Check if the country is explicitly listed in `country_tiers.yaml`
  2. **Fallback:** Use GDP-per-capita thresholds

| Tier | Name | GDP/Capita Threshold | Examples | Model Type |
|------|------|---------------------|----------|------------|
| **Tier 1** | UAE-Scale | ≥ $30,000 | Saudi Arabia, Qatar, Singapore, Switzerland | Full JV Model |
| **Tier 2** | Mid-Market | $10,000 – $29,999 (or pop > 50M with private school market) | Brazil, Mexico, UK, South Korea | Cohort-Based Model |
| **Tier 3** | Emerging | < $10,000 | India, Nigeria, Kenya | Cohort-Based Model |

### 2.3 Tier-Specific Deal Structure Defaults

| Parameter | Tier 1 | Tier 2 | Tier 3 |
|-----------|--------|--------|--------|
| **Model** | Full JV | Scaled JV or licensing | Licensing / govt partnership |
| **Upfront range** | $500M – $1.5B | $100M – $500M | $25M – $100M |
| **Per-student budget** | $20K – $30K | $8K – $20K | License fee: $50 – $200/yr |
| **5yr student target** | 50K – 200K | 20K – 100K | 100K – 1M |
| **Demand factor** | 1.0 | 0.5 | 0.2 |
| **Fixed dev costs (3 items)** | $250M × 3 = $750M | $150M × 3 = $450M | $100M × 3 = $300M |

### 2.4 US States
- US states are **NOT** tiered. They use the Tier 1 full model with US-specific overrides (ESA data, different pricing).
- **No upfront government payment, no JV, no billion-dollar asks.**

---

## 3. Data Sources

### 3.1 Real-Time Research Data
| Source | What It Provides | Used For |
|--------|-----------------|----------|
| **Perplexity Sonar Deep Research** | Live web research on the country/state | Education system, political context, regulatory, competitive landscape, reform initiatives |
| **World Bank Open Data API** | Structured economic indicators | GDP, GDP/capita, population, urbanization, Gini, inflation, literacy, education spend % GDP, pupil-teacher ratio |

### 3.2 World Bank Indicators Used
| Indicator | API Code | Role in Model |
|-----------|----------|---------------|
| GDP | `NY.GDP.MKTP.CD` | Context for deal sizing |
| GDP per Capita | `NY.GDP.PCAP.CD` | **PPP factor calculation** (critical) |
| GDP Growth | `NY.GDP.MKTP.KD.ZG` | Context |
| Total Population | `SP.POP.TOTL` | Market sizing |
| Population 0-14 | `SP.POP.0014.TO` | **School-age population** → student target floor |
| Population Growth | `SP.POP.GROW` | Context |
| Urbanization | `SP.URB.TOTL.IN.ZS` | Context |
| Gini Index | `SI.POV.GINI` | Income distribution context |
| Inflation | `FP.CPI.TOTL.ZG` | Context |
| Literacy Rate | `SE.ADT.LITR.ZS` | Context |
| Education Spend % GDP | `SE.XPD.TOTL.GD.ZS` | Reform appetite context |
| Pupil-Teacher Ratio | `SE.PRM.ENRL.TC.ZS` | Teacher workforce sizing |

### 3.3 Static Configuration Data
| Source File | What It Contains |
|-------------|-----------------|
| `business_rules.yaml` | Non-negotiable fee floors, IP ownership rules, three commitments |
| `country_tiers.yaml` | Tier 1/2/3 classification criteria & deal structure defaults |
| `scaling_formulas.yaml` | PPP formula, upfront ask formula, student target formula |
| `us_state_rules.yaml` | ESA amounts, school types, priority states, revenue model |
| `k12_spending_spotlight.yaml` | Per-pupil spending, enrollment, teacher salaries, NAEP scores for all 50 states + DC |
| `proposal_structure.yaml` | Required sections and slides in output documents |

### 3.4 K-12 Spending Spotlight (US States Only)
- **Source:** Reason Foundation, 2002–2023, NCES F-33 data
- Provides per-state: per-pupil spending, K-12 enrollment, avg teacher salary, student-teacher ratio, revenue per pupil, instructional spending %, benefit spending per pupil, NAEP proficiency scores, enrollment trends
- **Used in:** Country research report context for US states, backfills `education.k12_enrolled`, `education.avg_public_spend_per_student`, `education.student_teacher_ratio`, `education.teacher_count`

### 3.5 LLM Synthesis
- After Perplexity + World Bank data gathering, an LLM call synthesizes the data into a structured `CountryProfile` object
- Fields like `avg_private_tuition`, `k12_enrolled`, `head_of_state`, `credit_rating`, `sovereign_wealth_fund` etc. come from LLM extraction of the research text
- The LLM is prompted to provide specific numbers and estimates where data is unavailable

---

## 4. Core Scaling Formulas

### 4.1 PPP Factor
```
PPP_Factor = min(1.0, GDP_per_capita / $30,000)
```
- **Source:** `scaling_formulas.yaml` + `financial.py` line 42
- **Purpose:** Adjusts all dollar amounts for purchasing power parity
- **Reference GDP:** $30,000 (UAE benchmark)
- **Range:** 0.0 to 1.0
- **If GDP/capita is unavailable:** Defaults to $30,000 → PPP factor = 1.0
- **Examples:**
  - UAE ($44K/capita): PPP = 1.0
  - Brazil ($9K/capita): PPP = 0.30
  - India ($2.5K/capita): PPP = 0.083

### 4.2 Per-Student Budget
```
Per_Student_Budget = max($5,000, min($30,000, avg_private_tuition × 0.8))
```
- **Source:** `scaling_formulas.yaml` + `financial.py` line 46
- **Floor:** $5,000
- **Ceiling:** $30,000
- **Tuition multiplier:** 0.80 (80% of average private school tuition)
- **Rounding:** Rounded to nearest $500
- **If avg_private_tuition unavailable:** Defaults to `$25,000 × PPP_Factor`

### 4.3 Year 5 Student Target
```
Target_Students_Y5 = max(5,000, school_age_population × 0.10)
```
- **Source:** `scaling_formulas.yaml` + `financial.py` line 74-79
- **Minimum floor:** 5,000 students
- **Market penetration rate:** 10% of school-age population
- **School-age population source:** `population_0_18` → fallback `k12_enrolled` → fallback 500,000
- **Strategy override:** If the Strategy agent suggests a Y5 target, the higher of (strategy suggestion, 10% floor) is used
- **Enforced in BOTH:** Strategy agent and Financial agent

### 4.4 Upfront Ask Formula
```
Total_Upfront = AlphaCore_License + App_Content_RD + LifeSkills_RD
                + (Students_Y5 × Per_Student_Budget × 0.10)  [Mgmt Fee]
                + (Students_Y5 × Per_Student_Budget × 0.20)  [Timeback Fee]
```
- **Source:** `scaling_formulas.yaml` + `financial.py` lines 213-218
- **Floor:** $25M minimum
- **Fixed development costs vary by tier** (see table above)

---

## 5. Non-Negotiable Business Rules

**Source:** `business_rules.yaml`

These rules are **ALWAYS** enforced and cannot be overridden:

| Rule | Value | Description |
|------|-------|-------------|
| **Management Fee Floor** | 10% of per-student budget | Non-negotiable. Locked in assumptions editor. |
| **Timeback License Fee Floor** | 20% of per-student budget | Non-negotiable. Locked in assumptions editor. |
| **Minimum Upfront IP Fee** | $25,000,000 | Floor for total upfront ask |
| **Mgmt Fee Prepayment** | Minimum 2 years | Prepaid before Alpha begins operations |
| **Minimum School Types** | 2 | Every proposal offers ≥ 2 school types |
| **Guide School Timeline** | 12 months | Local Guide School established within first year |
| **IP Ownership** | Alpha ALWAYS retains | Timeback, AlphaCore, Guide School, Incept eduLLM |
| **Local IP Layer** | 100% local entity owned | National identity, cultural values, local curriculum |
| **Local Partner Funds** | Real estate, marketing, enrollment infra | Counterparty responsibility |
| **Alpha Ownership** | 0% equity (for sovereign deals) | Alpha operates & licenses; local entity owns 100% |
| **Three Commitments** | Always included | (1) Love school, (2) Learn 2x faster, (3) Life skills for AI age |

---

## 6. Financial Assumptions — Tier 1 / US State (Full Model)

**Source:** `financial.py` → `generate_assumptions()`

### 6.1 Pricing Category

| Assumption Key | Label | Default Calculation | Min | Max | Step | Unit |
|----------------|-------|-------------------|-----|-----|------|------|
| `premium_tuition` | Premium Tier Tuition | `max($15,000, round(per_student_budget × 1.2 / 500) × 500)` | $15,000 | $50,000 | $500 | $ |
| `mid_tuition` | Mid-Tier Tuition | `max($12,000, round(per_student_budget × 0.8 / 500) × 500)` | $10,000 | $35,000 | $500 | $ |
| `per_student_budget` | Per-Student Delivery Budget | `max($5K, min($30K, avg_private_tuition × 0.8))` | $5,000 | $30,000 | $500 | $ |

**US State Override (when ESA data available):**
| Assumption Key | Override Value |
|----------------|---------------|
| `per_student_budget` | `max(ESA_amount, $18,000)` |
| `premium_tuition` | `max($25,000, ESA_amount × 3)` |
| `mid_tuition` | `max($15,000, ESA_amount × 2)` |

**US State Fallback (no ESA data):**
| Assumption Key | Value |
|----------------|-------|
| `per_student_budget` | $18,000 |
| `premium_tuition` | $25,000 |
| `mid_tuition` | $15,000 |

### 6.2 Scale Category

| Assumption Key | Label | Default Calculation | Min | Max | Step |
|----------------|-------|-------------------|-----|-----|------|
| `students_year1` | Year 1 Students | `min(5,000, target_Y5 ÷ 10)` | 500 | 20,000 | 500 |
| `students_year2` | Year 2 Students | `min(15,000, target_Y5 ÷ 5)` | 2,000 | 50,000 | 1,000 |
| `students_year3` | Year 3 Students | `min(50,000, target_Y5 × 2 ÷ 5)` | 5,000 | 100,000 | 5,000 |
| `students_year4` | Year 4 Students | `min(100,000, target_Y5 × 3 ÷ 5)` | 10,000 | 200,000 | 5,000 |
| `students_year5` | Year 5 Students | `target_Y5` (from strategy, ≥ 10% of school-age pop) | max(20K, 10% floor) | max(500K, 5× floor) | 10,000 |
| `avg_students_per_school` | Avg Students per School | 800 (hardcoded) | 200 | 2,000 | 50 |

**Student Ramp Pattern (fraction of Y5 target):**
| Year | Fraction of Y5 Target |
|------|-----------------------|
| Y1 | ~10% (`÷ 10`) |
| Y2 | ~20% (`÷ 5`) |
| Y3 | ~40% (`× 2 ÷ 5`) |
| Y4 | ~60% (`× 3 ÷ 5`) |
| Y5 | 100% |

### 6.3 Costs Category

| Assumption Key | Label | Default Value | Min | Max | Step | Notes |
|----------------|-------|--------------|-----|-----|------|-------|
| `cogs_pct` | COGS (% of Revenue) | 55% | 40% | 75% | 1% | Direct costs: teacher salaries, facilities, technology |
| `opex_pct` | OpEx (% of Revenue) | 20% | 10% | 35% | 1% | G&A, marketing, central management overhead |
| `capex_per_school` | CapEx per New School | `round($5,000,000 × PPP_Factor / $100,000) × $100,000` | $1,000,000 | $20,000,000 | $500,000 | PPP-adjusted from $5M base |

### 6.4 Fees Category (Alpha Revenue)

| Assumption Key | Label | Default | Locked? | Notes |
|----------------|-------|---------|---------|-------|
| `management_fee_pct` | Management Fee (% of School Revenue) | 10% | **YES** | Non-negotiable floor |
| `timeback_license_pct` | Timeback License (% of Per-Student Budget) | 20% | **YES** | Non-negotiable floor |
| `upfront_alphacore_license` | AlphaCore License | $250M | No | Paid to Alpha Holdings |
| `upfront_mgmt_fee` | Upfront Management Fee | `max($1M, round(target_Y5 × per_student × 0.10 / $1M))` $M | No | Paid to Alpha Holdings |
| `upfront_timeback_fee` | Upfront Timeback Fee | `max($1M, round(target_Y5 × per_student × 0.20 / $1M))` $M | No | Paid to Alpha Holdings |
| `upfront_app_content_rd` | Country-Specific App Content R&D | $250M | No | Local expense (owned by local entity) |
| `upfront_lifeskills_rd` | Country-Specific LifeSkills R&D | $250M | No | Local expense (owned by local entity) |
| `upfront_ip_fee` | Total Upfront Ask | Sum of above 5 components | No | Minimum $25M |
| `guide_school_fee` | Guide School Training Fee (per teacher) | `round($15,000 × PPP_Factor / $1,000) × $1,000` | No | — |

### 6.5 Returns Category

| Assumption Key | Label | Default | Min | Max | Step |
|----------------|-------|---------|-----|-----|------|
| `exit_ebitda_multiple` | Exit EBITDA Multiple | 15x | 8x | 25x | 1x |
| `discount_rate` | Discount Rate | 12% | 8% | 20% | 1% |
| `tax_rate` | Tax Rate | 20% | 0% | 35% | 1% |

---

## 7. Financial Assumptions — Tier 2/3 (Cohort Model)

**Source:** `financial.py` → `_generate_cohort_assumptions()`

The Tier 2/3 model is fundamentally different — it asks: **"How many 25,000-student cohorts can the government/private sector support?"**

### 7.1 Cohort-Specific Assumptions

| Assumption Key | Label | Tier 2 Default | Tier 3 Default | Notes |
|----------------|-------|---------------|---------------|-------|
| `num_cohorts` | Number of 25K Cohorts | 2 | 1 | UAE = 8 cohorts |
| `cohort_size` | Students per Cohort | 25,000 | 25,000 | **Locked** |
| `per_student_budget` | Per-Student Budget (PPP-adj) | `max($5K, base_per_student)` | Same | PPP factor applied |
| `cohort_ramp_years` | Years to Full Deployment | 3 | 3 | Linear ramp |
| `management_fee_pct` | Management Fee | 10% | 10% | **Locked** |
| `timeback_license_pct` | Timeback License | 20% | 20% | **Locked** |
| `cogs_pct` | COGS | 55% | 55% | — |
| `opex_pct` | OpEx | 22% | 22% | Slightly higher than T1 |
| `avg_students_per_school` | Students per School | 800 | 800 | — |
| `capex_per_school` | CapEx per School | `round($4M × PPP / $100K) × $100K` | Same | Lower base ($4M vs $5M) |
| `exit_ebitda_multiple` | Exit Multiple | 12x | 12x | Lower than T1 (15x) |
| `discount_rate` | Discount Rate | 14% | 14% | Higher than T1 (12%) |
| `tax_rate` | Tax Rate | 20% | 20% | Same |

### 7.2 Fixed Development Costs (Upfront) by Tier

| Component | Tier 2 | Tier 3 |
|-----------|--------|--------|
| AlphaCore License | $150M | $100M |
| App Content R&D | $150M | $100M |
| LifeSkills R&D | $150M | $100M |
| **Fixed Total** | **$450M** | **$300M** |
| + Mgmt Fee Prepay | `students × budget × 10% / $1M` | Same formula |
| + Timeback Prepay | `students × budget × 20% / $1M` | Same formula |
| **Grand Total** | Sum of all above | Sum of all above |

### 7.3 Cohort Ramp (Student Enrollment over 5 Years)

```
if year <= ramp_years:
    fraction = year / ramp_years
    students = min(total_students, max(cohort_size, total_students × fraction))
else:
    students = total_students
```
- With 2 cohorts and 3-year ramp: Y1 = 25K, Y2 = 33K, Y3 = 50K, Y4 = 50K, Y5 = 50K

---

## 8. P&L Projection Calculations

**Source:** `financial.py` → `build_model()` (Tier 1 / US State) and `_build_cohort_model()` (Tier 2/3)

### 8.1 Tier 1 / US State P&L (per year)

| Line Item | Formula |
|-----------|---------|
| **Students** | From assumptions (`students_yearN`) |
| **Schools** | `max(1, ceil(students / avg_students_per_school))` |
| **New Schools** | `max(0, this_year_schools - previous_year_schools)` |
| **Blended Tuition** | `mid_tuition × 0.6 + premium_tuition × 0.4` |
| **Revenue** | `students × blended_tuition` |
| **COGS** | `revenue × cogs_pct` |
| **Gross Margin** | `revenue - COGS` |
| **OpEx** | `revenue × opex_pct` |
| **EBITDA** | `gross_margin - OpEx` |
| **Net Income** | `EBITDA × (1 - tax_rate)` |
| **CapEx** | `new_schools × capex_per_school` |
| **Free Cash Flow** | `net_income - CapEx` |
| **Cumulative Cash** | Running sum of FCF |

**Important:** The blended tuition mix is **hardcoded at 60% mid-tier / 40% premium**. This is NOT configurable.

### 8.2 Alpha's Revenue (per year, computed alongside P&L)

| Revenue Stream | Formula |
|----------------|---------|
| **Management Fee Revenue** | `revenue × management_fee_pct` (i.e., 10% of school revenue) |
| **Timeback License Revenue** | `students × per_student_budget × timeback_license_pct` (i.e., 20% of per-student budget) |
| **5yr Management Fee Total** | Sum of annual mgmt fee revenue over 5 years |
| **5yr Timeback Total** | Sum of annual timeback revenue over 5 years |

### 8.3 Tier 2/3 Cohort P&L (per year)

| Line Item | Formula |
|-----------|---------|
| **Students** | Cohort ramp (see §7.3) |
| **Revenue** | `students × per_student_budget` (no blended tuition — single tier) |
| **COGS** | `revenue × cogs_pct` |
| **Gross Margin** | `revenue - COGS` |
| **OpEx** | `revenue × opex_pct` |
| **EBITDA** | `gross_margin - OpEx` |
| **Net Income** | `EBITDA × (1 - tax_rate)` |
| **CapEx** | `new_schools × capex_per_school + (upfront_ip if year == 1 else 0)` |
| **FCF** | `net_income - CapEx` |

**Note:** In the cohort model, Year 1 CapEx includes the full upfront IP fee.

---

## 9. Upfront Ask Breakdown

### 9.1 Tier 1 (Full Model)

| Component | Default | Recipient | Formula |
|-----------|---------|-----------|---------|
| AlphaCore License | $250M | Alpha Holdings | Fixed |
| App Content R&D | $250M | Local expense | Fixed |
| LifeSkills R&D | $250M | Local expense | Fixed |
| Upfront Mgmt Fee | Variable | Alpha Holdings | `round(students_Y5 × per_student_budget × 0.10 / $1M)` $M |
| Upfront Timeback Fee | Variable | Alpha Holdings | `round(students_Y5 × per_student_budget × 0.20 / $1M)` $M |
| **Total** | **≥ $25M** | — | Sum of all above |

### 9.2 Tier 2

| Component | Default | Formula |
|-----------|---------|---------|
| AlphaCore License | $150M | Fixed |
| App Content R&D | $150M | Fixed |
| LifeSkills R&D | $150M | Fixed |
| Upfront Mgmt Fee | Variable | `round(total_students × per_student × 0.10 / $1M)` |
| Upfront Timeback Fee | Variable | `round(total_students × per_student × 0.20 / $1M)` |
| **Total** | $450M + variable | Sum |

### 9.3 Tier 3

Same as Tier 2 but with $100M per fixed component (total fixed = $300M).

---

## 10. Unit Economics Calculations

**Source:** `financial.py` → `build_model()` lines 483-498

### 10.1 Tier 1 / US State

| School Type | Revenue/Student | Cost/Student | Margin/Student | Margin % |
|-------------|----------------|--------------|----------------|----------|
| **Premium** | `premium_tuition` | `premium_tuition × cogs_pct` | `premium_tuition × (1 - cogs_pct)` | `(1 - cogs_pct) × 100` |
| **Mid-Market** | `mid_tuition` | `mid_tuition × cogs_pct` | `mid_tuition × (1 - cogs_pct)` | `(1 - cogs_pct) × 100` |

**Note:** Both school types use the SAME COGS percentage. There is no differentiation in cost structure by school type.

### 10.2 Tier 2/3 (Cohort Model)

| School Type | Revenue/Student | Cost/Student | Margin/Student | Margin % |
|-------------|----------------|--------------|----------------|----------|
| **Cohort (25K)** | `per_student_budget` | `per_student × cogs_pct` | `per_student × (1 - cogs_pct)` | `(1 - cogs_pct) × 100` |

---

## 11. Capital Deployment Calculations

**Source:** `financial.py` → `build_model()` lines 501-519

### Per Year:

| Component | Formula | Notes |
|-----------|---------|-------|
| **IP Development** | `upfront_ip_fee` (Year 1 only), $0 all other years | Full upfront paid in Y1 |
| **Management Fees** | `year_revenue × management_fee_pct` | Alpha's management fee for that year |
| **Launch Capital** | `new_schools × capex_per_school` | Building new schools |
| **Real Estate** | `launch_capital × 0.60` | 60% of launch capital attributed to RE |
| **Guide School** | Y1-Y2: `(students ÷ 20) × guide_school_fee`; Y3-Y5: `(students ÷ 20) × guide_school_fee × 0.30` | 20:1 student-teacher ratio; reduced in later years |
| **Total** | `IP + Management Fees + Launch + Guide School` | Note: Real Estate is subset of Launch, not additive |

**Important note:** `Real Estate` is displayed as a separate line but is **computed as 60% of Launch Capital**, meaning it is NOT additive to Launch Capital in the Total. The `Total` calculation is: `ip_dev + mgmt_fees + launch_capital + guide_total`. Real Estate is shown for informational breakdown only.

---

## 12. Returns Analysis Calculations

**Source:** `financial.py` → `build_model()` lines 522-544

| Metric | Formula |
|--------|---------|
| **Y5 EBITDA** | From P&L projection, Year 5 |
| **Enterprise Value at Exit** | `Y5_EBITDA × exit_ebitda_multiple` |
| **Total Invested** | Sum of all capital deployment totals (Y1-Y5) |
| **MOIC** | `enterprise_value_at_exit / total_invested` |
| **IRR** | Newton-Raphson approximation on cash flows: `[-capDeploy_Y1, -capDeploy_Y2, ..., -capDeploy_Y5 + EV_exit]` |
| **Payback Period** | First year where `cumulative_cash > 0` |

### IRR Calculation Detail
```python
cash_flows = [-cap_deploy[0].total, -cap_deploy[1].total, ..., -cap_deploy[4].total]
cash_flows[4] += enterprise_value_at_exit  # Terminal value added to Y5
# Newton-Raphson with initial guess of 15%, 200 iterations max
```

---

## 13. Sensitivity Analysis

**Source:** `financial.py` → `build_model()` lines 547-572

### Tier 1 / US State Sensitivity Variables

| Variable | Base Case | Downside | Upside |
|----------|-----------|----------|--------|
| Year 5 Students | `students_Y5` | `students_Y5 × 0.70` | `students_Y5 × 1.30` |
| Blended Tuition | `blended_tuition` | `blended_tuition × 0.85` | `blended_tuition × 1.15` |
| COGS % | `cogs_pct` | `cogs_pct + 5pp` | `cogs_pct - 5pp` |
| Exit Multiple | `exit_multiple` | `exit_multiple × 0.70` | `exit_multiple × 1.30` |

### Tier 2/3 Sensitivity Variables

| Variable | Base Case | Downside | Upside |
|----------|-----------|----------|--------|
| Number of Cohorts | `num_cohorts` | `max(1, cohorts - 1)` | `cohorts + 2` |
| Per-Student Budget | `per_student` | `per_student × 0.85` | `per_student × 1.15` |

---

## 14. Term Sheet Deal Parameters

**Source:** `term_sheet.py` → `generate_term_sheet_assumptions()`

These are generated AFTER the financial model and populate the term sheet document:

### 14.1 Deal Structure Parameters

| Parameter | Default (Sovereign) | Default (US State) | Notes |
|-----------|--------------------|--------------------|-------|
| Partnership Type | JV (value=1) | Direct (value=3) | 1=JV, 2=Licensing, 3=Direct |
| Alpha Ownership % | 0% | 100% | Sovereign: operator/licensor model |
| Term (years) | 25 | 25 | Renewable |
| Exclusivity (years) | 25 | 25 | Co-terminus with partnership |

### 14.2 Upfront Payment Breakdown (mirrors financial model)

| Parameter | Source | Formula |
|-----------|--------|---------|
| AlphaCore License ($M) | Financial model | `financial_model.upfront_alphacore_license / $1M` |
| App Content R&D ($M) | Financial model | `financial_model.upfront_app_content_rd / $1M` |
| LifeSkills R&D ($M) | Financial model | `financial_model.upfront_lifeskills_rd / $1M` |
| Upfront Mgmt Fee ($M) | Financial model | `financial_model.upfront_mgmt_fee / $1M` |
| Upfront Timeback Fee ($M) | Financial model | `financial_model.upfront_timeback_fee / $1M` |
| Total Upfront ($M) | Financial model | `financial_model.upfront_ip_fee / $1M` |

### 14.3 School Portfolio Parameters

| Parameter | Default | Formula |
|-----------|---------|---------|
| Y5 Student Target | From financial model | `pnl_projection[-1].students` |
| Per-Student Budget | From assumptions | `per_student_budget` or `mid_tuition` |
| Flagship Schools | 2 | Hardcoded |
| Flagship Tuition | $100,000 (sovereign) / $50,000 (US) | Hardcoded |
| Total Schools at Scale | From financial model | `pnl_projection[-1].schools` |

### 14.4 Counterparty Commitments

| Parameter | Formula | Notes |
|-----------|---------|-------|
| Scholarship Backstop ($/yr) | `round(0.50 × Y5_students × per_student / $1M)` $M | UAE formula: 50% capacity × tuition |
| Backstop Years | 5 | Hardcoded |
| Launch Capital ($M) | `max($5M, round(Y5_revenue × 0.05 / $1M))` | 5% of Y5 revenue |
| CapEx per School ($M) | From financial model | `capex_per_school / $1M` |
| Mgmt Fee Prepay (years) | 2 | Minimum per business rules |
| Mgmt Fee Prepay Amount ($M) | `round(min(5000, Y5_students) × per_student × mgmt_pct × 2 / $1M)` | Capped at 5,000 students for prepay calc |

### 14.5 Per-Student Fee Minimums (from UAE Reference)

| Fee | Calculation | UAE Floor |
|-----|-------------|-----------|
| Management Fee per Student | `max($2,500, per_student × mgmt_pct)` | $2,500/student |
| Timeback License per Student | `max($5,000, per_student × timeback_pct)` | $5,000/student |

---

## 15. US State-Specific Rules

**Source:** `us_state_rules.yaml`

### 15.1 Revenue Model (Fundamentally Different from Sovereign)

| Stream | Description | Tuition Range |
|--------|-------------|---------------|
| In-Person Schools | Micro schools (12-25 students) + 250-student campuses | Priced at ESA amount ($7K-$10K) or premium ($15K-$25K) |
| Virtual Product | GT School model | $3K-$5K/student |
| ESA/Voucher Capture | In priority states, ESA covers 55-82% of avg private tuition | Priced at ESA floor for maximum TAM |

### 15.2 School Types

| Type | Size | Tuition | Target Family |
|------|------|---------|---------------|
| Micro School | 12-25 students | $7,000-$10,000 | ESA families, first-time choice |
| Flagship Campus | 250 students | $15,000-$25,000 | Upper-middle income |
| Virtual (GT School) | Unlimited | $3,000-$5,000 | Homeschool, rural, ESA-funded |
| STEM/Sports Academy | 100-250 students | $12,000-$20,000 | Specialty demand |

### 15.3 Priority States ESA Data

| State | ESA Amount | Students on Vouchers | Avg Private Tuition | ESA Coverage % |
|-------|-----------|---------------------|--------------------|----|
| Florida | $9,500-$10,700 | 500,000 | $13,859 | ~72% |
| Texas | $10,000-$10,200 | 95,000 (Y1 est.) | $13,995 | ~73% |
| Arizona | $7,000-$8,000 | 83,819 | $12,314 | ~61% |
| Indiana | $6,100-$7,400 | 79,448 | $10,330 | ~63% |
| North Carolina | $3,000-$7,000 | 103,400 | $11,105 | ~44% |

### 15.4 How ESA Data Affects Financial Model

When ESA data is available for the state:
```python
esa_amount = esa_config.get("esa_amount", 8000)  # Note: parses first number from range string
base_per_student = max(esa_amount, 18000)
premium_tuition = max(25000, esa_amount * 3)
mid_tuition = max(15000, esa_amount * 2)
```

**Current issue to verify:** The `get_esa_data()` function returns the YAML dict, but `esa_amount` in YAML is a string like `"$9,500-$10,700"` for Florida. The code does `esa_cfg.get("esa_amount", 8000)` — this would return the string, not a number. The ESA data may not be properly parsed for most states. If the string can't be used as a number, the fallback defaults apply: `$18K base, $25K premium, $15K mid`.

### 15.5 Key Metrics

| Metric | Value |
|--------|-------|
| Max Customer Acquisition Cost | $500 |
| LTV Calculation | ESA-level tuition × 5-year retention = $35K-$50K |

---

## 16. Strategy Agent Rules (Feed into Financial Model)

**Source:** `strategy.py`

The Strategy agent's output **directly feeds** the financial model. In portal mode, the LLM generates these with the following constraints:

### 16.1 Non-Negotiable Constraints Given to LLM

| Constraint | Value | Enforced How |
|-----------|-------|-------------|
| Alpha equity ownership | 0% (sovereign), varies (US state) | Hardcoded override after LLM output |
| Y5 student target minimum | ≥ 10% of school-age population | Hardcoded override if LLM suggests lower |
| Management fee | 10% | Stated in prompt, not overrideable |
| Timeback license | 20% | Stated in prompt, not overrideable |
| Minimum per-student budget | $15,000 | Stated in prompt |
| Ownership split text | "0/100 — Alpha operates as exclusive operator & licensor; local entity owns 100%" | Hardcoded override for sovereign nations |

### 16.2 Strategy Fields That Drive Financial Model

| Strategy Field | Used In Financial Model As |
|---------------|--------------------------|
| `target_student_count_year5` | Y5 student target (subject to 10% floor enforcement) |
| `per_student_budget` | Referenced but financial model recalculates independently |
| `upfront_ask` | Referenced but financial model recalculates independently |
| `school_types` | Displayed in deck/term sheet (not directly in P&L) |
| `phased_rollout` | Displayed in deck/term sheet (not directly in P&L) |
| `partnership_structure.type` | Displayed in documents |
| `partnership_structure.ownership_split` | Displayed in documents |
| `key_asks` | Displayed in documents |

### 16.3 Tier 2/3 Strategy (Cohort-Based)

For Tier 2/3, the strategy agent uses a completely different prompt (`TIER_23_PROMPT`) focused on:
- How many 25K-student cohorts the government/private sector can support
- PPP-adjusted per-student budget: `max($15K, round($25K × max(0.3, min(2.0, GDP_per_capita / $50K)) / 500) × 500)`
- Per-cohort financials summary

---

## 17. Document Generation Rules

### 17.1 What Financial Data Appears in the Term Sheet
- Complete upfront payment breakdown table
- Ongoing fee structure (Mgmt 10%, Timeback 20%)
- School portfolio (flagship + total schools)
- Y5 student target and per-student budget
- 5-year P&L summary
- Counterparty commitments (backstop, launch capital, CapEx)
- Exclusivity and term length

### 17.2 What Financial Data Appears in the Investor Deck
- KPI boxes: Y5 students, Y5 revenue, IRR, MOIC
- 5-year P&L table (students, schools, revenue, EBITDA, net income, FCF)
- Returns analysis (IRR, MOIC, mgmt fee 5yr, timeback 5yr)
- Deal structure table (partnership, ownership, fees)
- Unit economics table
- Capital deployment table
- School types from strategy
- Rollout plan from strategy

### 17.3 What Financial Data Appears in the XLSX
6 sheets:
1. **Assumptions** — All configurable assumptions with value/min/max
2. **P&L Projection** — 5-year year-by-year + Alpha revenue summary
3. **Unit Economics** — Per-student metrics by school type
4. **Capital Deployment** — Year-by-year IP/mgmt/launch/RE/total
5. **Returns Analysis** — IRR, MOIC, EV, payback, fee summary
6. **Sensitivity Analysis** — Variable/base/downside/upside

---

## 18. Complete Line Item Reference Table

### Revenue-Side Line Items

| Line Item | Calculation | Key Inputs | Default (Tier 1 example) |
|-----------|-------------|------------|-------------------------|
| Blended Tuition | `mid × 0.6 + premium × 0.4` | premium_tuition, mid_tuition | Varies by country |
| Annual Revenue | `students × blended_tuition` | student count, blended tuition | Varies |
| Mgmt Fee Revenue (annual) | `revenue × 0.10` | revenue | 10% of revenue |
| Timeback Revenue (annual) | `students × per_student_budget × 0.20` | students, per_student_budget | 20% of per-student budget |
| Upfront IP Fee | AlphaCore + App R&D + LifeSkills R&D + Mgmt Prepay + Timeback Prepay | See §9 | $750M + variable |

### Cost-Side Line Items

| Line Item | Calculation | Key Inputs | Default |
|-----------|-------------|------------|---------|
| COGS | `revenue × cogs_pct` | revenue, 55% | 55% of revenue |
| OpEx | `revenue × opex_pct` | revenue, 20% | 20% of revenue |
| CapEx (per school) | `$5M × PPP_factor` (rounded) | PPP factor | $5M at PPP=1.0 |
| CapEx (annual) | `new_schools × capex_per_school` | new schools built | Varies |
| Tax | `EBITDA × tax_rate` | EBITDA, 20% | 20% of EBITDA |

### Margin Metrics

| Metric | Calculation |
|--------|-------------|
| Gross Margin | `revenue - COGS` = revenue × (1 - 0.55) = 45% |
| EBITDA Margin | `gross_margin - OpEx` = revenue × (0.45 - 0.20) = 25% |
| Net Margin | `EBITDA × (1 - tax)` = revenue × 0.25 × 0.80 = 20% |

### Returns Metrics

| Metric | Calculation | Typical Range |
|--------|-------------|---------------|
| IRR | Newton-Raphson on [-invested, ..., -invested + EV_exit] | Varies widely |
| MOIC | `EV_exit / total_invested` | 1.5x – 10x+ |
| Payback | First year cumulative_cash > 0 | 2-5 years |
| EV at Exit | `Y5_EBITDA × exit_multiple` | Varies |

---

## Appendix A: Key Assumptions to Verify / Potential Issues

| # | Item | Current Behavior | Potential Issue |
|---|------|-----------------|----------------|
| 1 | **Blended tuition mix** | Hardcoded 60% mid / 40% premium | Not adjustable; may not reflect actual market |
| 2 | **COGS %** same across school types | Both premium and mid use same COGS % | Premium schools may have different cost structures |
| 3 | **US State ESA parsing** | `get_esa_data()` returns dict with string ESA amounts like "$9,500-$10,700" | Code does `esa_cfg.get("esa_amount", 8000)` which returns the string, not a usable number |
| 4 | **Student-teacher ratio** | Hardcoded 20:1 for Guide School cost calc | May not match actual staffing plans |
| 5 | **Real Estate = 60% of Launch Capital** | Hardcoded percentage | May not reflect actual RE costs in different markets |
| 6 | **Y5 student target = 10% of school-age pop** | Mandatory floor | For large countries (India: 500M+ school-age), 10% = 50M+ students, which is unrealistic. Capped by max slider values. |
| 7 | **PPP factor uses GDP/capita not PPP-specific data** | GDP/capita / $30K | True PPP adjustment would use World Bank PPP conversion factors |
| 8 | **Guide School cost reduces to 30% in Y3-Y5** | `teachers × fee × 0.30` for Y3+ | Assumes training needs decrease by 70% after initial years |
| 9 | **No revenue growth / inflation** | Tuition stays flat over 5 years | Real models should include tuition escalation |
| 10 | **CapEx only for new schools** | No maintenance CapEx | Existing schools need ongoing capital maintenance |
| 11 | **Fixed $250M per development component (T1)** | Same whether 50K or 200K students | May need scaling by target size |
| 12 | **Cohort model (T2/3) has CapEx + upfront IP in Y1** | `capex + upfront_ip` in Year 1 FCF | Creates very negative Y1 cash flow |
| 13 | **Exit multiple** | T1: 15x, T2/3: 12x | Education sector multiples may differ by market |
| 14 | **Tax rate** | Flat 20% everywhere | Many countries have different rates or education exemptions |
| 15 | **No working capital** | Not modeled | Growing enrollment requires working capital investment |

---

## Appendix B: Data Flow Diagram

```
User Input: "Saudi Arabia"
        │
        ▼
┌──────────────────────┐
│  Country Research     │◄── Perplexity API (live web research)
│  (country_research.py)│◄── World Bank API (GDP, population, etc.)
│                       │◄── K-12 Spotlight (US states only)
│                       │◄── LLM synthesis → CountryProfile
└──────────┬───────────┘
           │ CountryProfile (GDP/capita, population_0_18, avg_private_tuition, tier, ...)
           ▼
┌──────────────────────┐
│  Education Research   │◄── Perplexity API
│  (education_research) │◄── LLM synthesis → EducationAnalysis
└──────────┬───────────┘
           │ EducationAnalysis (pain points, reform landscape, fit assessment)
           ▼
┌──────────────────────┐
│  Strategy Agent       │◄── LLM with constraints (10% fee, 20% license, 0% equity, 10% student floor)
│  (strategy.py)        │──► Strategy (target_student_count_y5, school_types, partnership, ...)
└──────────┬───────────┘
           │ Strategy object
           ▼
┌──────────────────────────────────────────┐
│  Financial Model                          │
│  (financial.py)                           │
│                                           │
│  1. generate_assumptions()                │
│     ├── PPP factor = min(1, GDP_cap/30K)  │
│     ├── Per-student = max(5K, min(30K,    │
│     │   avg_tuition × 0.8))               │
│     ├── Student ramp: 10%→20%→40%→60%→100%│
│     ├── Fees: 10% mgmt, 20% timeback      │
│     └── Returns: 15x exit, 12% disc, 20%  │
│                                           │
│  2. build_model()                         │
│     ├── 5-year P&L (revenue, COGS, EBITDA)│
│     ├── Unit economics (per-student)       │
│     ├── Capital deployment (per-year)      │
│     ├── Returns (IRR, MOIC, EV, payback)  │
│     └── Sensitivity (±30% students, ±15%  │
│         tuition, ±5pp COGS, ±30% exit)    │
└──────────┬───────────────────────────────┘
           │ FinancialModel + FinancialAssumptions
           ▼
┌──────────────────────┐
│  Documents            │
│  ├── Term Sheet       │ (term_sheet.py)
│  ├── Investor Deck    │ (document_generation.py → Gamma API)
│  ├── Memorandum       │ (document_generation.py → DOCX)
│  └── XLSX             │ (financial.py → export_model_xlsx)
└──────────────────────┘
```

---

*End of reference document. All formulas and rules extracted from source code as of March 2026.*
