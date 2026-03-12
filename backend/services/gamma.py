"""Gamma API service — generates presentations via Gamma's public API.

Uses the v1.0 API at https://public-api.gamma.app/v1.0/.
Authentication is via the X-API-KEY header with an sk-gamma-* key.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

from config import GAMMA_API_KEY, OUTPUT_DIR

logger = logging.getLogger(__name__)

BASE_URL = "https://public-api.gamma.app/v1.0"
POLL_INTERVAL_SECONDS = 5
MAX_POLL_ATTEMPTS = 120  # 10 minutes max


def _headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "X-API-KEY": GAMMA_API_KEY,
    }


async def list_themes() -> list[dict[str, Any]]:
    """Fetch all available themes from the workspace.

    Returns a list of theme objects with ``id``, ``name``, ``type``, etc.
    Paginates automatically.
    """
    themes: list[dict[str, Any]] = []
    cursor: str | None = None

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params: dict[str, str] = {}
            if cursor:
                params["cursor"] = cursor

            resp = await client.get(
                f"{BASE_URL}/themes",
                headers=_headers(),
                params=params,
            )
            resp.raise_for_status()
            data = resp.json()

            themes.extend(data.get("data", []))

            if not data.get("hasMore"):
                break
            cursor = data.get("nextCursor")

    logger.info("Fetched %d themes from Gamma", len(themes))
    return themes


async def find_theme_id(theme_name: str) -> str | None:
    """Find a theme by name and return its ID.

    Performs a case-insensitive partial match.
    """
    themes = await list_themes()
    name_lower = theme_name.lower()

    # Exact match first
    for t in themes:
        if t.get("name", "").lower() == name_lower:
            logger.info("Found exact theme match: %s -> %s", theme_name, t["id"])
            return t["id"]

    # Partial match fallback
    for t in themes:
        if name_lower in t.get("name", "").lower():
            logger.info("Found partial theme match: %s -> %s (%s)", theme_name, t["id"], t["name"])
            return t["id"]

    logger.warning("Theme '%s' not found among %d themes", theme_name, len(themes))
    return None


# Cache the theme ID after first lookup
_alpha_school_theme_id: str | None = None
_theme_id_resolved = False


async def get_alpha_school_theme_id() -> str | None:
    """Get the cached 'Alpha School' theme ID, resolving on first call."""
    global _alpha_school_theme_id, _theme_id_resolved

    if not _theme_id_resolved:
        _alpha_school_theme_id = await find_theme_id("Alpha School")
        _theme_id_resolved = True

    return _alpha_school_theme_id


async def generate_presentation(
    input_text: str,
    *,
    num_cards: int = 12,
    theme_id: str | None = None,
    text_mode: str = "preserve",
    card_split: str = "inputTextBreaks",
    additional_instructions: str = "",
    export_as: str = "pptx",
) -> dict[str, Any]:
    """Submit a generation request to Gamma.

    Args:
        input_text: The content for the presentation, with ``\\n---\\n``
            separators between slides when card_split is 'inputTextBreaks'.
        num_cards: Number of slides (1-60 for Pro).
        theme_id: Gamma theme ID. If None, uses the Alpha School theme.
        text_mode: 'generate', 'condense', or 'preserve'.
        card_split: 'auto' or 'inputTextBreaks'.
        additional_instructions: Extra instructions for Gamma AI.
        export_as: 'pptx' or 'pdf'.

    Returns:
        The generation response dict containing ``generationId``.
    """
    if theme_id is None:
        theme_id = await get_alpha_school_theme_id()

    body: dict[str, Any] = {
        "inputText": input_text,
        "format": "presentation",
        "textMode": text_mode,
        "numCards": num_cards,
        "cardSplit": card_split,
        "cardOptions": {"dimensions": "16x9"},
        "exportAs": export_as,
    }

    if theme_id:
        body["themeId"] = theme_id

    if additional_instructions:
        body["additionalInstructions"] = additional_instructions

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{BASE_URL}/generations",
            headers=_headers(),
            json=body,
        )
        resp.raise_for_status()
        result = resp.json()

    generation_id = result.get("generationId") or result.get("id")
    logger.info("Gamma generation submitted: %s", generation_id)
    return result


async def poll_generation(generation_id: str) -> dict[str, Any]:
    """Poll a generation until it completes or fails.

    Returns the final generation object with ``gammaUrl``, ``exportUrl``, etc.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        for attempt in range(MAX_POLL_ATTEMPTS):
            resp = await client.get(
                f"{BASE_URL}/generations/{generation_id}",
                headers=_headers(),
            )
            resp.raise_for_status()
            data = resp.json()

            status = data.get("status", "").lower()
            logger.debug("Gamma generation %s status: %s (attempt %d)", generation_id, status, attempt + 1)

            if status in ("completed", "complete", "done"):
                logger.info("Gamma generation %s completed", generation_id)
                return data
            elif status in ("failed", "error"):
                error_msg = data.get("error") or data.get("errorMessage") or "Unknown error"
                logger.error("Gamma generation %s failed: %s", generation_id, error_msg)
                raise RuntimeError(f"Gamma generation failed: {error_msg}")

            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    raise TimeoutError(f"Gamma generation {generation_id} did not complete within {MAX_POLL_ATTEMPTS * POLL_INTERVAL_SECONDS}s")


async def generate_and_wait(
    input_text: str,
    *,
    num_cards: int = 12,
    theme_id: str | None = None,
    text_mode: str = "preserve",
    card_split: str = "inputTextBreaks",
    additional_instructions: str = "",
    export_as: str = "pptx",
) -> dict[str, Any]:
    """Generate a presentation and wait for it to complete.

    Returns the final generation object with:
    - ``gammaUrl``: URL to view/edit the presentation in Gamma
    - ``exportUrl``: URL to download the PPTX/PDF export
    """
    gen_result = await generate_presentation(
        input_text,
        num_cards=num_cards,
        theme_id=theme_id,
        text_mode=text_mode,
        card_split=card_split,
        additional_instructions=additional_instructions,
        export_as=export_as,
    )

    generation_id = gen_result.get("generationId") or gen_result.get("id")
    if not generation_id:
        raise ValueError(f"No generationId in Gamma response: {gen_result}")

    return await poll_generation(generation_id)


async def download_export(export_url: str, target: str, label: str = "deck") -> str | None:
    """Download a PPTX from a Gamma export URL and save it locally.

    Returns the local file path, or None if download fails.
    """
    if not export_url:
        return None
    try:
        safe_target = target.lower().replace(" ", "_")
        out_dir = os.path.join(OUTPUT_DIR, safe_target)
        os.makedirs(out_dir, exist_ok=True)
        filename = f"{safe_target}_{label}.pptx"
        local_path = os.path.join(out_dir, filename)

        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            resp = await client.get(export_url)
            resp.raise_for_status()
            with open(local_path, "wb") as f:
                f.write(resp.content)

        logger.info("Downloaded Gamma PPTX to %s (%d bytes)", local_path, len(resp.content))
        return local_path
    except Exception:
        logger.exception("Failed to download Gamma export from %s", export_url)
        return None
