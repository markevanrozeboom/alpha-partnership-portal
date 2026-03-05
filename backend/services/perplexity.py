"""Perplexity Sonar Deep Research API client."""

from __future__ import annotations

import logging
import httpx

from config import PERPLEXITY_API_KEY, PERPLEXITY_BASE_URL, PERPLEXITY_MODEL

logger = logging.getLogger(__name__)

_HEADERS = {
    "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
    "Content-Type": "application/json",
}


async def deep_research(query: str, context: str = "") -> dict:
    """Run a Perplexity Sonar Deep Research query.

    Returns a dict with keys: ``answer`` (str) and ``citations`` (list[str]).
    """
    system_msg = (
        "You are a research assistant for 2hr Learning (Alpha), an education "
        "technology company that deploys a complete education operating system "
        "(Timeback, AlphaCore, Guide School, Incept eduLLM). "
        "Provide detailed, data-rich answers with specific numbers, dates, "
        "and source citations. Focus on education systems, economics, "
        "demographics, and regulatory environments."
    )
    if context:
        system_msg += f"\n\nAdditional context:\n{context}"

    payload = {
        "model": PERPLEXITY_MODEL,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": query},
        ],
        "temperature": 0.1,
        "return_citations": True,
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{PERPLEXITY_BASE_URL}/chat/completions",
                headers=_HEADERS,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        answer = data["choices"][0]["message"]["content"]
        citations = data.get("citations", [])
        return {"answer": answer, "citations": citations}

    except Exception as exc:
        logger.error("Perplexity API error: %s", exc)
        return {"answer": "", "citations": [], "error": str(exc)}


async def research_country(country: str) -> dict:
    """Research a country's demographics, economy, education, and regulatory environment."""
    query = (
        f"Provide a comprehensive profile of {country} covering:\n"
        f"1. Demographics: total population, population ages 0-18, growth rate, "
        f"urbanisation rate, median age, median household income, Gini coefficient\n"
        f"2. Economy: GDP, GDP per capita (USD), GDP growth rate, currency, "
        f"FX rate to USD, inflation rate, sovereign wealth fund details, credit rating\n"
        f"3. Education system: K-12 enrolled students, public/private split, "
        f"average public spend per student, average private school tuition, "
        f"premium private school tuition range, teacher count, student-teacher ratio, "
        f"PISA scores, literacy rate, dropout rate, education budget as % of GDP, "
        f"language of instruction, mandatory curriculum subjects\n"
        f"4. Regulatory: Ministry of Education, key regulators, private school licensing process, "
        f"foreign ownership rules for schools, charter school equivalents, PPP framework\n"
        f"5. Political context: government type, head of state, education decision maker, "
        f"national vision plans, education reform priorities\n"
        f"6. Competition: major private school operators, international school chains, "
        f"edtech penetration, market gaps\n"
        f"Provide specific numbers and data wherever possible. Cite all sources."
    )
    return await deep_research(query)


async def research_education(country: str) -> dict:
    """Deep-dive into a country's education system."""
    query = (
        f"Provide a detailed analysis of {country}'s education system:\n"
        f"1. What are the primary pain points in the current system (for students, parents, and government)?\n"
        f"2. What education reforms are currently active or planned? What is the reform budget?\n"
        f"3. What is the government's appetite for foreign education models and PPPs?\n"
        f"4. What prior edtech initiatives have been tried? Which failed and why?\n"
        f"5. What cultural attitudes exist toward education, technology in classrooms, "
        f"and alternative schooling models?\n"
        f"6. What are the biggest market gaps in private education?\n"
        f"7. Brain drain statistics and university admission patterns.\n"
        f"8. How would a model that promises children will love school, learn 2x faster, "
        f"and develop life skills for the AI age be received?\n"
        f"Provide specific data and cite all sources."
    )
    return await deep_research(query)


async def research_us_state(state: str) -> dict:
    """Research a US state's education and ESA/voucher landscape."""
    query = (
        f"Provide a comprehensive profile of {state} (US state) for an education company:\n"
        f"1. Total K-12 enrollment, public and private school breakdown\n"
        f"2. ESA/voucher program details: program name, amount per student, "
        f"number of students currently using vouchers, eligibility criteria, "
        f"regulatory requirements for participating schools\n"
        f"3. Average private school tuition, premium school tuition range\n"
        f"4. Charter school landscape: number of charters, penetration rate, waitlists\n"
        f"5. Homeschool population and trends\n"
        f"6. State education budget, per-pupil spending\n"
        f"7. Regulatory environment for new private schools: licensing, curriculum mandates, "
        f"teacher certification requirements\n"
        f"8. Major private school operators and competitors\n"
        f"9. Demographics: total population, school-age population, median household income, "
        f"income distribution\n"
        f"10. Political landscape for school choice\n"
        f"Provide specific numbers and data. Cite all sources."
    )
    return await deep_research(query)
