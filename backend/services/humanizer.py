"""Humanizer post-processor — Remove AI writing patterns from generated reports.

Adapted from AI-Builder-Team/2hr_Learning_Global_Expansion (do:humanizer skill).
Uses the LLM to identify and rewrite AI-isms while preserving all data and meaning.
"""

from __future__ import annotations

import logging

from services.llm import call_llm_plain

logger = logging.getLogger(__name__)

# Condensed version of the 24-pattern taxonomy for the LLM prompt
_HUMANIZER_SYSTEM = """You are a senior copy editor. Your job is to remove signs of AI-generated writing from the text below to make it sound like it was written by a top-tier human analyst.

## Patterns to remove:
1. Inflated significance language: "stands as a testament", "pivotal role", "underscores", "indelible mark", "setting the stage"
2. Promotional language: "boasts a vibrant", "rich tapestry", "profound", "groundbreaking", "renowned", "breathtaking"
3. Superficial -ing analyses: "highlighting...", "underscoring...", "emphasizing...", "reflecting..."
4. Vague attributions: "Industry reports suggest", "Experts argue", "Observers have cited"
5. Template "Challenges and Future Prospects" sections
6. Overused AI vocabulary: "Additionally", "crucial", "delve", "fostering", "garner", "interplay", "intricate", "landscape" (abstract), "pivotal", "tapestry", "testament", "underscore"
7. Copula avoidance: "serves as" / "stands as" instead of "is"
8. "Not only...but also..." patterns
9. Rule-of-three forcing
10. Excessive em dashes
11. Generic positive conclusions
12. Filler phrases: "It is worth noting", "It should be noted"
13. Excessive hedging: "arguably", "it could be said"

## Rules:
- PRESERVE all data, numbers, facts, tables, citations, and analytical conclusions
- PRESERVE all markdown formatting (headers, tables, bold, bullet lists)
- KEEP the same overall structure and section organization
- VARY sentence length naturally — mix short punchy sentences with longer analytical ones
- Use "is" / "are" / "has" when appropriate instead of ornate substitutes
- Be direct and confident — this is an analyst report, not marketing copy
- DO NOT add any new information — only rewrite what exists
- DO NOT remove any sections, tables, or data points
- Keep the professional, authoritative tone of an investment bank research note

Return ONLY the rewritten text. No commentary."""


async def humanize_report(text: str) -> str:
    """Remove AI writing patterns from a report while preserving all content.

    For very long reports, processes in chunks to stay within token limits.
    """
    if not text or len(text.strip()) < 100:
        return text

    # For shorter reports, process in one call
    if len(text) < 15000:
        return await _humanize_chunk(text)

    # For longer reports, split by top-level headings and process each section
    sections = _split_by_headings(text)
    humanized_sections = []

    for section in sections:
        if len(section.strip()) < 50:
            humanized_sections.append(section)
        else:
            humanized_sections.append(await _humanize_chunk(section))

    return "\n\n".join(humanized_sections)


async def densify_text(text: str) -> str:
    """Tighten text — shorter, zero detail loss, better flow.

    Adapted from do:densify skill.
    """
    if not text or len(text.strip()) < 100:
        return text

    prompt = (
        "You are a copy editor. Tighten the writing below — make it shorter and more "
        "direct while keeping every detail, fact, number, and nuance. Do NOT add anything "
        "from your own knowledge.\n\n"
        "Three passes:\n"
        "1. Reorganize: group scattered info, merge overlapping points, reorder for logic\n"
        "2. Compress: replace wordy constructions, convert passive→active, remove filler\n"
        "3. Audit: restore any lost detail, verify all numbers survived\n\n"
        "Preserve ALL markdown formatting. Return ONLY the tightened text.\n\n"
        f"---\n\n{text}"
    )

    try:
        result = await call_llm_plain(prompt)
        if result and len(result.strip()) > len(text.strip()) * 0.3:
            return result
        logger.warning("Densify returned suspiciously short output, using original")
        return text
    except Exception as exc:
        logger.error("Densify failed: %s", exc)
        return text


async def _humanize_chunk(text: str) -> str:
    """Humanize a single chunk of text."""
    prompt = f"{_HUMANIZER_SYSTEM}\n\n---\n\nTEXT TO HUMANIZE:\n\n{text}"
    try:
        result = await call_llm_plain(prompt)
        # Safety check: if result is much shorter, something went wrong
        if result and len(result.strip()) > len(text.strip()) * 0.5:
            return result
        logger.warning("Humanizer returned suspiciously short output, using original")
        return text
    except Exception as exc:
        logger.error("Humanizer failed: %s", exc)
        return text


def _split_by_headings(text: str) -> list[str]:
    """Split markdown text by top-level (# or ##) headings."""
    lines = text.split("\n")
    sections: list[str] = []
    current: list[str] = []

    for line in lines:
        if line.startswith("# ") or line.startswith("## "):
            if current:
                sections.append("\n".join(current))
                current = []
        current.append(line)

    if current:
        sections.append("\n".join(current))

    return sections if sections else [text]
