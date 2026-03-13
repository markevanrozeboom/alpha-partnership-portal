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

# Default theme name to search for in the workspace
DEFAULT_THEME_NAME = "Alpha School"


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

    theme_names = [t.get("name", "?") for t in themes]
    logger.info("Fetched %d themes from Gamma: %s", len(themes), theme_names)
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

    logger.warning("Theme '%s' not found among %d themes: %s",
                   theme_name, len(themes),
                   [t.get("name", "?") for t in themes])
    return None


# Cache the theme ID after first lookup
_default_theme_id: str | None = None
_theme_id_resolved = False


async def get_default_theme_id() -> str | None:
    """Get the cached default theme ID (Alpha School), resolving on first call."""
    global _default_theme_id, _theme_id_resolved

    if not _theme_id_resolved:
        _default_theme_id = await find_theme_id(DEFAULT_THEME_NAME)
        if _default_theme_id:
            logger.info("Resolved '%s' theme ID: %s", DEFAULT_THEME_NAME, _default_theme_id)
        else:
            logger.error(
                "Could not find '%s' theme — Gamma will use its default theme. "
                "Verify the theme exists in your Gamma workspace.",
                DEFAULT_THEME_NAME,
            )
        _theme_id_resolved = True

    return _default_theme_id


async def generate_presentation(
    input_text: str,
    *,
    num_cards: int = 12,
    theme_id: str | None = None,
    text_mode: str = "condense",
    card_split: str = "inputTextBreaks",
    text_amount: str = "extensive",
    additional_instructions: str = "",
    export_as: str = "pptx",
) -> dict[str, Any]:
    """Submit a generation request to Gamma.

    Args:
        input_text: The content for the presentation, with ``\\n---\\n``
            separators between slides when card_split is 'inputTextBreaks'.
        num_cards: Number of slides (1-60 for Pro).
        theme_id: Gamma theme ID. If None, uses the Alpha Slides theme.
        text_mode: 'generate', 'condense', or 'preserve'.
        card_split: 'auto' or 'inputTextBreaks'.
        text_amount: 'brief', 'medium', 'detailed', or 'extensive'.
            Controls content density per card (used with condense/generate).
        additional_instructions: Extra instructions for Gamma AI.
        export_as: 'pptx' or 'pdf'.

    Returns:
        The generation response dict containing ``generationId``.
    """
    if theme_id is None:
        theme_id = await get_default_theme_id()

    body: dict[str, Any] = {
        "inputText": input_text,
        "format": "presentation",
        "textMode": text_mode,
        "numCards": num_cards,
        "cardSplit": card_split,
        "cardOptions": {"dimensions": "16x9"},
        "exportAs": export_as,
    }

    # textOptions.amount controls content density — only relevant for
    # condense/generate modes (ignored by preserve).
    if text_mode in ("condense", "generate"):
        body["textOptions"] = {"amount": text_amount}

    if theme_id:
        body["themeId"] = theme_id

    if additional_instructions:
        body["additionalInstructions"] = additional_instructions

    logger.info(
        "Gamma generation request — textMode=%s, cardSplit=%s, numCards=%d, "
        "themeId=%s, textAmount=%s, inputText length=%d chars",
        text_mode, card_split, num_cards, theme_id, text_amount, len(input_text),
    )

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
                logger.info(
                    "Gamma generation %s completed — gammaUrl=%s, exportUrl=%s",
                    generation_id,
                    data.get("gammaUrl", "N/A"),
                    data.get("exportUrl", "N/A"),
                )
                return data
            elif status in ("failed", "error"):
                error_msg = data.get("error") or data.get("errorMessage") or "Unknown error"
                logger.error("Gamma generation %s failed: %s | Full response: %s", generation_id, error_msg, data)
                raise RuntimeError(f"Gamma generation failed: {error_msg}")

            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    raise TimeoutError(f"Gamma generation {generation_id} did not complete within {MAX_POLL_ATTEMPTS * POLL_INTERVAL_SECONDS}s")


