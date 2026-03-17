"""Strategy Agent — produces McKinsey/VC quality 15-20 page market-entry strategy.

Post-workshop (March 16, 2026): No tiers. One model for all sovereign nations.
Two-prong structure: Flagship ($40K-$100K) + National ($25K fixed).
100/0 equity: counterparty owns 100%, Alpha is exclusive operator & licensor.

Synthesises country research and education analysis into a comprehensive
go-to-market strategy. Uses multi-call generation for exhaustive depth.
"""

from __future__ import annotations

import logging
import os

from docx import Document as DocxDocument
from docx.shared import Pt as DocxPt
from docx.enum.text import WD_ALIGN_PARAGRAPH

from models.schemas import (
    Strategy, CountryProfile, EducationAnalysis,
    EntryMode, PartnershipType, TargetType,
)
from services.llm import call_llm, call_llm_plain
from services.humanizer import humanize_report
from config import OUTPUT_DIR

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Multi-section prompts
# ---------------------------------------------------------------------------

SECTION_1_PROMPT = """You are a senior partner at McKinsey & Company working alongside a
managing director from Goldman Sachs' investment banking division. You are writing the
FIRST PART of a comprehensive market-entry strategy for 2hr Learning (Alpha) in **{target}**.

This will be presented to Alpha's CEO, the target country's sovereign leadership, and
institutional investors.

## About Alpha / 2hr Learning
- **Timeback**: AI compresses core academics into 2 hours/day → remaining time for
  specialisations (STEM, sports, arts, entrepreneurship, life skills)
- **AlphaCore**: Curriculum OS and learning management system
- **Guide School**: 12-month program transforming traditional teachers into "Guides"
- **Incept eduLLM**: Custom education AI adapted to local curriculum and culture
- **Three commitments**: Children love school | Learn 2x faster | Future-ready skills
- **UAE deal (Ed71/Next71)**: $1.5B upfront, 200K students over 5 years, $25K/student budget,
  Alpha holds 0% equity — serves as exclusive operator & licensor; local entity (Next71) owns 100%,
  cultural IP layer via AsasOne (local partner), Emirati Guide cohort

## Two-Prong Model (applies to ALL sovereign deals)
- **Prong 1 — Flagship Schools**: Tuition $40K-$100K (set by AGI of top 20% families).
  Located in capital city + 1-2 biggest cities. 50% backstop on enrollment.
  2-3 schools. Premium experience, proof-of-concept, brand anchor.
- **Prong 2 — National Schools**: FIXED $25K per-student budget (non-negotiable).
  100,000 student-year minimum commitment. Broad national rollout.
- **Equity**: 100/0 — Counterparty owns 100%, Alpha owns 0%. Alpha is exclusive operator & licensor (Marriott model).
- **Revenue model**: Management fee 10% of combined revenue (non-negotiable),
  Timeback License 20% of combined revenue (non-negotiable).
- **Fixed upfront development costs**: $250M AlphaCore License + $250M EdTech App R&D + $250M LifeSkills R&D = $750M total (non-negotiable).
- **Prepaid fees**: Management fee + Timeback fee prepaid (scales by student count).

## Country & Education Context
{country_context}

{education_context}

## Write EXACTLY these sections:

# Market Entry Strategy: {target}

## 1. Executive Summary
Write 6-8 paragraphs covering:
- The strategic opportunity in {target} (quantified)
- Recommended entry mode and operator & licensor structure (NOT a JV — Alpha is operator & licensor, counterparty owns 100%)
- The two-prong model: Flagship schools (tuition $40K-$100K) + National schools ($25K/student fixed)
- Proposed deal parameters (commitment size, student count, fixed upfront fees)
- Phased rollout plan summary
- Financial return thesis (IRR, MOIC range)
- Key risks and why the opportunity justifies them
- Comparison to the UAE reference deal
- Timeline from agreement to first school opening

## 2. Market Opportunity Assessment

### 2.1 Total Addressable Market
Create a detailed TAM calculation table:

| Component | Value | Source | Methodology |
|-----------|-------|--------|-------------|
| Total K-12 students | ... | ... | ... |
| % in target income segments | ... | ... | ... |
| # of addressable students | ... | ... | ... |
| Flagship addressable (top 20% AGI) | ... | ... | ... |
| National addressable | ... | ... | ... |
| **Total TAM** | **$...** | ... | ... |

### 2.2 Serviceable Market
Create SAM table:

| Filter | Students | Revenue | Rationale |
|--------|----------|---------|-----------|
| Income-qualified (Flagship) | ... | ... | ... |
| Geographically accessible (National) | ... | ... | ... |
| Innovation-receptive | ... | ... | ... |
| Regulatory-feasible | ... | ... | ... |
| **SAM** | **...** | **$...** | ... |

### 2.3 Penetration Scenarios
Create scenarios table:

| Scenario | Flagship Students | National Students | Combined Revenue (Yr 5) | Total Upfront Ask | Assumptions |
|----------|------------------|------------------|------------------------|------------------|-------------|
| Conservative | ... | 100,000 | $... | $... | ... |
| Base Case | ... | 150,000 | $... | $... | ... |
| Aggressive | ... | 250,000 | $... | $... | ... |

### 2.4 Comparison to UAE Benchmark

| Dimension | UAE Deal | {target} (Proposed) | Scaling Factor | Rationale |
|-----------|---------|-------------------|---------------|-----------|
| Population | 10M | ... | ... | ... |
| GDP/Capita | $44K | ... | ... | ... |
| Student Commitment | 200K | ... | ... | ... |
| Per-Student Budget (National) | $25K | $25K (FIXED) | 1.0x | Non-negotiable |
| Flagship Tuition | N/A | $...K | ... | Based on AGI top 20% |
| Upfront Development | $750M+ | $750M (FIXED) | 1.0x | Non-negotiable |
| Structure | 0/100 (Alpha operates, local owns) | 100/0 — Counterparty 100%, Alpha 0% | Same | Operator & Licensor |

Write 5-6 paragraphs on market sizing methodology, key assumptions, and why the numbers
are achievable based on the country research.

**NOTE**: Financial numbers ($25K national budget, $750M development) are FIXED. Strategy should
focus on positioning, cultural fit, regulatory pathway, and national vision alignment — NOT
on deriving financial numbers from country data.

**🎯 Strategic Priority:** Quantify the specific opportunity with confidence intervals.

## 3. Recommended Entry Mode

### 3.1 Entry Mode Decision Matrix
Create a comprehensive comparison:

| Evaluation Criteria | Weight | Private Entry | Government Partnership | Hybrid Model |
|--------------------|--------|--------------|----------------------|-------------|
| Speed to market | 15% | ... /5 | ... /5 | ... /5 |
| Scale potential (Yr 5) | 20% | ... /5 | ... /5 | ... /5 |
| Revenue per student | 10% | ... /5 | ... /5 | ... /5 |
| Regulatory simplicity | 10% | ... /5 | ... /5 | ... /5 |
| Capital efficiency | 10% | ... /5 | ... /5 | ... /5 |
| Political sustainability | 15% | ... /5 | ... /5 | ... /5 |
| Brand building | 10% | ... /5 | ... /5 | ... /5 |
| Exit optionality | 10% | ... /5 | ... /5 | ... /5 |
| **Weighted Score** | **100%** | **...** | **...** | **...** |

Write 4-5 paragraphs justifying the recommended entry mode based on the scoring above,
country-specific regulatory factors, and precedent from the UAE deal.

**🎯 Strategic Priority:** Provide a clear, defensible recommendation with rationale.

IMPORTANT: Minimum 3,000 words. Investment-thesis quality. Data-driven. Tables throughout."""

