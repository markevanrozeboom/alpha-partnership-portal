"""Strategy Agent — produces McKinsey/VC quality 15-20 page market-entry strategy.

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
  JV with AsasOne (local cultural IP layer), Emirati Guide cohort
- **Revenue model**: Management fees (10% school revenue), Timeback License (20% per-student
  budget), upfront IP fee ($25M+), Guide School fees
- **Fee floor**: Minimum $15K per student

## Country & Education Context
{country_context}

{education_context}

## Write EXACTLY these sections:

# Market Entry Strategy: {target}

## 1. Executive Summary
Write 6-8 paragraphs covering:
- The strategic opportunity in {target} (quantified)
- Recommended entry mode and partnership structure
- Proposed deal parameters (commitment size, student count, per-student budget)
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
| Blended revenue per student | ... | ... | PPP-adjusted |
| **Total TAM** | **$...** | ... | ... |

### 2.2 Serviceable Market
Create SAM table:

| Filter | Students | Revenue | Rationale |
|--------|----------|---------|-----------|
| Income-qualified | ... | ... | ... |
| Geographically accessible | ... | ... | ... |
| Innovation-receptive | ... | ... | ... |
| Regulatory-feasible | ... | ... | ... |
| **SAM** | **...** | **$...** | ... |

### 2.3 Penetration Scenarios
Create scenarios table:

| Scenario | Market Share | Students (Yr 5) | Revenue (Yr 5) | Commitment Ask | Assumptions |
|----------|-------------|-----------------|-----------------|---------------|-------------|
| Conservative | ...% | ... | $... | $... | ... |
| Base Case | ...% | ... | $... | $... | ... |
| Aggressive | ...% | ... | $... | $... | ... |

### 2.4 Comparison to UAE Benchmark

| Dimension | UAE Deal | {target} (Proposed) | Scaling Factor | Rationale |
|-----------|---------|-------------------|---------------|-----------|
| Population | 10M | ... | ... | ... |
| GDP/Capita | $44K | ... | ... | ... |
| Student Commitment | 200K | ... | ... | ... |
| Per-Student Budget | $25K | ... | PPP-adjusted | ... |
| Upfront Commitment | $1.5B | ... | ... | ... |
| JV Structure | 51/49 | ... | ... | ... |

Write 5-6 paragraphs on market sizing methodology, key assumptions, and why the numbers
are achievable based on the country research.

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

### 4.2 JV Structure Design
Based on the AsasOne model from the UAE deal:

| Structural Element | UAE (AsasOne) | {target} (Proposed) | Rationale |
|-------------------|---------------|-------------------|-----------|
| Entity Name | Ed71 / Next71 | ... (suggest 2-3 options) | ... |
| Ownership Split | Alpha 49% / Local 51% | ... | ... |
| Board Composition | ... | ... | ... |
| IP Ownership | Alpha retains core IP | ... | ... |
| Cultural IP Layer | AsasOne | ... | ... |
| Management Control | Alpha operational control | ... | ... |
| Revenue Distribution | ... | ... | ... |
| Exit Mechanism | ... | ... | ... |
| Non-Compete | ... | ... | ... |
| Dispute Resolution | ... | ... | ... |

Write 5-6 paragraphs on the partnership structure rationale, governance design,
IP protection strategy, and cultural IP layer development.

### 4.3 Cultural IP Layer Design
How to localise Alpha's model while preserving national identity, cultural values,
and local curriculum requirements. Reference the AsasOne approach.

**🎯 Strategic Priority:** The local entity name and structure is critical for political buy-in.

## 5. Brand & Positioning

### 5.1 Brand Architecture
Suggest 3-4 JV entity names (following the Ed71/Next71 naming pattern):

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
| Parents (Affluent) | ... | ... | ... |
| Parents (Middle Class) | ... | ... | ... |
| Students | ... | ... | ... |
| Teachers | ... | ... | ... |
| Media | ... | ... | ... |

Write 3-4 paragraphs on brand positioning strategy.

## 6. School Type Portfolio

### 6.1 Recommended School Types
Create a detailed table for each school type:

| Dimension | Flagship Premium | Innovation Academy | Community School | Specialised (STEM/Arts) |
|-----------|-----------------|-------------------|-----------------|----------------------|
| Target Segment | Top 5% income | Top 15% income | Top 30% income | Talent-identified |
| Annual Tuition | $... | $... | $... | $... (subsidised) |
| Capacity | ... students | ... students | ... students | ... students |
| Location Type | CBD/Prime | Suburban | Urban fringe | Various |
| Curriculum Mix | 2hr core + specialisations | ... | ... | ... |
| Teacher Model | All Guides | Mix | ... | ... |
| Physical Model | Premium campus | Modern | Efficient | Purpose-built |
| Technology | Full Timeback + eduLLM | Full Timeback | Timeback | Full suite |
| Year 1 Target | ... schools | ... schools | ... schools | ... schools |
| Year 5 Target | ... schools | ... schools | ... schools | ... schools |

Write 4-5 paragraphs on the portfolio strategy, pricing rationale (PPP-adjusted),
sequencing, and how each type serves a different market need.

### 6.2 Pricing Strategy
PPP-adjusted pricing analysis with comparison to local competitors and the UAE benchmark.

**🎯 Strategic Priority:** Pricing must be above the $15K floor while being competitive locally.

## 7. Phased Rollout Plan

### 7.1 Five-Year Rollout

| Phase | Timeline | Schools | Students | Revenue | Key Milestones | Decision Gate |
|-------|----------|---------|----------|---------|---------------|--------------|
| Pre-Launch | M1-M12 | 0 | 0 | $0 | ... | Go/No-Go |
| Phase 1: Flagship | Yr 1 | ... | ... | $... | ... | Phase 2 approval |
| Phase 2: Expansion | Yr 2-3 | ... | ... | $... | ... | Phase 3 approval |
| Phase 3: Scale | Yr 4-5 | ... | ... | $... | ... | Continuation |
| **Total** | **5 years** | **...** | **...** | **$...** | ... | ... |

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

**🎯 Strategic Priority:** Phase 1 flagship success is the make-or-break moment.

IMPORTANT: Minimum 3,000 words. Specific, actionable, investment-thesis quality."""