async def generate_and_wait(
    input_text: str,
    *,
    num_cards: int = 12,
    theme_id: str | None = None,
    text_mode: str = "condense",
    card_split: str = "inputTextBreaks",
    text_amount: str = "extensive",
    additional_instructions: str = "",
    export_as: str = "pptx",
    max_retries: int = 3,
) -> dict[str, Any]:
    """Generate a presentation and wait for it to complete.

    Returns the final generation object with:
    - ``gammaUrl``: URL to view/edit the presentation in Gamma
    - ``exportUrl``: URL to download the PPTX/PDF export

    Retries the full generate→poll cycle up to ``max_retries`` times on
    transient failures (network, timeout, 5xx).
    """
    last_exc: Exception | None = None

    for attempt in range(1, max_retries + 1):
        try:
            gen_result = await generate_presentation(
                input_text,
                num_cards=num_cards,
                theme_id=theme_id,
                text_mode=text_mode,
                card_split=card_split,
                text_amount=text_amount,
                additional_instructions=additional_instructions,
                export_as=export_as,
            )

            generation_id = gen_result.get("generationId") or gen_result.get("id")
            if not generation_id:
                raise ValueError(f"No generationId in Gamma response: {gen_result}")

            result = await poll_generation(generation_id)

            # Log all response keys so we can debug export URL discovery
            logger.info(
                "Gamma generation %s completed (attempt %d) — response keys: %s",
                generation_id, attempt, list(result.keys()),
            )

            # Extract URLs with comprehensive key lookup
            gamma_url = _extract_gamma_url(result)
            export_url = _extract_export_url(result)

            logger.info(
                "Gamma generation %s — gammaUrl=%s, exportUrl=%s",
                generation_id, gamma_url, export_url,
            )

            # If we got a completed response but no URLs, log the full
            # response for debugging (but don't retry — Gamma finished,
            # URLs may just be named differently).
            if not gamma_url and not export_url:
                logger.warning(
                    "Gamma generation completed but no URLs found. Full response: %s",
                    result,
                )

            return result

        except Exception as exc:
            last_exc = exc
            logger.warning(
                "Gamma generate_and_wait attempt %d/%d failed: %s",
                attempt, max_retries, exc,
            )
            if attempt < max_retries:
                wait = 5 * attempt  # 5s, 10s backoff
                logger.info("Retrying Gamma in %ds...", wait)
                await asyncio.sleep(wait)

    # All retries exhausted
    raise last_exc or RuntimeError("Gamma generation failed after all retries")


def _extract_gamma_url(result: dict[str, Any]) -> str | None:
    """Extract the Gamma viewer URL from a generation result.

    Gamma's API has used different key names across versions.
    """
    for key in ("gammaUrl", "url", "gamma_url", "viewUrl", "view_url",
                "presentationUrl", "presentation_url", "cardUrl"):
        val = result.get(key)
        if val and isinstance(val, str) and val.startswith("http"):
            return val
    return None


def _extract_export_url(result: dict[str, Any]) -> str | None:
    """Extract the export download URL from a generation result.

    Gamma's API has used different key names across versions.
    """
    for key in ("exportUrl", "export_url", "pptxUrl", "pptx_url",
                "pdfUrl", "pdf_url", "downloadUrl", "download_url",
                "fileUrl", "file_url"):
        val = result.get(key)
        if val and isinstance(val, str) and val.startswith("http"):
            return val
    return None


async def download_export(
    export_url: str, target: str, label: str = "deck", ext: str = "pptx",
    max_retries: int = 3,
) -> str | None:
    """Download an export file (PPTX or PDF) from a Gamma export URL.

    Args:
        export_url: The Gamma export download URL.
        target: Country/state name (used for filename).
        label: File label (e.g. 'investor_deck', 'governor_pitch_deck').
        ext: File extension — 'pptx' or 'pdf'.
        max_retries: Number of download attempts.

    Returns the local file path, or None if download fails.
    """
    if not export_url:
        return None

    safe_target = target.lower().replace(" ", "_")
    out_dir = os.path.join(OUTPUT_DIR, safe_target)
    os.makedirs(out_dir, exist_ok=True)
    filename = f"{safe_target}_{label}.{ext}"
    local_path = os.path.join(out_dir, filename)

    for attempt in range(1, max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=90, follow_redirects=True) as client:
                resp = await client.get(export_url)
                resp.raise_for_status()

                if len(resp.content) < 100:
                    logger.warning(
                        "Gamma export response suspiciously small (%d bytes), attempt %d/%d",
                        len(resp.content), attempt, max_retries,
                    )
                    if attempt < max_retries:
                        await asyncio.sleep(5 * attempt)
                        continue

                with open(local_path, "wb") as f:
                    f.write(resp.content)

            logger.info("Downloaded Gamma %s to %s (%d bytes)", ext.upper(), local_path, len(resp.content))
            return local_path

        except Exception:
            logger.exception(
                "Failed to download Gamma export (attempt %d/%d) from %s",
                attempt, max_retries, export_url,
            )
            if attempt < max_retries:
                await asyncio.sleep(5 * attempt)

    return None
