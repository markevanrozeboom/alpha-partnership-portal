"""Language QA Agent — enforces US English spelling and USD currency.

Runs as a post-processing step on all generated text content (reports,
term sheets, deck markdown) before final document rendering.

Two modes:
  1. Fast regex-based scan (no LLM call) — catches known British spellings
     and non-USD currency symbols.
  2. LLM-powered rewrite (optional) — catches context-dependent issues
     the regex can't find.
"""

from __future__ import annotations

import logging
import re

from services.llm import call_llm_plain

logger = logging.getLogger(__name__)

# ── Known British → American spelling map ──────────────────────────────────
# Covers the most common -ise/-isation, -our, -re, -ence, -yse patterns.
# Keys are lowercase; replacement preserves original case.

_BRITISH_TO_AMERICAN: dict[str, str] = {
    "localised": "localized",
    "localise": "localize",
    "localises": "localizes",
    "localising": "localizing",
    "localisation": "localization",
    "personalised": "personalized",
    "personalise": "personalize",
    "personalises": "personalizes",
    "personalising": "personalizing",
    "personalisation": "personalization",
    "standardised": "standardized",
    "standardise": "standardize",
    "standardises": "standardizes",
    "standardising": "standardizing",
    "standardisation": "standardization",
    "optimised": "optimized",
    "optimise": "optimize",
    "optimises": "optimizes",
    "optimising": "optimizing",
    "optimisation": "optimization",
    "maximised": "maximized",
    "maximise": "maximize",
    "maximises": "maximizes",
    "maximising": "maximizing",
    "maximisation": "maximization",
    "minimised": "minimized",
    "minimise": "minimize",
    "minimises": "minimizes",
    "minimising": "minimizing",
    "minimisation": "minimization",
    "recognised": "recognized",
    "recognise": "recognize",
    "recognises": "recognizes",
    "recognising": "recognizing",
    "organised": "organized",
    "organise": "organize",
    "organises": "organizes",
    "organising": "organizing",
    "organisation": "organization",
    "realised": "realized",
    "realise": "realize",
    "realises": "realizes",
    "realising": "realizing",
    "analysed": "analyzed",
    "analyse": "analyze",
    "analyses": "analyzes",  # verb form only; noun "analyses" is valid US English
    "analysing": "analyzing",
    "centralised": "centralized",
    "centralise": "centralize",
    "centralises": "centralizes",
    "centralising": "centralizing",
    "decentralised": "decentralized",
    "decentralise": "decentralize",
    "characterised": "characterized",
    "characterise": "characterize",
    "summarised": "summarized",
    "summarise": "summarize",
    "emphasised": "emphasized",
    "emphasise": "emphasize",
    "prioritised": "prioritized",
    "prioritise": "prioritize",
    "subsidised": "subsidized",
    "subsidise": "subsidize",
    "modernised": "modernized",
    "modernise": "modernize",
    "specialised": "specialized",
    "specialise": "specialize",
    "specialisation": "specialization",
    "customised": "customized",
    "customise": "customize",
    "customisation": "customization",
    "globalised": "globalized",
    "globalisation": "globalization",
    "normalised": "normalized",
    "normalise": "normalize",
    "normalises": "normalizes",
    "normalising": "normalizing",
    "stabilised": "stabilized",
    "stabilise": "stabilize",
    "authorised": "authorized",
    "authorise": "authorize",
    "authorisation": "authorization",
    "utilised": "utilized",
    "utilise": "utilize",
    "utilises": "utilizes",
    "utilising": "utilizing",
    "amortisation": "amortization",
    "capitalisation": "capitalization",
    "colour": "color",
    "colours": "colors",
    "coloured": "colored",
    "favour": "favor",
    "favourable": "favorable",
    "favourite": "favorite",
    "honour": "honor",
    "honourable": "honorable",
    "labour": "labor",
    "neighbour": "neighbor",
    "neighbourhood": "neighborhood",
    "behaviour": "behavior",
    "behavioural": "behavioral",
    "centre": "center",
    "centres": "centers",
    "metre": "meter",
    "metres": "meters",
    "fibre": "fiber",
    "theatre": "theater",
    "defence": "defense",
    "offence": "offense",
    "licence": "license",
    "practise": "practice",
    "programme": "program",
    "programmes": "programs",
    "enrolment": "enrollment",
    "enrolments": "enrollments",
    "fulfilment": "fulfillment",
    "judgement": "judgment",
    "acknowledgement": "acknowledgment",
    "cancelled": "canceled",
    "cancelling": "canceling",
    "modelling": "modeling",
    "travelling": "traveling",
    "counsellor": "counselor",
    "counselling": "counseling",
    "jewellery": "jewelry",
    "grey": "gray",
    "ageing": "aging",
    "manoeuvre": "maneuver",
}