SECTION_3_PROMPT = """You are completing the McKinsey/Goldman strategy report for **{target}**.
Writing sections 8-12 (final sections).

## Country & Education Context
{country_context}

{education_context}

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
- Premium experience at competitive price points
- University placement outcomes

### 8.3 Investor Value Proposition
Write 3-4 paragraphs covering:
- Returns thesis (IRR, MOIC expectations)
- Capital deployment efficiency
- Recurring revenue model
- Scale optionality (domestic expansion + regional)
- Exit pathways (IPO, strategic sale, sovereign buyout)

Create a value proposition summary table:

| Stakeholder | Primary Value | Secondary Value | Evidence/Proof | Risk |
|-------------|-------------|----------------|---------------|------|
| Head of State | ... | ... | ... | ... |
| Education Minister | ... | ... | ... | ... |
| Finance Minister | ... | ... | ... | ... |
| Sovereign Fund | ... | ... | ... | ... |
| Parents | ... | ... | ... | ... |
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
| Upfront Commitment | $1.5B | $... | ... |
| Per-Student Budget | $25K | $... | PPP-adjusted |
| Student Count (5yr) | 200K | ... | ... |
| IP Development Fee | $25M | $... | ... |
| Management Fee | 10% | 10% | Non-negotiable |
| Timeback License | 20% | 20% | Non-negotiable |
| JV Ownership | 49/51 | ... | ... |
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

TIER_23_PROMPT = """You are a senior partner at McKinsey & Company advising Alpha Holdings
(2hr Learning) on a market entry into **{target}**.

This is a **Tier {tier}** country — NOT a Tier 1 sovereign deal. Alpha's Group CFO has directed
that for Tier 2/3 countries the strategy should focus on ONE question:

**How many 25,000-student cohorts could the government (or private sector) realistically support?**

Each cohort = 25,000 students at $25K/student budget (PPP-adjusted to ${ppp_adjusted_budget:,.0f}).

## About Alpha / 2hr Learning
- Timeback: AI compresses core academics into 2 hours/day
- Three commitments: Children love school | Learn 2x faster | Future-ready skills
- UAE reference: $1.5B upfront, 200K students (= 8 cohorts of 25K), $25K/student
- Revenue model: 10% management fee, 20% Timeback license, upfront IP fee
- Fee floor: $15K/student minimum

## Country Context
{country_context}

## Education Context
{education_context}

## Write EXACTLY these sections:

# {target} — Cohort-Based Proposal

## 1. Executive Summary
- This is a Tier {tier} opportunity with a cohort-based deal structure
- Each cohort = 25,000 students at ${ppp_adjusted_budget:,.0f}/student (PPP-adjusted)
- Total commitment = # cohorts × 25,000 × ${ppp_adjusted_budget:,.0f}

## 2. Demand Analysis: How Many 25K Cohorts?

### 2.1 Government-Funded Pathway
Assess the government's capacity to fund 25K-student cohorts:
- Current education budget and spend per student
- Appetite for large-scale education reform
- Fiscal headroom (% of GDP spent on education vs regional peers)
- Existing public-private partnership precedent
- Political will for 2hr Learning model