SECTION_2_PROMPT = """You are continuing the McKinsey/Goldman market-entry strategy for **{target}**.
Writing sections 4-7.

## Country & Education Context
{country_context}

{education_context}

## Key Model Parameters (for reference — these are FIXED, not to be derived)
- Equity: 100/0 — Counterparty owns 100%, Alpha is exclusive operator & licensor
- Prong 1 (Flagship): Tuition $40K-$100K, 2-3 schools in capital + biggest cities
- Prong 2 (National): FIXED $25K per-student budget, 100K student-year minimum
- Fixed development: $250M each (AlphaCore, App R&D, LifeSkills) = $750M total
- Management fee: 10%, Timeback: 20% (both non-negotiable)

## Write EXACTLY these sections:

## 4. Partnership Structure

### 4.1 Recommended Partner Profile
Create a table of potential partner types:

| Partner Type | Specific Candidates | Pros | Cons | Fit Score |
|-------------|-------------------|------|------|----------|
| Sovereign Wealth Fund | ... | ... | ... | ... |
| Royal Family Office | ... | ... | ... | ... |
| Government Ministry | ... | ... | ... | ... |
| Private Conglomerate | ... | ... | ... | ... |
| Education Foundation | ... | ... | ... | ... |

### 4.2 Operator & Licensor Structure Design
Based on the UAE model — Alpha holds 0% equity, counterparty owns 100%:

| Structural Element | UAE (Ed71/Next71) | {target} (Proposed) | Rationale |
|-------------------|---------------|-------------------|-----------|
| Entity Name | Ed71 / Next71 | ... (suggest 2-3 options) | ... |
| Ownership Split | 100/0 — Local 100%, Alpha 0% | 100/0 — Counterparty 100%, Alpha 0% | Marriott model |
| Board Composition | ... | ... | ... |
| IP Ownership | Alpha retains core IP, licenses exclusively | ... | ... |
| Cultural IP Layer | AsasOne | ... | ... |
| Operational Control | Alpha as exclusive operator | ... | ... |
| Revenue Distribution | 10% mgmt + 20% timeback to Alpha | Same | Non-negotiable |
| Exit Mechanism | ... | ... | ... |
| Non-Compete | ... | ... | ... |
| Dispute Resolution | ... | ... | ... |

Write 5-6 paragraphs on the operator & licensor structure rationale, governance design,
IP protection strategy, and cultural IP layer development. Emphasize this is NOT a JV —
Alpha operates, counterparty owns.

### 4.3 Cultural IP Layer Design
How to localise Alpha's model while preserving national identity, cultural values,
and local curriculum requirements. Reference the AsasOne approach.
Propose specific cultural life-skills ideas relevant to {target}'s heritage and values.

**🎯 Strategic Priority:** The local entity name and structure is critical for political buy-in.

## 5. Brand & Positioning

### 5.1 Brand Architecture
Suggest 3-4 local entity names (following the Ed71/Next71 naming pattern):

| Name Option | Meaning/Rationale | Positioning | Target Association |
|------------|-------------------|------------|-------------------|
| ... | ... | ... | ... |
| ... | ... | ... | ... |
| ... | ... | ... | ... |

### 5.2 Messaging Framework
Create a messaging matrix:

| Stakeholder | Key Message | Proof Points | Emotional Hook |
|-------------|-----------|-------------|----------------|
| Head of State | ... | ... | ... |
| Education Minister | ... | ... | ... |
| Sovereign Fund | ... | ... | ... |
| Parents (Affluent — Flagship) | ... | ... | ... |
| Parents (National Schools) | ... | ... | ... |
| Students | ... | ... | ... |
| Teachers | ... | ... | ... |
| Media | ... | ... | ... |

Write 3-4 paragraphs on brand positioning strategy, including how to differentiate
Flagship schools (Prong 1) from National schools (Prong 2) in public perception.

## 6. School Type Portfolio

### 6.1 Two-Prong School Architecture

| Dimension | Prong 1: Flagship | Prong 2: National |
|-----------|------------------|-------------------|
| Target Segment | Top 20% by AGI | Broad national population |
| Annual Tuition/Budget | $40K-$100K (set by AGI) | $25K (FIXED) |
| Capacity | 800-1,500 per school | 800 per school |
| Location Type | Capital city + 1-2 biggest cities | Nationwide |
| Curriculum Mix | 2hr core + premium specialisations | 2hr core + national specialisations |
| Teacher Model | All Guides (premium) | All Guides |
| Physical Model | Premium campus | Modern, efficient |
| Technology | Full Timeback + eduLLM | Full Timeback + eduLLM |
| Year 1 Target | 2-3 schools | Ramp begins |
| Year 5 Target | 3-5 schools | 100K+ students |
| Purpose | Proof of concept, brand anchor | Scale, national impact |

Write 4-5 paragraphs on the two-prong portfolio strategy, why Flagship precedes National,
how each prong serves a different strategic purpose, and how success in Prong 1
de-risks Prong 2.

### 6.2 Pricing Strategy
Flagship pricing is set by AGI of top 20% families ($40K-$100K range).
National budget is FIXED at $25K — this is not derived from country data.
Discuss how these price points compare to existing private education options.

**🎯 Strategic Priority:** Flagship success is the proof-of-concept that unlocks National scale.

## 7. Phased Rollout Plan

### 7.1 Five-Year Rollout

| Phase | Timeline | Prong | Schools | Students | Revenue | Key Milestones | Decision Gate |
|-------|----------|-------|---------|----------|---------|---------------|--------------|
| Pre-Launch | M1-M12 | — | 0 | 0 | $0 | ... | Go/No-Go |
| Phase 1: Flagship | Yr 1 | 1 | 2-3 | ... | $... | ... | National approval |
| Phase 2: National Ramp | Yr 2-3 | 1+2 | ... | ... | $... | ... | Scale approval |
| Phase 3: Full Scale | Yr 4-5 | 1+2 | ... | 100K+ | $... | ... | Continuation |
| **Total** | **5 years** | **Both** | **...** | **...** | **$...** | ... | ... |

### 7.2 Pre-Launch Workstreams (18-month timeline)

| Workstream | M1-3 | M4-6 | M7-9 | M10-12 | M13-15 | M16-18 | Owner |
|-----------|-------|-------|-------|--------|--------|--------|-------|
| Partnership/Legal | ... | ... | ... | ... | ... | ... | ... |
| Regulatory | ... | ... | ... | ... | ... | ... | ... |
| Curriculum Localisation | ... | ... | ... | ... | ... | ... | ... |
| Guide School (Teachers) | ... | ... | ... | ... | ... | ... | ... |
| Technology Deployment | ... | ... | ... | ... | ... | ... | ... |
| Facilities/RE | ... | ... | ... | ... | ... | ... | ... |
| Hiring | ... | ... | ... | ... | ... | ... | ... |
| Marketing/Brand | ... | ... | ... | ... | ... | ... | ... |

Write 4-5 paragraphs on the rollout strategy, critical path, and decision gates.

**🎯 Strategic Priority:** Flagship (Prong 1) success is the make-or-break moment that
unlocks National (Prong 2) commitment.

IMPORTANT: Minimum 3,000 words. Specific, actionable, investment-thesis quality."""

