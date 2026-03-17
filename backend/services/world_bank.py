"""World Bank Open Data API client for structured economic indicators."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

import httpx

from config import WORLD_BANK_BASE_URL

logger = logging.getLogger(__name__)

# ISO-3166-1 alpha-2 codes for priority countries
COUNTRY_CODES = {
    "saudi arabia": "SAU",
    "qatar": "QAT",
    "singapore": "SGP",
    "switzerland": "CHE",
    "india": "IND",
    "brazil": "BRA",
    "south korea": "KOR",
    "united kingdom": "GBR",
    "nigeria": "NGA",
    "kenya": "KEN",
    "united arab emirates": "ARE",
    "mexico": "MEX",
    "indonesia": "IDN",
    "egypt": "EGY",
    "south africa": "ZAF",
    "chile": "CHL",
    "colombia": "COL",
    "turkey": "TUR",
    "malaysia": "MYS",
    "thailand": "THA",
    "vietnam": "VNM",
    "philippines": "PHL",
    "pakistan": "PAK",
    "bangladesh": "BGD",
    "japan": "JPN",
    "germany": "DEU",
    "france": "FRA",
    "canada": "CAN",
    "australia": "AUS",
    "china": "CHN",
    "kuwait": "KWT",
    "bahrain": "BHR",
    "oman": "OMN",
    "jordan": "JOR",
    "morocco": "MAR",
    "tunisia": "TUN",
    "ghana": "GHA",
    "rwanda": "RWA",
    "ethiopia": "ETH",
    "tanzania": "TZA",
}

# World Bank indicator codes
INDICATORS = {
    "gdp": "NY.GDP.MKTP.CD",
    "gdp_per_capita": "NY.GDP.PCAP.CD",
    "gdp_growth": "NY.GDP.MKTP.KD.ZG",
    "population": "SP.POP.TOTL",
    "population_0_14": "SP.POP.0014.TO",
    "population_growth": "SP.POP.GROW",
    "urbanization": "SP.URB.TOTL.IN.ZS",
    "gini": "SI.POV.GINI",
    "inflation": "FP.CPI.TOTL.ZG",
    "literacy": "SE.ADT.LITR.ZS",
    "education_spend_pct_gdp": "SE.XPD.TOTL.GD.ZS",
    "school_enrollment_primary": "SE.PRM.ENRR",
    "school_enrollment_secondary": "SE.SEC.ENRR",
    "pupil_teacher_ratio_primary": "SE.PRM.ENRL.TC.ZS",
    "govt_spend_per_student_primary": "SE.XPD.PRIM.PC.ZS",
}


async def _fetch_indicator(
    country_code: str, indicator: str, most_recent: int = 5
) -> Optional[float]:
    """Fetch a single World Bank indicator, returning the most recent non-null value."""
    url = f"{WORLD_BANK_BASE_URL}/country/{country_code}/indicator/{indicator}"
    params = {
        "format": "json",
        "per_page": most_recent,
        "mrv": most_recent,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        if len(data) < 2 or not data[1]:
            return None

        # Return the most recent non-null value
        for record in data[1]:
            if record.get("value") is not None:
                return float(record["value"])
        return None

    except Exception as exc:
        logger.warning("World Bank API error for %s/%s: %s", country_code, indicator, exc)
        return None


async def get_country_data(country_name: str) -> dict:
    """Fetch key economic and demographic indicators for a country.

    Returns a dict with indicator names as keys and float values (or None).
    All indicators are fetched concurrently to minimize latency.
    """
    code = COUNTRY_CODES.get(country_name.lower())
    if not code:
        logger.warning("No ISO code for '%s', skipping World Bank data.", country_name)
        return {}

    names = list(INDICATORS.keys())
    values = await asyncio.gather(
        *[_fetch_indicator(code, INDICATORS[name]) for name in names]
    )
    return dict(zip(names, values))