| Cohort | Funding Source | Students | Per-Student Budget | Total Commitment | Feasibility |
|--------|--------------|----------|-------------------|-----------------|-------------|
| Gov Cohort 1 | ... | 25,000 | ... | ... | High/Med/Low |
| Gov Cohort 2 | ... | 25,000 | ... | ... | High/Med/Low |
| ... | ... | ... | ... | ... | ... |

### 2.2 Private-Sector Pathway
Assess the private market's capacity for 25K-student cohorts:
- Size of affluent / upper-middle-class families
- Current private school penetration and tuition levels
- Demand for premium / innovation-driven education
- Ability for private operators or investors to fund cohorts

| Cohort | Funding Source | Students | Per-Student Budget | Total Commitment | Feasibility |
|--------|--------------|----------|-------------------|-----------------|-------------|
| Private Cohort 1 | ... | 25,000 | ... | ... | High/Med/Low |
| Private Cohort 2 | ... | 25,000 | ... | ... | High/Med/Low |
| ... | ... | ... | ... | ... | ... |

### 2.3 Combined Proposal
Total realistic cohorts and deal size:

| Pathway | Cohorts | Students | Commitment | Confidence |
|---------|---------|----------|-----------|------------|
| Government | ... | ... | $... | ...% |
| Private | ... | ... | $... | ...% |
| **Total** | **...** | **...** | **$...** | ... |

## 3. Deal Structure
- Entry mode: {entry_recommendation}
- Partnership: Licensing or lightweight JV (no heavy local entity)
- Alpha management fee: 10%
- Timeback license: 20%
- Upfront IP fee: scaled to # cohorts
- Phased rollout: 1 cohort in Year 1, scale based on results

## 4. Financial Summary (Per Cohort)

| Metric | Per Cohort | Notes |
|--------|-----------|-------|
| Students | 25,000 | Fixed cohort size |
| Per-Student Budget | ${ppp_adjusted_budget:,.0f} | PPP-adjusted from $25K |
| Total Revenue | ${cohort_revenue:,.0f} | 25K × budget |
| Alpha Mgmt Fee (10%) | ${mgmt_fee:,.0f} | Per year |
| Timeback License (20%) | ${timeback_fee:,.0f} | Per year |
| Alpha Total Revenue/yr | ${alpha_rev:,.0f} | Combined |

## 5. Key Asks
List 5-6 specific asks from the government / private partner.

## 6. Risks & Considerations
Key risks specific to this Tier {tier} market.

IMPORTANT: Be realistic about the number of cohorts. Don't over-promise.
Data-driven. This will be reviewed by the Group CFO."""

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

    # --- Structured strategy ---
    try:
        strategy: Strategy = await call_llm(
            system_prompt="You are a VC/McKinsey strategist. Produce a structured strategy.",
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

    # --- Determine tier for routing ---
    tier = country_profile.target.tier if country_profile.target.tier else None
    is_tier_23 = tier is not None and tier in (2, 3) and country_profile.target.type == TargetType.SOVEREIGN_NATION

    # --- Narrative report ---
    if feedback and previous_report:
        report_md = await call_llm_plain(
            system_prompt=REPORT_REVISION_PROMPT.format(
                original_report=previous_report, feedback=feedback
            ),
            user_prompt=f"Revise the strategy for {target}.",
        )
    elif is_tier_23:
        # Tier 2/3: cohort-based proposal
        gdp_cap = country_profile.economy.gdp_per_capita or 15_000
        ppp_adjusted = max(15_000, round(25_000 * max(0.3, min(2.0, gdp_cap / 50_000)) / 500) * 500)
        cohort_rev = 25_000 * ppp_adjusted
        mgmt_fee = round(cohort_rev * 0.10)
        timeback_fee = round(cohort_rev * 0.20)
        alpha_rev = mgmt_fee + timeback_fee
        entry_rec = entry_mode.value if entry_mode else "licensing or lightweight JV"

        logger.info("Generating Tier %s cohort-based strategy for %s", tier, target)
        report_md = await call_llm_plain(
            system_prompt=TIER_23_PROMPT.format(
                target=target, tier=tier,
                ppp_adjusted_budget=ppp_adjusted,
                cohort_revenue=cohort_rev,
                mgmt_fee=mgmt_fee,
                timeback_fee=timeback_fee,
                alpha_rev=alpha_rev,
                entry_recommendation=entry_rec,
                country_context=country_ctx,
                education_context=education_ctx,
            ),
            user_prompt=f"Produce the cohort-based strategy for {target}.",
        )
    else:
        # Tier 1 / US State: full strategy
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
    if p.target.tier:
        parts.append(f"- Tier: {p.target.tier}")
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