SECTION_3_PROMPT = """You are completing the McKinsey/Goldman strategy report for **{target}**.
Writing sections 8-12 (final sections).

## Country & Education Context
{country_context}

{education_context}

## Key Model Parameters (for reference — these are FIXED, not to be derived)
- Equity: 100/0 — Counterparty owns 100%, Alpha is exclusive operator & licensor
- Prong 1 (Flagship): Tuition $40K-$100K, 2-3 flagship schools
- Prong 2 (National): FIXED $25K per-student budget, 100K student-year minimum
- Fixed development: $250M each (AlphaCore, App R&D, LifeSkills) = $750M total
- Management fee: 10%, Timeback: 20% (both non-negotiable)

## Write EXACTLY these sections:

## 8. Value Proposition Framework

### 8.1 Government / Sovereign Value Proposition
Write 3-4 paragraphs covering:
- Economic diversification through education sector development
- Human capital development and global competitiveness
- National brand positioning (education hub)
- Job creation (teachers, administrators, support staff)
- Technology transfer and AI capability building
- Measurable outcomes and global rankings improvement

### 8.2 Parent Value Proposition
Write 3-4 paragraphs covering:
- "Children will love school" — engagement and happiness metrics
- "Learn 2x faster" — academic outcomes evidence
- "Future-ready skills" — specialisations, AI-age preparation
- Flagship: world-class premium experience; National: transformative quality at accessible price
- University placement outcomes

### 8.3 Investor Value Proposition
Write 3-4 paragraphs covering:
- Returns thesis (IRR, MOIC expectations)
- Capital deployment efficiency (counterparty funds 100%, Alpha operates)
- Recurring revenue model (10% mgmt + 20% timeback)
- Scale optionality (domestic expansion + regional)
- Exit pathways (IPO, strategic sale, sovereign buyout)

Create a value proposition summary table:

| Stakeholder | Primary Value | Secondary Value | Evidence/Proof | Risk |
|-------------|-------------|----------------|---------------|------|
| Head of State | ... | ... | ... | ... |
| Education Minister | ... | ... | ... | ... |
| Finance Minister | ... | ... | ... | ... |
| Sovereign Fund | ... | ... | ... | ... |
| Parents (Flagship) | ... | ... | ... | ... |
| Parents (National) | ... | ... | ... | ... |
| Students | ... | ... | ... | ... |
| Teachers | ... | ... | ... | ... |
| Employers | ... | ... | ... | ... |

## 9. Competitive Positioning & Moat Analysis

### 9.1 Competitive Advantage Assessment

| Competitive Factor | Alpha | Traditional Private | International Chains | EdTech | Government Schools |
|-------------------|-------|-------------------|-------------------|--------|------------------|
| Learning Outcomes | ★★★★★ | ★★★ | ★★★★ | ★★★ | ★★ |
| Student Engagement | ★★★★★ | ★★ | ★★★ | ★★★ | ★★ |
| Technology | ★★★★★ | ★★ | ★★★ | ★★★★ | ★ |
| Teacher Quality | ★★★★★ | ★★★ | ★★★★ | N/A | ★★ |
| Curriculum Innovation | ★★★★★ | ★★ | ★★★ | ★★★ | ★★ |
| Affordability | ★★★ | ★★★ | ★★ | ★★★★ | ★★★★★ |
| Scale Potential | ★★★★★ | ★★ | ★★★ | ★★★★ | ★★★★★ |
| Data & AI | ★★★★★ | ★ | ★★ | ★★★★ | ★ |

### 9.2 Moat Analysis
Write 4-5 paragraphs on Alpha's defensibility: proprietary AI (Incept eduLLM),
outcomes data flywheel, teacher training IP (Guide School), integrated model
complexity, first-mover advantage in sovereign partnerships.

## 10. Risk Mitigation Strategy

Create a comprehensive risk register:

| # | Risk | Category | Prob | Impact | Risk Score | Mitigation | Owner | Timeline |
|---|------|----------|------|--------|-----------|-----------|-------|----------|
| 1 | ... | Regulatory | H/M/L | H/M/L | ... | ... | ... | ... |
| 2 | ... | Political | ... | ... | ... | ... | ... | ... |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

Include at least 15 specific risks across categories: regulatory, political, financial,
operational, competitive, cultural, reputational, macroeconomic, technology, legal.

Write 4-5 paragraphs on the overall risk framework and mitigation strategy.

**🎯 Strategic Priority:** Political risk and regulatory risk are typically the biggest
dealbreakers — address them head-on.

## 11. Key Asks & Deal Parameters

### 11.1 Proposed Deal Terms

| Term | UAE Reference | {target} Proposal | Rationale |
|------|-------------|-------------------|-----------|
| Ownership | 100/0 (Local 100%, Alpha 0%) | 100/0 (Counterparty 100%, Alpha 0%) | Operator & Licensor model |
| Upfront Development | $750M | $750M (FIXED) | Non-negotiable |
| Per-Student Budget (National) | $25K | $25K (FIXED) | Non-negotiable |
| Flagship Tuition | N/A | $...K (set by AGI) | Top 20% families |
| National Student Count (5yr) | 200K | 100K minimum | Minimum commit |
| Management Fee | 10% | 10% | Non-negotiable |
| Timeback License | 20% | 20% | Non-negotiable |
| Prepaid Mgmt + Timeback | Variable | Variable (scales by students) | Calculated |
| Exclusivity | UAE | {target} + ... | ... |
| Duration | 10 years | ... | ... |
| Performance Guarantees | ... | ... | ... |

### 11.2 Key Asks from Sovereign Partner
Numbered list of 8-10 specific asks with justification.

### 11.3 Key Concessions Alpha Can Offer
Numbered list of 5-6 concessions with strategic rationale.

## 12. Sources & Appendices

### 12.1 Sources
List all sources cited.

### 12.2 Key Assumptions
Table of all key assumptions used in this strategy.

IMPORTANT: Minimum 3,000 words. This completes a document that will be read by heads
of state and VC managing directors. Every recommendation must be data-backed."""

