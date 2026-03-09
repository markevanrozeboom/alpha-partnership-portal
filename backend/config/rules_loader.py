"""Load business rules, tier definitions, scaling formulas from YAML configs.

These rules come from the EduPitch specification and are non-negotiable.
Source: AI-Builder-Team/2hr_Learning_Global_Expansion/config/
"""

from __future__ import annotations

import os
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
def load_country_tiers() -> dict:
    """Load tier 1/2/3 classification criteria and deal-structure defaults."""
    path = RULES_DIR / "country_tiers.yaml"
    if path.exists():
        return yaml.safe_load(path.read_text(encoding="utf-8"))
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


def get_esa_data(state: str) -> dict:
    """Get ESA/voucher data for a specific US state."""
    rules = load_us_state_rules()
    esa_data = rules.get("esa_data", {})
    # Try exact match, then normalized
    key = state.replace(" ", "_")
    return esa_data.get(state, esa_data.get(key, {}))


def classify_tier(
    country: str | None = None,
    gdp_per_capita: float | None = None,
    population: float | None = None,
) -> int | None:
    """Classify a country into tier 1, 2, or 3.

    First checks if the country is explicitly listed in country_tiers.yaml,
    then falls back to GDP-per-capita thresholds.
    """
    tiers = load_country_tiers()

    # Check explicit country lists first
    if country:
        country_lower = country.lower().strip()
        for tier_num in (1, 2, 3):
            tier_data = tiers.get(f"tier_{tier_num}", {})
            countries = [c.lower() for c in tier_data.get("countries", [])]
            if country_lower in countries:
                return tier_num

    # Fall back to GDP thresholds
    if gdp_per_capita is not None:
        t1 = tiers.get("tier_1", {}).get("criteria", {})
        t3 = tiers.get("tier_3", {}).get("criteria", {})

        if gdp_per_capita >= t1.get("gdp_per_capita_min", 30000):
            return 1
        elif gdp_per_capita < t3.get("gdp_per_capita_max", 10000):
            return 3
        else:
            return 2

    return None


def get_tier_defaults(tier: int) -> dict:
    """Get default deal structure values for a tier."""
    tiers = load_country_tiers()
    tier_key = f"tier_{tier}"
    tier_data = tiers.get(tier_key, {})
    return {
        "name": tier_data.get("name", "Unknown"),
        "description": tier_data.get("description", ""),
        "deal_structure": tier_data.get("deal_structure", {}),
        "demand_factor": tier_data.get("demand_factor", 0.5),
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
        "upfront_ip_min_usd": ur.get("upfront_ip_fee", {}).get("minimum_usd", 25_000_000),
        "mgmt_fee_prepayment_min_years": ur.get("management_fee_prepayment", {}).get("minimum_years", 2),
        "min_school_types": ur.get("school_types", {}).get("minimum", 2),
    }
