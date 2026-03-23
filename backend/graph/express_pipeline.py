"""Express Pipeline — runs the full pipeline end-to-end without HITL gates.

Used by the customer-facing portal. The Head of State enters a country/state
name, and the system produces a PDF term sheet + proposal deck automatically.

All agents are reused from the standard pipeline — this module just orchestrates
them in sequence with default assumptions (no human review stops).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from models.schemas import (
    AudienceType, TargetType,
)
from agents.country_research import run_country_research
from agents.education_research import run_education_research
from agents.strategy import run_strategy
from agents.financial import generate_assumptions, build_model
from agents.document_generation import generate_documents
from agents.term_sheet import generate_term_sheet, generate_term_sheet_assumptions
from agents.state_deck import generate_state_deck
from agents.language_qa import run_language_qa
from services.pdf_generator import convert_docx_to_pdf, convert_pptx_to_pdf

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Express pipeline status (simplified for customer portal)
# ---------------------------------------------------------------------------

EXPRESS_STEPS = [
    "researching",           # Combined country + education research
    "developing_strategy",
    "building_financials",
    "generating_documents",  # Includes term sheet
    "creating_pdfs",
    "completed",
]

# In-memory store for express runs
_express_states: dict[str, dict[str, Any]] = {}


def _make_express_state(run_id: str, target: str) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "target": target,
        "status": "researching",
        "step_index": 0,
        "total_steps": len(EXPRESS_STEPS) - 1,  # exclude "completed"
        "step_label": "Researching market...",
        "term_sheet_pdf_path": None,
        "proposal_pdf_path": None,
        "gamma_url": None,             # Gamma viewer URL for online viewing
        "error_message": None,
        "created_at": datetime.now().isoformat(),
    }


def create_express_run(target: str) -> str:
    """Create a new express pipeline run."""
    run_id = str(uuid.uuid4())
    state = _make_express_state(run_id, target)
    _express_states[run_id] = state
    logger.info("Created express run %s for '%s'", run_id, target)
    return run_id


def get_express_state(run_id: str) -> dict[str, Any]:
    """Get the current state of an express pipeline run."""
    if run_id in _express_states:
        return dict(_express_states[run_id])
    return {"status": "error", "error_message": "Run not found"}


def _update(state: dict, step_index: int, label: str) -> None:
    """Update express pipeline progress."""
    state["step_index"] = step_index
    state["status"] = EXPRESS_STEPS[step_index]
    state["step_label"] = label
    logger.info("Express run %s — step %d: %s", state["run_id"], step_index, label)


async def run_express_pipeline(run_id: str) -> None:
    """Execute the full pipeline end-to-end without any HITL stops.

    Produces PDF term sheet and proposal deck.
    """
    state = _express_states.get(run_id)
    if not state:
        logger.error("Express run %s not found", run_id)
        return

    target = state["target"]

    try:
        # ---------------------------------------------------------------
        # Step 1: Combined Country + Education Research
        # ---------------------------------------------------------------
        _update(state, 0, f"Researching {target} (country + education)...")
        country_profile, country_report_md, _ = await run_country_research(target)

        # Education brief (thin wrapper — no new Perplexity call)
        education_analysis, education_report_md, _ = await run_education_research(
            target, country_profile
        )

        # Language QA on reports
        country_report_md, _ = run_language_qa(country_report_md)
        education_report_md, _ = run_language_qa(education_report_md)

        # ---------------------------------------------------------------
        # Step 2: Strategy
        # ---------------------------------------------------------------
        _update(state, 1, "Developing market entry strategy...")
        strategy_obj, strategy_report_md, _ = await run_strategy(
            target, country_profile, education_analysis
        )
        strategy_report_md, _ = run_language_qa(strategy_report_md)

        # ---------------------------------------------------------------
        # Step 3: Financial Model
        # ---------------------------------------------------------------
        _update(state, 2, "Building financial model...")
        assumptions = generate_assumptions(target, country_profile, strategy_obj)
        financial_model = build_model(assumptions, target, strategy_obj)

        # Generate term sheet assumptions (using defaults)
        ts_assumptions = generate_term_sheet_assumptions(
            target, country_profile, strategy_obj, financial_model, assumptions
        )

        # ---------------------------------------------------------------
        # Step 4: Generate Documents (includes term sheet)
        # ---------------------------------------------------------------
        _update(state, 3, "Generating term sheet and proposal deck...")

        is_us_state = country_profile.target.type == TargetType.US_STATE

        # Term sheet
        _, term_sheet_docx_path, jv_program_name = await generate_term_sheet(
            target, country_profile, education_analysis,
            strategy_obj, financial_model, assumptions,
            term_sheet_assumptions=ts_assumptions,
        )

        # Proposal deck via Gamma — request PDF export directly so we
        # get both the gammaUrl (online view) AND the PDF download from
        # a SINGLE Gamma generation (no double call, no wasted credits).
        from services.gamma import download_export

        if is_us_state:
            gamma_url, pdf_export_url, _ = await generate_state_deck(
                target, country_profile, education_analysis,
                strategy_obj, financial_model, assumptions,
                export_as="pdf",
            )
        else:
            gamma_url = None
            pdf_export_url = None

        # Investment memorandum (DOCX) + XLSX + investor deck for sovereign
        # For sovereign nations, request PDF export from Gamma as well.
        gen_gamma_url, gen_export_url, docx_path, xlsx_path, local_pptx_fallback, deck_input_text = (
            await generate_documents(
                target, country_profile, education_analysis, strategy_obj,
                financial_model, assumptions, AudienceType.INVESTOR,
                export_as="pdf" if not is_us_state else "pptx",
                jv_program_name=jv_program_name,
            )
        )

        # For US states, use the state deck; for sovereign nations, use the investor deck
        final_gamma_url = gamma_url if is_us_state else gen_gamma_url
        final_pdf_export_url = pdf_export_url if is_us_state else gen_export_url

        # Sovereign runs should prefer true Gamma output.
        # If we got a Gamma viewer URL but no export URL, try one additional
        # Gamma generation specifically for PDF export using the same deck input.
        if (not is_us_state) and final_gamma_url and not final_pdf_export_url and deck_input_text:
            logger.warning(
                "Gamma viewer URL exists but no PDF export URL for %s — retrying Gamma export generation",
                target,
            )
            try:
                from services.gamma import generate_and_wait, _extract_gamma_url, _extract_export_url

                retry_result = await generate_and_wait(
                    deck_input_text,
                    num_cards=14,
                    text_mode="condense",
                    card_split="inputTextBreaks",
                    text_amount="extensive",
                    additional_instructions=(
                        f"This is a strategic partnership proposal / investor deck for {target}. "
                        "The audience is C-suite / head-of-state level. "
                        "Use a professional, data-driven tone. Keep slides clean with clear hierarchy. "
                        "Use the markdown headings (# Title) as card titles. "
                        "Preserve all financial figures, percentages, and data points exactly as provided."
                    ),
                    export_as="pdf",
                    max_retries=2,
                )
                retry_gamma_url = _extract_gamma_url(retry_result)
                retry_export_url = _extract_export_url(retry_result)
                if retry_gamma_url and not final_gamma_url:
                    final_gamma_url = retry_gamma_url
                if retry_export_url:
                    final_pdf_export_url = retry_export_url
                    logger.info("Recovered Gamma PDF export URL on retry for %s", target)
            except Exception as exc:
                logger.error("Gamma PDF export retry failed for %s: %s", target, exc)

        # Sovereign runs must produce a true Gamma deck. If Gamma is unavailable,
        # fail explicitly instead of silently downgrading to memorandum output.
        if (not is_us_state) and not final_gamma_url:
            raise RuntimeError(
                "Gamma deck generation failed (no Gamma URL returned). "
                "Run failed intentionally; please retry."
            )

        state["gamma_url"] = final_gamma_url

        # Download Gamma PDF locally
        deck_label = "governor_pitch_deck" if is_us_state else "investor_deck"
        proposal_pdf = None
        if final_pdf_export_url:
            logger.info("Downloading Gamma PDF for %s from export URL...", target)
            proposal_pdf = await download_export(
                final_pdf_export_url, target, label=deck_label, ext="pdf",
            )
            if proposal_pdf:
                logger.info("Gamma PDF downloaded: %s", proposal_pdf)
            else:
                logger.warning("Gamma PDF download failed for %s", target)

        # ---------------------------------------------------------------
        # Step 6: Generate PDFs
        # ---------------------------------------------------------------
        _update(state, 4, "Creating PDF documents...")

        # Term Sheet — convert our DOCX to PDF
        term_sheet_pdf = convert_docx_to_pdf(term_sheet_docx_path)

        # For US-state runs we allow local PPTX fallback conversion.
        # For sovereign runs, Gamma output is required.
        if is_us_state and not proposal_pdf and local_pptx_fallback:
            logger.warning(
                "No Gamma PDF for %s — converting local PPTX deck to PDF as proposal",
                target,
            )
            try:
                proposal_pdf = convert_pptx_to_pdf(local_pptx_fallback)
                logger.info("Local PPTX → PDF proposal generated: %s", proposal_pdf)
            except Exception as exc:
                logger.error("Local PPTX → PDF conversion failed for %s: %s", target, exc)

        # Sovereign runs must not silently substitute memorandum or local fallback.
        if not proposal_pdf and not is_us_state:
            raise RuntimeError(
                "Gamma deck was required but proposal PDF export was unavailable. "
                "Run failed intentionally to avoid memorandum fallback."
            )

        # Last-resort fallback for US-state runs only: if BOTH Gamma and local
        # PPTX→PDF failed, use the memorandum so the customer still gets output.
        if not proposal_pdf and is_us_state:
            logger.error(
                "All deck generation paths failed for %s — last resort: "
                "using investment memorandum as proposal PDF",
                target,
            )
            proposal_pdf = convert_docx_to_pdf(docx_path)

        state["term_sheet_pdf_path"] = term_sheet_pdf
        state["proposal_pdf_path"] = proposal_pdf

        # ---------------------------------------------------------------
        # Complete
        # ---------------------------------------------------------------
        _update(state, 5, "Complete!")
        state["status"] = "completed"
        logger.info("Express run %s completed successfully.", run_id)

    except Exception as exc:
        logger.error("Express run %s failed: %s", run_id, exc, exc_info=True)
        state["status"] = "error"
        state["error_message"] = str(exc)
        state["step_label"] = f"Error: {exc}"