REPORT_REVISION_PROMPT = """You are revising a market-entry strategy based on executive feedback.

Original strategy:
{original_report}

Executive feedback:
{feedback}

Produce a revised full strategy incorporating the feedback. Maintain depth,
🎯 Strategic Priority callouts, and all tables. Must be at least as long as original."""


async def run_strategy(
    target: str,
    country_profile: CountryProfile,
    education_analysis: EducationAnalysis,
    entry_mode: EntryMode | None = None,
    feedback: str | None = None,
    previous_report: str | None = None,
) -> tuple[Strategy, str, str]:
    """Execute strategy development. Returns (strategy, report_md, docx_path)."""
    logger.info("Running strategy agent for %s", target)

    country_ctx = _build_country_context(country_profile)
    education_ctx = _build_education_context(education_analysis)

    # --- Detect US state ---
    is_us_state = country_profile.target.type == TargetType.US_STATE

    # --- Minimum student target ---
    # Sovereign nations: 100K student-year minimum for national schools
    # US states: 10% of school-age population
    if is_us_state:
        school_age_pop = (
            country_profile.demographics.population_0_18
            or country_profile.education.k12_enrolled
            or 500_000
        )
        min_y5_students = max(5_000, int(school_age_pop * 0.10))
    else:
        min_y5_students = 100_000  # Workshop decision: 100K student-year minimum

    # --- Structured strategy ---
    if is_us_state:
        structured_prompt = (
            "You are a senior VC/McKinsey strategist advising Alpha Holdings (2hr Learning) "
            "on a market-entry deal for a US state.\n\n"
            "CRITICAL DEAL PARAMETERS (non-negotiable):\n"
            "- Alpha holds 0% equity in the local entity. Alpha is the exclusive operator & licensor. "
            "The local entity owns 100% of equity.\n"
            f"- The Year 5 student target must be AT LEAST {min_y5_students:,} "
            f"(>= 10% of the school-age population).\n"
            "- Management fee: 10% of school revenue (non-negotiable)\n"
            "- Timeback license: 20% of per-student budget (non-negotiable)\n\n"
            "Set partnership_structure.ownership_split to "
            "'0/100 — Alpha operates as exclusive operator & licensor; local entity owns 100%'.\n\n"
            "Produce a structured strategy."
        )
    else:
        structured_prompt = (
            "You are a senior VC/McKinsey strategist advising Alpha Holdings (2hr Learning) "
            "on a sovereign market-entry deal.\n\n"
            "CRITICAL DEAL PARAMETERS (non-negotiable):\n"
            "- TWO-PRONG MODEL:\n"
            "  Prong 1 (Flagship): Tuition $40K-$100K set by AGI of top 20% families. "
            "Capital city + 1-2 biggest cities. 2-3 schools. 50% backstop.\n"
            "  Prong 2 (National): FIXED $25K per-student budget. "
            f"Minimum {min_y5_students:,} student-year commitment.\n"
            "- Equity: 100/0 — Counterparty owns 100%, Alpha owns 0%. "
            "Alpha is exclusive operator & licensor (Marriott model).\n"
            "- Management fee: 10% of combined revenue (non-negotiable)\n"
            "- Timeback license: 20% of combined revenue (non-negotiable)\n"
            "- Fixed upfront development: $250M AlphaCore + $250M App R&D + $250M LifeSkills = $750M (non-negotiable)\n"
            "- Prepaid management + timeback fees scale by student count\n\n"
            "Set partnership_structure to operator_licensor.\n"
            "Set ownership_split to '100/0 — Counterparty owns 100%, Alpha is exclusive operator & licensor'.\n\n"
            "Produce a structured strategy."
        )
    try:
        strategy: Strategy = await call_llm(
            system_prompt=structured_prompt,
            user_prompt=(
                f"Target: {target}\nCountry: {country_ctx}\nEducation: {education_ctx}\n"
                f"Entry mode preference: {entry_mode.value if entry_mode else 'not specified'}"
            ),
            output_schema=Strategy,
        )
    except Exception as exc:
        logger.warning("Structured strategy failed: %s", exc)
        strategy = Strategy(entry_mode=entry_mode or EntryMode.HYBRID)

    if entry_mode:
        strategy.entry_mode = entry_mode

    # --- Enforce non-negotiable deal parameters on the structured object ---
    if not is_us_state:
        strategy.partnership_structure.ownership_split = (
            "100/0 — Counterparty owns 100%, Alpha is exclusive operator & licensor"
        )
    else:
        strategy.partnership_structure.ownership_split = (
            "0/100 — Alpha operates as exclusive operator & licensor; local entity owns 100%"
        )

    # Enforce Y5 student floor
    if strategy.target_student_count_year5 and strategy.target_student_count_year5 < min_y5_students:
        logger.info(
            "Overriding Y5 student target from %s to %s (minimum floor)",
            strategy.target_student_count_year5, min_y5_students,
        )
        strategy.target_student_count_year5 = min_y5_students
    elif not strategy.target_student_count_year5:
        strategy.target_student_count_year5 = min_y5_students

    # --- Narrative report ---
    if feedback and previous_report:
        report_md = await call_llm_plain(
            system_prompt=REPORT_REVISION_PROMPT.format(
                original_report=previous_report, feedback=feedback
            ),
            user_prompt=f"Revise the strategy for {target}.",
        )
    else:
        # Full strategy: all countries and US states go through the same pipeline
        entry_note = f"\nEntry mode preference: {entry_mode.value}" if entry_mode else ""

        logger.info("Generating strategy section 1/3 for %s", target)
        section_1 = await call_llm_plain(
            system_prompt=SECTION_1_PROMPT.format(
                target=target, country_context=country_ctx, education_context=education_ctx,
            ),
            user_prompt=f"Write sections 1-3 of the strategy for {target}.{entry_note}",
        )

        logger.info("Generating strategy section 2/3 for %s", target)
        section_2 = await call_llm_plain(
            system_prompt=SECTION_2_PROMPT.format(
                target=target, country_context=country_ctx, education_context=education_ctx,
            ),
            user_prompt=f"Write sections 4-7 of the strategy for {target}.{entry_note}",
        )

        logger.info("Generating strategy section 3/3 for %s", target)
        section_3 = await call_llm_plain(
            system_prompt=SECTION_3_PROMPT.format(
                target=target, country_context=country_ctx, education_context=education_ctx,
            ),
            user_prompt=f"Write sections 8-12 of the strategy for {target}.{entry_note}",
        )

        report_md = section_1 + "\n\n" + section_2 + "\n\n" + section_3

    # --- Humanize: remove AI writing patterns ---
    logger.info("Humanizing strategy report for %s", target)
    report_md = await humanize_report(report_md)

    # --- Save DOCX ---
    docx_path = _save_report_docx(target, report_md, "Market Entry Strategy")

    logger.info("Strategy complete for %s (mode=%s)", target, strategy.entry_mode)
    return strategy, report_md, docx_path