# Build a single compiled regex that matches any British spelling (word-boundary)
_BRITISH_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in _BRITISH_TO_AMERICAN) + r")\b",
    re.IGNORECASE,
)

# Non-USD currency symbols/patterns to flag
_NON_USD_PATTERNS = re.compile(
    r"[£€¥₹₩₪₱₫₴₸₺₼₽]"
    r"|(?<!\w)(?:GBP|EUR|JPY|INR|CNY|AUD|CAD|CHF)\s*\d"
    r"|(?<!\w)(?:Rs\.?|₹)\s*[\d,]",
)


def _replace_preserving_case(match: re.Match) -> str:
    """Replace a British spelling match with its American equivalent,
    preserving the original capitalization pattern."""
    word = match.group(0)
    replacement = _BRITISH_TO_AMERICAN[word.lower()]
    if word.isupper():
        return replacement.upper()
    if word[0].isupper():
        return replacement[0].upper() + replacement[1:]
    return replacement


def fix_spelling(text: str) -> tuple[str, list[str]]:
    """Fix British English spellings in text. Returns (fixed_text, list_of_changes)."""
    changes: list[str] = []

    def _track_and_replace(match: re.Match) -> str:
        original = match.group(0)
        fixed = _replace_preserving_case(match)
        if original != fixed:
            changes.append(f"{original} → {fixed}")
        return fixed

    fixed = _BRITISH_PATTERN.sub(_track_and_replace, text)
    return fixed, changes


def check_currency(text: str) -> list[str]:
    """Check for non-USD currency references. Returns list of warnings."""
    warnings: list[str] = []
    for match in _NON_USD_PATTERNS.finditer(text):
        start = max(0, match.start() - 20)
        end = min(len(text), match.end() + 20)
        context = text[start:end].replace("\n", " ")
        warnings.append(f"Non-USD currency found: ...{context}...")
    return warnings


def run_language_qa(text: str) -> tuple[str, dict]:
    """Run the full language QA check on a text block.

    Returns (fixed_text, report) where report contains:
      - spelling_fixes: list of British→American changes made
      - currency_warnings: list of non-USD currency warnings
      - total_issues: count of all issues found
    """
    fixed_text, spelling_fixes = fix_spelling(text)
    currency_warnings = check_currency(fixed_text)

    report = {
        "spelling_fixes": spelling_fixes,
        "currency_warnings": currency_warnings,
        "total_issues": len(spelling_fixes) + len(currency_warnings),
    }

    if report["total_issues"] > 0:
        logger.info(
            "Language QA: %d spelling fix(es), %d currency warning(s)",
            len(spelling_fixes), len(currency_warnings),
        )

    return fixed_text, report


async def run_language_qa_llm(text: str) -> str:
    """LLM-powered language QA for catching context-dependent issues.

    Use sparingly — adds latency. The regex-based run_language_qa()
    handles 95%+ of cases.
    """
    system = (
        "You are a copy editor enforcing US English standards. "
        "Fix any British English spellings to American English "
        "(e.g. 'organised' → 'organized', 'colour' → 'color'). "
        "Ensure all currency amounts are expressed in USD ($). "
        "If a non-USD amount appears, convert it to USD or flag it with [USD?]. "
        "Do NOT change any meaning, data, or structure. "
        "Return the corrected text only — no commentary."
    )
    result = await call_llm_plain(system, text)
    return result or text
