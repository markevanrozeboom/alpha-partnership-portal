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
        async with httpx.AsyncClient(timeout=300.0) as client:
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
        f"I am a senior investment bank research analyst preparing a comprehensive "
        f"country profile for {country} as part of a $1B+ education partnership evaluation. "
        f"Provide an EXHAUSTIVE profile covering ALL of the following with SPECIFIC NUMBERS "
        f"and CITED SOURCES:\n\n"
        f"**DEMOGRAPHICS & SOCIAL:**\n"
        f"- Total population (latest), population growth rate, population by age cohort "
        f"(0-4, 5-14, 15-18, 19-24), % under 18, median age\n"
        f"- Urbanisation rate and trend, major cities by population\n"
        f"- Median household income, income distribution by quintile, Gini coefficient\n"
        f"- UHNW, HNW, affluent, upper-middle, middle class population estimates\n"
        f"- Fertility rate, life expectancy\n\n"
        f"**ECONOMY:**\n"
        f"- Nominal GDP (USD), GDP per capita (nominal and PPP)\n"
        f"- Real GDP growth (last 5 years and forecast next 3 years)\n"
        f"- Inflation rate, unemployment rate, youth unemployment\n"
        f"- Current account balance, government debt (% GDP), fiscal balance\n"
        f"- Sovereign credit rating (Moody's, S&P, Fitch)\n"
        f"- Currency, FX rate to USD, 5-year FX trend\n"
        f"- FDI inflows (annual), top FDI sectors\n"
        f"- Sovereign wealth fund(s): name, AUM, mandate, education investments\n"
        f"- Major economic diversification plans\n\n"
        f"**EDUCATION SYSTEM:**\n"
        f"- Total K-12 students, schools, teachers\n"
        f"- Public vs private school split (% students, % schools)\n"
        f"- Government education budget ($, % of GDP, % of govt spending)\n"
        f"- Per-student public spend, per-student private spend\n"
        f"- Private school tuition ranges by segment (budget, mid, premium, ultra-premium)\n"
        f"- PISA scores (reading, math, science) with global rankings\n"
        f"- TIMSS scores, literacy rate, numeracy rate\n"
        f"- Net enrollment (primary, secondary), dropout rate, completion rate\n"
        f"- Student-teacher ratio, teacher qualification distribution\n"
        f"- Language of instruction, curriculum framework\n"
        f"- Private education market size ($), growth rate\n\n"
        f"**REGULATORY:**\n"
        f"- Ministry of Education structure and key officials (by name)\n"
        f"- Private school licensing: process, timeline, requirements, capital requirements\n"
        f"- Foreign ownership rules for education businesses\n"
        f"- Curriculum requirements for private schools\n"
        f"- Teacher certification requirements\n"
        f"- Tax treatment of education businesses\n"
        f"- PPP/charter framework if any\n\n"
        f"**POLITICAL:**\n"
        f"- Government type, head of state, key education decision-makers\n"
        f"- Political stability index, corruption perception index\n"
        f"- National vision plans relevant to education\n"
        f"- Education reform priorities and budget\n\n"
        f"**COMPETITIVE LANDSCAPE:**\n"
        f"- Major private school operators (at least 8-10): name, schools, students, tuition, curriculum\n"
        f"- International school chains present\n"
        f"- EdTech companies and penetration\n"
        f"- Major market gaps and unmet demand\n\n"
        f"Provide ALL data with specific numbers, years, and source citations."
    )
    return await deep_research(query)


async def research_education(country: str) -> dict:
    """Deep-dive into a country's education system."""
    query = (
        f"I am a McKinsey senior partner analysing the education system of {country} "
        f"for a major international education partnership evaluation. Provide an EXHAUSTIVE "
        f"analysis covering ALL of the following with SPECIFIC DATA and SOURCES:\n\n"
        f"**SYSTEM ARCHITECTURE:**\n"
        f"- Detailed structure: primary, middle, secondary (ages, grades, duration)\n"
        f"- Curriculum framework details: national curriculum name, mandatory subjects, "
        f"assessment methods, grading system\n"
        f"- Available international curricula (IB, Cambridge, AP): number of schools, students\n"
        f"- School calendar, school hours, typical school day structure\n"
        f"- Governance: centralised vs decentralised, ministry structure\n\n"
        f"**LEARNING OUTCOMES:**\n"
        f"- PISA scores with trend (improving/declining), rankings, comparison to economic peers\n"
        f"- TIMSS results if available\n"
        f"- Literacy and numeracy rates by age group\n"
        f"- Equity gaps: urban vs rural, rich vs poor, male vs female performance gaps\n"
        f"- Spend-per-PISA-point efficiency analysis\n"
        f"- University enrollment rates, top university placement stats\n\n"
        f"**STAKEHOLDER PAIN POINTS:**\n"
        f"- Student pain points: engagement, mental health, skills gaps, long hours, rote learning\n"
        f"- Parent pain points: quality concerns, affordability, university prep, safety, teacher quality\n"
        f"- Government pain points: fiscal pressure, teacher shortages, outcome gaps, global competitiveness\n"
        f"- Employer pain points: skills mismatch, workforce readiness, youth unemployment data\n\n"
        f"**REFORM LANDSCAPE:**\n"
        f"- ALL active and recent education reforms: name, budget, timeline, status, outcomes\n"
        f"- Government appetite for innovation and foreign partnerships\n"
        f"- International education partnerships and their results\n"
        f"- EdTech initiatives (government and private): what was tried, what worked, what failed\n"
        f"- UNESCO/World Bank education programs active in country\n\n"
        f"**PRIVATE EDUCATION MARKET:**\n"
        f"- Market size ($), CAGR, segments\n"
        f"- Premium international schools: list, tuition, waitlists, expansion plans\n"
        f"- Parent willingness to pay: by income segment, decision factors\n"
        f"- Unmet demand: waitlists, underserved segments, geographic gaps\n"
        f"- Teacher workforce: qualification levels, salary ranges, satisfaction, shortages\n\n"
        f"**TECHNOLOGY READINESS:**\n"
        f"- Internet penetration, mobile penetration, device-to-student ratios\n"
        f"- School internet connectivity, digital infrastructure\n"
        f"- AI policy for education, data privacy laws\n"
        f"- EdTech adoption rates, teacher digital literacy\n\n"
        f"**CULTURAL CONTEXT:**\n"
        f"- Attitudes toward education innovation and technology in classrooms\n"
        f"- Attitude toward foreign education models\n"
        f"- Religious/cultural education requirements\n"
        f"- Role of education in social mobility and national identity\n\n"
        f"Provide ALL data with specific numbers, years, and source citations."
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