def _build_country_context(p: CountryProfile) -> str:
    parts = [f"**Country Profile: {p.target.name}**"]
    if p.demographics.total_population:
        parts.append(f"- Population: {p.demographics.total_population:,.0f}")
    if p.demographics.population_0_18:
        parts.append(f"- School-age population: {p.demographics.population_0_18:,.0f}")
    if p.economy.gdp:
        parts.append(f"- GDP: ${p.economy.gdp:,.0f}")
    if p.economy.gdp_per_capita:
        parts.append(f"- GDP per capita: ${p.economy.gdp_per_capita:,.0f}")
    if p.economy.gdp_growth_rate:
        parts.append(f"- GDP growth: {p.economy.gdp_growth_rate}%")
    if p.economy.sovereign_wealth_fund:
        parts.append(f"- SWF: {p.economy.sovereign_wealth_fund}")
    if p.education.k12_enrolled:
        parts.append(f"- K-12 students: {p.education.k12_enrolled:,.0f}")
    if p.education.avg_private_tuition:
        parts.append(f"- Avg private tuition: ${p.education.avg_private_tuition:,.0f}")
    if p.regulatory.foreign_ownership_rules:
        parts.append(f"- Foreign ownership: {p.regulatory.foreign_ownership_rules}")
    if p.political_context.national_vision_plan:
        parts.append(f"- National vision: {p.political_context.national_vision_plan}")
    if p.competitive_landscape.major_operators:
        ops = ", ".join(o.name for o in p.competitive_landscape.major_operators[:5])
        parts.append(f"- Major operators: {ops}")
    return "\n".join(parts)


