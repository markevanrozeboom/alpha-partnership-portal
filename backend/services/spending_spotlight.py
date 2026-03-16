"""Spending Spotlight Live Data Feed — auto-refreshes K-12 spending data.

Pulls the latest data from Reason Foundation's Spending Spotlight
(https://spending-spotlight.reason.org) and updates the local YAML
knowledge base.

Strategy:
  1. Scrape the website for embedded data (JSON in script tags / SSR HTML)
  2. Fallback: use Perplexity to research the latest per-state data
  3. Parse structured data via LLM
  4. Validate & merge with existing data (only update if newer)
  5. Write to YAML and clear the loader cache

The data updates annually (NCES releases school finance data ~2 years
after the school year ends), so a weekly check is more than sufficient.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import yaml

from config import PERPLEXITY_API_KEY
from services.perplexity import multi_mode_research, ResearchMode
from services.llm import call_llm_plain

logger = logging.getLogger(__name__)

YAML_PATH = Path(__file__).resolve().parent.parent / "config" / "rules" / "k12_spending_spotlight.yaml"
SPOTLIGHT_URL = "https://spending-spotlight.reason.org"
SPOTLIGHT_DATA_URL = "https://spending-spotlight.reason.org/data"

# All 50 states + DC in the format used by the YAML keys
ALL_STATES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
    "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
    "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
    "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
    "New_Hampshire", "New_Jersey", "New_Mexico", "New_York",
    "North_Carolina", "North_Dakota", "Ohio", "Oklahoma", "Oregon",
    "Pennsylvania", "Rhode_Island", "South_Carolina", "South_Dakota",
    "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
    "West_Virginia", "Wisconsin", "Wyoming", "District_of_Columbia",
]

# Tracking last successful refresh to avoid redundant calls
_last_refresh: datetime | None = None
_refresh_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# 1. Direct website scraping (primary)
# ---------------------------------------------------------------------------

async def _scrape_spotlight_data() -> dict[str, dict] | None:
    """Try to scrape structured data from the Spending Spotlight website.

    The site is a JS SPA, so we look for:
      - Embedded JSON in <script> tags (common for Next.js / Gatsby)
      - Pre-rendered data in __NEXT_DATA__ or similar
      - Direct API endpoints linked from the page
    Returns state_data dict or None if scraping fails.
    """
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (compatible; AlphaEduBot/1.0; "
                    "+https://2hrlearning.com)"
                ),
            },
        ) as client:
            # Try the main page first
            resp = await client.get(SPOTLIGHT_URL)
            resp.raise_for_status()
            html = resp.text

            # Look for __NEXT_DATA__ (Next.js SSR)
            next_data = _extract_next_data(html)
            if next_data:
                logger.info("Found __NEXT_DATA__ on Spending Spotlight main page")
                return _parse_next_data(next_data)

            # Try the /data page
            resp2 = await client.get(SPOTLIGHT_DATA_URL)
            if resp2.status_code == 200:
                html2 = resp2.text
                next_data2 = _extract_next_data(html2)
                if next_data2:
                    logger.info("Found __NEXT_DATA__ on Spending Spotlight /data page")
                    return _parse_next_data(next_data2)

            # Look for embedded JSON blobs in script tags
            json_data = _extract_json_blobs(html)
            if json_data:
                logger.info("Found embedded JSON data on Spending Spotlight")
                return json_data

            # Try common API patterns
            for api_path in [
                "/api/states", "/api/data", "/api/spending",
                "/_next/data", "/data.json", "/states.json",
            ]:
                try:
                    api_resp = await client.get(f"{SPOTLIGHT_URL}{api_path}")
                    if api_resp.status_code == 200:
                        data = api_resp.json()
                        if isinstance(data, (dict, list)) and data:
                            logger.info("Found API data at %s", api_path)
                            return _normalize_api_data(data)
                except Exception:
                    continue

    except Exception as exc:
        logger.warning("Spending Spotlight scraping failed: %s", exc)

    return None


def _extract_next_data(html: str) -> dict | None:
    """Extract __NEXT_DATA__ JSON from Next.js server-rendered pages."""
    pattern = r'<script\s+id="__NEXT_DATA__"\s+type="application/json"[^>]*>(.*?)</script>'
    match = re.search(pattern, html, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    return None


def _extract_json_blobs(html: str) -> dict[str, dict] | None:
    """Look for large JSON objects in <script> tags that might contain state data."""
    script_pattern = r'<script[^>]*>(.*?)</script>'
    for match in re.finditer(script_pattern, html, re.DOTALL):
        content = match.group(1).strip()
        # Look for JSON that contains state education data markers
        if any(marker in content for marker in [
            "per_pupil", "perPupil", "enrollment", "spending",
            "Alabama", "Alaska", "Arizona",
        ]):
            # Try to extract JSON objects/arrays
            for json_match in re.finditer(r'(\{[^{}]{500,}\}|\[[^\[\]]{500,}\])', content):
                try:
                    data = json.loads(json_match.group(1))
                    if _looks_like_state_data(data):
                        return _normalize_api_data(data)
                except (json.JSONDecodeError, ValueError):
                    continue
    return None


def _looks_like_state_data(data: Any) -> bool:
    """Check if a data structure looks like it contains state education data."""
    if isinstance(data, dict):
        keys = set(data.keys())
        state_names = {"Alabama", "Alaska", "Arizona", "California", "Florida", "Texas"}
        if len(keys & state_names) >= 3:
            return True
        if any(k in keys for k in ["states", "stateData", "state_data", "data"]):
            return True
    elif isinstance(data, list) and len(data) >= 40:
        if isinstance(data[0], dict):
            fields = set(data[0].keys())
            if any(f in fields for f in ["state", "stateName", "name", "State"]):
                return True
    return False


def _parse_next_data(next_data: dict) -> dict[str, dict] | None:
    """Extract state data from Next.js __NEXT_DATA__ structure."""
    # Walk the tree looking for state data
    def _walk(obj: Any, depth: int = 0) -> dict | None:
        if depth > 10:
            return None
        if isinstance(obj, dict):
            if _looks_like_state_data(obj):
                return _normalize_api_data(obj)
            for v in obj.values():
                result = _walk(v, depth + 1)
                if result:
                    return result
        elif isinstance(obj, list):
            if _looks_like_state_data(obj):
                return _normalize_api_data(obj)
            for item in obj[:20]:  # Don't recurse too deep into large arrays
                result = _walk(item, depth + 1)
                if result:
                    return result
        return None

    return _walk(next_data)


def _normalize_api_data(data: Any) -> dict[str, dict] | None:
    """Normalize various API data formats into our state_data structure."""
    state_data: dict[str, dict] = {}

    if isinstance(data, list):
        for item in data:
            if not isinstance(item, dict):
                continue
            state_name = (
                item.get("state") or item.get("stateName") or
                item.get("name") or item.get("State") or ""
            )
            if state_name:
                key = state_name.strip().replace(" ", "_")
                state_data[key] = _extract_state_metrics(item)

    elif isinstance(data, dict):
        # Check if keys are state names
        state_names = {"Alabama", "Alaska", "Arizona", "California"}
        if len(set(data.keys()) & state_names) >= 2:
            for state_name, metrics in data.items():
                if isinstance(metrics, dict):
                    key = state_name.strip().replace(" ", "_")
                    state_data[key] = _extract_state_metrics(metrics)
        else:
            # Check nested structures
            for container_key in ["states", "stateData", "state_data", "data"]:
                if container_key in data:
                    return _normalize_api_data(data[container_key])

    return state_data if len(state_data) >= 10 else None


def _extract_state_metrics(raw: dict) -> dict:
    """Map various field names to our canonical schema."""
    field_map = {
        "per_pupil_spending": [
            "per_pupil_spending", "perPupilSpending", "per_pupil",
            "perPupil", "spending_per_student", "totalPerPupil",
            "currentSpendingPerPupil",
        ],
        "k12_enrollment": [
            "k12_enrollment", "enrollment", "totalEnrollment",
            "students", "k12Students", "total_enrollment",
        ],
        "avg_teacher_salary": [
            "avg_teacher_salary", "averageTeacherSalary", "teacher_salary",
            "avgSalary", "teacherSalary", "average_teacher_salary",
        ],
        "spending_rank": [
            "spending_rank", "rank", "spendingRank",
        ],
        "revenue_per_pupil": [
            "revenue_per_pupil", "revenuePerPupil", "totalRevenue",
        ],
        "benefit_spending_per_pupil": [
            "benefit_spending_per_pupil", "benefitSpending", "benefits",
            "benefitsPerPupil",
        ],
        "student_teacher_ratio": [
            "student_teacher_ratio", "studentTeacherRatio", "pupilTeacherRatio",
        ],
        "instructional_spending_pct": [
            "instructional_spending_pct", "instructionalPct",
            "instructionalSpendingPercent",
        ],
        "enrollment_change_2020_2023_pct": [
            "enrollment_change_2020_2023_pct", "enrollmentChange",
            "enrollmentChangePct",
        ],
        "naep_4th_reading_proficient_pct": [
            "naep_4th_reading_proficient_pct", "naep4thReading",
            "naepReading4",
        ],
        "naep_4th_math_proficient_pct": [
            "naep_4th_math_proficient_pct", "naep4thMath", "naepMath4",
        ],
        "naep_8th_reading_proficient_pct": [
            "naep_8th_reading_proficient_pct", "naep8thReading",
            "naepReading8",
        ],
        "naep_8th_math_proficient_pct": [
            "naep_8th_math_proficient_pct", "naep8thMath", "naepMath8",
        ],
    }

    result: dict[str, Any] = {}
    for canonical, aliases in field_map.items():
        for alias in aliases:
            if alias in raw and raw[alias] is not None:
                val = raw[alias]
                if isinstance(val, str):
                    val = val.replace(",", "").replace("$", "").replace("%", "").strip()
                    try:
                        val = float(val)
                        if val == int(val) and canonical != "student_teacher_ratio":
                            val = int(val)
                    except ValueError:
                        continue
                result[canonical] = val
                break

    return result


# ---------------------------------------------------------------------------
# 2. Perplexity-powered research (fallback)
# ---------------------------------------------------------------------------

async def _research_state_data_via_perplexity(states: list[str]) -> dict[str, dict]:
    """Use Perplexity to research latest K-12 spending data for states.

    Processes states in batches of 10 to stay within rate limits.
    """
    result: dict[str, dict] = {}
    batch_size = 10

    for i in range(0, len(states), batch_size):
        batch = states[i:i + batch_size]
        state_names = ", ".join(s.replace("_", " ") for s in batch)

        query = (
            f"Using the latest data from the Reason Foundation's Spending Spotlight "
            f"(https://spending-spotlight.reason.org) and NCES data, provide the "
            f"following K-12 education statistics for these states: {state_names}\n\n"
            f"For EACH state provide these exact metrics (use the most recent year "
            f"available, typically 2022-2023):\n"
            f"1. Per-pupil spending (total current expenditure per student)\n"
            f"2. Total K-12 public school enrollment\n"
            f"3. Average teacher salary\n"
            f"4. Per-pupil spending rank (1=highest, 50=lowest)\n"
            f"5. Revenue per pupil\n"
            f"6. Employee benefit spending per pupil\n"
            f"7. Student-teacher ratio\n"
            f"8. Instructional spending as % of total\n"
            f"9. Enrollment change from 2020 to 2023 (%)\n"
            f"10. NAEP 4th grade reading % at or above proficient\n"
            f"11. NAEP 4th grade math % at or above proficient\n"
            f"12. NAEP 8th grade reading % at or above proficient\n"
            f"13. NAEP 8th grade math % at or above proficient\n\n"
            f"Format the response as a structured list with exact numbers for each "
            f"state. Use the latest available data year for each metric."
        )

        research = await multi_mode_research(query, ResearchMode.RESEARCH)
        answer = research.get("answer", "")

        if answer:
            # Use LLM to parse the research into structured data
            parsed = await _parse_research_to_structured(batch, answer)
            result.update(parsed)

        # Small delay between batches to be respectful
        if i + batch_size < len(states):
            await asyncio.sleep(2)

    return result


async def _parse_research_to_structured(
    states: list[str], research_text: str
) -> dict[str, dict]:
    """Use LLM to parse research text into structured state data dicts."""
    state_names = ", ".join(s.replace("_", " ") for s in states)

    prompt = f"""Parse the following research data and extract structured metrics for each US state.

