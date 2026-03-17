"""Load business rules, unified deal model, and scaling formulas from YAML configs.

Post-workshop (March 16, 2026): Tier classification system REMOVED.
One unified model for all countries. Fixed pricing. No PPP scaling.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

RULES_DIR = Path(__file__).parent / "rules"


@lru_cache(maxsize=1)
def load_business_rules() -> dict:
    """Load universal deal-structure rules (non-negotiable)."""
    path = RULES_DIR / "business_rules.yaml"
    if path.exists():
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    return {}


@lru_cache(maxsize=1)
def load_unified_model() -> dict:
    """Load the unified country deal model (replaces old tier system)."""
    path = RULES_DIR / "country_tiers.yaml"
    if path.exists():
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return data.get("unified_model", {})
    return {}


@lru_cache(maxsize=1)
def load_scaling_formulas() -> dict:
    """Load scaling formulas for headline numbers."""
    path = RULES_DIR / "scaling_formulas.yaml"
    if path.exists():
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    return {}


@lru_cache(maxsize=1)
def load_us_state_rules() -> dict:
    """Load US state-specific rules, ESA data, and school type definitions."""
    path = RULES_DIR / "us_state_rules.yaml"
    if path.exists():
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    return {}


@lru_cache(maxsize=1)
def load_proposal_structure() -> dict:
    """Load proposal/deck output structure requirements."""
    path = RULES_DIR / "proposal_structure.yaml"
    if path.exists():
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    return {}


@lru_cache(maxsize=1)
def load_k12_spending_spotlight() -> dict:
    """Load K-12 Spending Spotlight data (Reason Foundation, 2002-2023).

    Contains per-pupil spending, enrollment, teacher salaries, NAEP scores,
    staffing, benefit spending, and national trends for all 50 states + DC.
    Source: https://spending-spotlight.reason.org
    """
    path = RULES_DIR / "k12_spending_spotlight.yaml"
    if path.exists():
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    return {}


def get_state_spending_data(state: str) -> dict:
    """Get K-12 spending data for a specific US state from Spending Spotlight."""
    data = load_k12_spending_spotlight()
    state_data = data.get("state_data", {})
    key = state.replace(" ", "_")
    return state_data.get(state, state_data.get(key, {}))


def get_spending_spotlight_national_trends() -> dict:
    """Get national K-12 spending trends from Spending Spotlight."""
    data = load_k12_spending_spotlight()
    return data.get("national_trends", {})


def get_spending_spotlight_alpha_insights() -> dict:
    """Get Alpha-specific insights derived from Spending Spotlight data."""
    data = load_k12_spending_spotlight()
    return data.get("alpha_insights", {})


def get_esa_data(state: str) -> dict:
    """Get ESA/voucher data for a specific US state."""
    rules = load_us_state_rules()
    esa_data = rules.get("esa_data", {})
    key = state.replace(" ", "_")
    return esa_data.get(state, esa_data.get(key, {}))


# =========================================================================
# Unified Deal Model Accessors (replaces old tier system)
# =========================================================================

def get_deal_structure() -> dict:
    """Return the unified deal structure for all countries.

    No tiers. One model. Fixed pricing.
    """
    model = load_unified_model()
    return {
        "name": model.get("name", "Alpha Education Partnership"),
        "description": model.get("description", ""),
        "equity_structure": model.get("equity_structure", {}),
        "prong_1_flagship": model.get("prong_1_flagship", {}),
        "prong_2_national": model.get("prong_2_national", {}),
        "fee_structure": model.get("fee_structure", {}),
        "upfront_fees": model.get("upfront_fees", {}),
        "prepaid_fees": model.get("prepaid_fees", {}),
    }


def get_flagship_tuition_range() -> tuple[int, int]:
    """Return the min/max flagship tuition range ($40K-$100K)."""
    model = load_unified_model()
    prong_1 = model.get("prong_1_flagship", {})
    return (
        prong_1.get("tuition_min", 40_000),
        prong_1.get("tuition_max", 100_000),
    )


def get_national_per_student_budget() -> int:
    """Return the FIXED per-student budget for national schools ($25K)."""
    model = load_unified_model()
    prong_2 = model.get("prong_2_national", {})
    return prong_2.get("per_student_budget", 25_000)


def get_min_student_year_commit() -> int:
    """Return the minimum student-year commitment (100K)."""
    model = load_unified_model()
    prong_2 = model.get("prong_2_national", {})
    return prong_2.get("min_student_year_commit", 100_000)


def get_fixed_development_costs() -> dict:
    """Return the FIXED upfront development costs (not country-scaled)."""
    model = load_unified_model()
    upfront = model.get("upfront_fees", {})
    return {
        "alphacore_license": upfront.get("alphacore_license", 250_000_000),
        "edtech_app_content_rd": upfront.get("edtech_app_content_rd", 250_000_000),
        "lifeskills_rd": upfront.get("lifeskills_rd", 250_000_000),
        "total": upfront.get("total_fixed_development", 750_000_000),
    }


def get_three_commitments() -> list[str]:
    """Return the three non-negotiable Alpha commitments."""
    rules = load_business_rules()
    return rules.get("universal_rules", {}).get("three_commitments", [
        "Children will love school",
        "Children will learn 2x faster",
        "Children will develop life skills for the AI age",
    ])


def get_fee_floors() -> dict:
    """Return non-negotiable fee floor percentages."""
    rules = load_business_rules()
    ur = rules.get("universal_rules", {})
    return {
        "management_fee_floor_pct": ur.get("management_fee", {}).get("floor_percent", 0.10),
        "timeback_license_floor_pct": ur.get("timeback_license_fee", {}).get("floor_percent", 0.20),
        "management_fee_floor_per_student": ur.get("management_fee", {}).get("floor_per_student", 2_500),
        "timeback_fee_floor_per_student": ur.get("timeback_license_fee", {}).get("floor_per_student", 5_000),
        "upfront_ip_min_usd": ur.get("upfront_ip_fee", {}).get("minimum_usd", 25_000_000),
        "mgmt_fee_prepayment_min_years": ur.get("management_fee_prepayment", {}).get("minimum_years", 2),
        "min_school_types": ur.get("school_types", {}).get("minimum", 2),
    }


# =========================================================================
# DEPRECATED — kept as stubs for backward compatibility during migration
# These will be removed once all agents are updated.
# =========================================================================

def classify_tier(
    country: str | None = None,
    gdp_per_capita: float | None = None,
    population: float | None = None,
) -> None:
    """DEPRECATED: Tier classification removed per workshop decision (March 16, 2026).

    All countries use the unified model. Returns None always.
    """
    return None


def get_tier_defaults(tier: int) -> dict:
    """DEPRECATED: Tier defaults removed. Returns unified deal structure instead."""
    deal = get_deal_structure()
    return {
        "name": deal.get("name", "Unified Model"),
        "description": deal.get("description", ""),
        "deal_structure": deal,
        "demand_factor": 1.0,  # No longer tier-dependent
    }


# Keep old load function name for backward compat, but it now loads unified model
def load_country_tiers() -> dict:
    """DEPRECATED: Returns unified model wrapped in old format for backward compat."""
    path = RULES_DIR / "country_tiers.yaml"
    if path.exists():
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    return {}