def _build_education_context(e: EducationAnalysis) -> str:
    parts = ["**Education Analysis Summary:**"]
    if e.system_diagnosis.primary_pain_points:
        parts.append(f"- Student pain points: {'; '.join(e.system_diagnosis.primary_pain_points[:5])}")
    if e.system_diagnosis.parent_pain_points:
        parts.append(f"- Parent pain points: {'; '.join(e.system_diagnosis.parent_pain_points[:5])}")
    if e.system_diagnosis.government_pain_points:
        parts.append(f"- Government pain points: {'; '.join(e.system_diagnosis.government_pain_points[:5])}")
    if e.reform_landscape.active_reforms:
        parts.append(f"- Active reforms: {'; '.join(e.reform_landscape.active_reforms[:5])}")
    if e.two_hr_learning_fit.unique_value_propositions:
        parts.append(f"- Alpha UVPs: {'; '.join(e.two_hr_learning_fit.unique_value_propositions[:5])}")
    if e.two_hr_learning_fit.model_recommendation:
        parts.append(f"- Recommended model: {e.two_hr_learning_fit.model_recommendation.value}")
    return "\n".join(parts) or "Education analysis pending"


def _save_report_docx(target: str, markdown: str, title: str) -> str:
    doc = DocxDocument()
    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = DocxPt(11)
    h = doc.add_heading(f"{title}: {target}", level=0)
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph("CONFIDENTIAL & PROPRIETARY — 2hr Learning (Alpha)").alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_page_break()
    for line in markdown.split("\n"):
        s = line.strip()
        if s.startswith("# "):
            doc.add_heading(s[2:], level=1)
        elif s.startswith("## "):
            doc.add_heading(s[3:], level=2)
        elif s.startswith("### "):
            doc.add_heading(s[4:], level=3)
        elif s.startswith("- ") or s.startswith("* "):
            doc.add_paragraph(s[2:], style="List Bullet")
        elif s.startswith("|"):
            doc.add_paragraph(s)
        elif s:
            doc.add_paragraph(s)
    output_dir = os.path.join(OUTPUT_DIR, target.lower().replace(" ", "_"))
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{target.replace(' ', '_')}_strategy_report.docx")
    doc.save(path)
    return path