Research data:
{research_text}

States to extract: {state_names}

For each state, output a JSON object with EXACTLY these keys (use null if not found):
- per_pupil_spending (integer, dollars)
- k12_enrollment (integer)
- avg_teacher_salary (integer, dollars)
- spending_rank (integer, 1=highest)
- revenue_per_pupil (integer, dollars)
- benefit_spending_per_pupil (integer, dollars)
- student_teacher_ratio (float, e.g. 14.5)
- instructional_spending_pct (float, e.g. 52.3)
- enrollment_change_2020_2023_pct (float, e.g. -2.1)
- naep_4th_reading_proficient_pct (integer)
- naep_4th_math_proficient_pct (integer)
- naep_8th_reading_proficient_pct (integer)
- naep_8th_math_proficient_pct (integer)

Return a single JSON object where keys are state names with underscores (e.g. "New_York") and values are the metric objects above.

RESPOND WITH ONLY THE JSON OBJECT, no markdown, no explanation."""

    try:
        response = await call_llm_plain(
            system_prompt="You are a data extraction assistant. Parse research text into structured JSON. Return ONLY valid JSON.",
            user_prompt=prompt,
        )

        # Clean the response — strip markdown code fences if present
        cleaned = response.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
            cleaned = re.sub(r'\s*```$', '', cleaned)

        data = json.loads(cleaned)
        if isinstance(data, dict):
            # Clean up null values and ensure proper types
            for state_key, metrics in data.items():
                if isinstance(metrics, dict):
                    data[state_key] = {
                        k: v for k, v in metrics.items() if v is not None
                    }
            return data
    except (json.JSONDecodeError, Exception) as exc:
        logger.warning("Failed to parse research into structured data: %s", exc)

    return {}


# ---------------------------------------------------------------------------
# 3. YAML update & cache management
# ---------------------------------------------------------------------------

def _load_existing_yaml() -> dict:
    """Load the existing YAML data."""
    if YAML_PATH.exists():
        return yaml.safe_load(YAML_PATH.read_text(encoding="utf-8")) or {}
    return {}


def _save_yaml(data: dict) -> None:
    """Save data back to the YAML file."""
    # Custom representer for cleaner YAML output
    class CleanDumper(yaml.SafeDumper):
        pass

    def _str_representer(dumper: yaml.Dumper, data: str) -> Any:
        if "\n" in data:
            return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=">")
        return dumper.represent_scalar("tag:yaml.org,2002:str", data)

    CleanDumper.add_representer(str, _str_representer)

    yaml_content = yaml.dump(
        data,
        Dumper=CleanDumper,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
        width=120,
    )
    YAML_PATH.write_text(yaml_content, encoding="utf-8")
    logger.info("Spending Spotlight YAML updated at %s", YAML_PATH)


def _clear_loader_cache() -> None:
    """Clear the lru_cache on load_k12_spending_spotlight so new data is picked up."""
    try:
        from config.rules_loader import load_k12_spending_spotlight
        load_k12_spending_spotlight.cache_clear()
        logger.info("Cleared load_k12_spending_spotlight cache")
    except Exception as exc:
        logger.warning("Failed to clear cache: %s", exc)


def _merge_state_data(existing: dict, new: dict) -> tuple[dict, int]:
    """Merge new state data into existing, only overwriting when new data is present.

    Returns (merged_data, num_states_updated).
    """
    updated_count = 0
    for state_key, new_metrics in new.items():
        if not isinstance(new_metrics, dict) or not new_metrics:
            continue
        if state_key not in existing:
            existing[state_key] = new_metrics
            updated_count += 1
        else:
            current = existing[state_key]
            changed = False
            for field, value in new_metrics.items():
                if value is not None and value != current.get(field):
                    current[field] = value
                    changed = True
            if changed:
                updated_count += 1
    return existing, updated_count


# ---------------------------------------------------------------------------
# 4. Public API — refresh the knowledge base
# ---------------------------------------------------------------------------

async def refresh_spending_spotlight(force: bool = False) -> dict:
    """Refresh the K-12 Spending Spotlight data from the live website.

    Args:
        force: If True, skip the cooldown check and always refresh.

    Returns:
        dict with status, states_updated, source, and timestamp.
    """
    global _last_refresh

    # Prevent concurrent refreshes
    async with _refresh_lock:
        # Cooldown: don't refresh more than once per day unless forced
        if not force and _last_refresh:
            elapsed = datetime.now() - _last_refresh
            if elapsed < timedelta(hours=24):
                return {
                    "status": "skipped",
                    "reason": f"Last refresh was {elapsed.seconds // 3600}h ago (cooldown: 24h)",
                    "last_refresh": _last_refresh.isoformat(),
                }

        logger.info("Starting Spending Spotlight data refresh (force=%s)", force)
        source = "none"
        states_updated = 0

        # Load existing data
        existing_yaml = _load_existing_yaml()
        existing_state_data = existing_yaml.get("state_data", {})

        # Strategy 1: Try direct website scraping
        scraped_data = await _scrape_spotlight_data()
        if scraped_data and len(scraped_data) >= 10:
            logger.info("Scraped %d states from website", len(scraped_data))
            existing_state_data, states_updated = _merge_state_data(
                existing_state_data, scraped_data
            )
            source = "website_scrape"

        # Strategy 2: Fallback to Perplexity research
        if states_updated == 0 and PERPLEXITY_API_KEY:
            logger.info("Scraping failed/empty, falling back to Perplexity research")
            try:
                perplexity_data = await _research_state_data_via_perplexity(ALL_STATES)
                if perplexity_data:
                    existing_state_data, states_updated = _merge_state_data(
                        existing_state_data, perplexity_data
                    )
                    source = "perplexity_research"
            except Exception as exc:
                logger.error("Perplexity research fallback failed: %s", exc)

        # Save if we got updates
        if states_updated > 0:
            existing_yaml["state_data"] = existing_state_data
            existing_yaml.setdefault("source", {})["last_live_refresh"] = datetime.now().isoformat()
            existing_yaml["source"]["refresh_source"] = source
            _save_yaml(existing_yaml)
            _clear_loader_cache()
            logger.info(
                "Spending Spotlight refresh complete: %d states updated via %s",
                states_updated, source,
            )
        else:
            logger.info("No new data found — existing data is current")

        _last_refresh = datetime.now()

        return {
            "status": "completed" if states_updated > 0 else "no_updates",
            "states_updated": states_updated,
            "total_states": len(existing_state_data),
            "source": source,
            "timestamp": _last_refresh.isoformat(),
        }


async def get_refresh_status() -> dict:
    """Get the current status of the Spending Spotlight data."""
    existing = _load_existing_yaml()
    source_info = existing.get("source", {})
    state_count = len(existing.get("state_data", {}))

    return {
        "yaml_path": str(YAML_PATH),
        "total_states": state_count,
        "data_period": source_info.get("data_period", "unknown"),
        "last_live_refresh": source_info.get("last_live_refresh"),
        "refresh_source": source_info.get("refresh_source"),
        "last_memory_refresh": _last_refresh.isoformat() if _last_refresh else None,
    }


# ---------------------------------------------------------------------------
# 5. Background scheduler
# ---------------------------------------------------------------------------

async def _scheduled_refresh_loop(interval_hours: int = 168) -> None:
    """Background loop that refreshes data periodically.

    Default: every 168 hours (1 week). The Spending Spotlight data
    updates annually, so weekly is more than sufficient.
    """
    logger.info(
        "Spending Spotlight background refresh scheduled every %dh", interval_hours
    )
    while True:
        try:
            await asyncio.sleep(interval_hours * 3600)
            logger.info("Running scheduled Spending Spotlight refresh")
            result = await refresh_spending_spotlight(force=False)
            logger.info("Scheduled refresh result: %s", result.get("status"))
        except asyncio.CancelledError:
            logger.info("Spending Spotlight background refresh cancelled")
            break
        except Exception as exc:
            logger.error("Scheduled refresh error: %s", exc)
            # Wait 1 hour before retrying on error
            await asyncio.sleep(3600)


def start_background_refresh(interval_hours: int = 168) -> asyncio.Task:
    """Start the background refresh loop.

    Call this from app startup. Returns the task handle so it can be
    cancelled on shutdown.
    """
    return asyncio.create_task(_scheduled_refresh_loop(interval_hours))
