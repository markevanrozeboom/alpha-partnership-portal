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
    CountryProfile, EducationAnalysis, Strategy,
    FinancialAssumptions, FinancialModel,
    AudienceType, TargetType,
)
from agents.country_research import run_country_research
from agents.education_research import run_education_research
from agents.strategy import run_strategy
from agents.financial import generate_assumptions, build_model
from agents.document_generation import generate_documents
from agents.term_sheet import generate_term_sheet, generate_term_sheet_assumptions
from agents.state_deck import generate_state_deck
from services.pdf_generator import convert_docx_to_pdf, convert_pptx_to_pdf

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Express pipeline status (simplified for customer portal)
# ---------------------------------------------------------------------------

EXPRESS_STEPS = [
    "researching",
    "analyzing_education",
    "developing_strategy",
    "building_financials",
    "generating_documents",
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
        # Step 1: Country Research
        # ---------------------------------------------------------------
        _update(state, 0, f"Researching {target}...")
        country_profile, country_report_md, _ = await run_country_research(target)

        # ---------------------------------------------------------------
        # Step 2: Education Research
        # ---------------------------------------------------------------
        _update(state, 1, "Analyzing education sector...")
        education_analysis, education_report_md, _ = await run_education_research(
            target, country_profile
        )

        # ---------------------------------------------------------------
        # Step 3: Strategy
        # ---------------------------------------------------------------
        _update(state, 2, "Developing market entry strategy...")
        strategy_obj, strategy_report_md, _ = await run_strategy(
            target, country_profile, education_analysis
        )

        # ---------------------------------------------------------------
        # Step 4: Financial Model
        # ---------------------------------------------------------------
        _update(state, 3, "Building financial model...")
        assumptions = generate_assumptions(target, country_profile, strategy_obj)
        financial_model = build_model(assumptions, target, strategy_obj)

        # Generate term sheet assumptions (using defaults)
        ts_assumptions = generate_term_sheet_assumptions(
            target, country_profile, strategy_obj, financial_model, assumptions
        )

        # ---------------------------------------------------------------
        # Step 5: Generate Documents
        # ---------------------------------------------------------------
        _update(state, 4, "Generating term sheet and proposal deck...")

        is_us_state = country_profile.target.type == TargetType.US_STATE

        # Term sheet
        _, term_sheet_docx_path = await generate_term_sheet(
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
        gen_gamma_url, gen_export_url, docx_path, xlsx_path, local_pptx_fallback, _ = await generate_documents(
            target, country_profile, education_analysis, strategy_obj,
            financial_model, assumptions, AudienceType.INVESTOR,
            export_as="pdf" if not is_us_state else "pptx",
        )

        # For US states, use the state deck; for sovereign nations, use the investor deck
        final_gamma_url = gamma_url if is_us_state else gen_gamma_url
        final_pdf_export_url = pdf_export_url if is_us_state else gen_export_url
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
        _update(state, 5, "Creating PDF documents...")

        # Term Sheet — convert our DOCX to PDF
        term_sheet_pdf = convert_docx_to_pdf(term_sheet_docx_path)

        # Fallback: if Gamma PDF download failed, convert LOCAL PPTX deck
        # to PDF. This ensures the "proposal" is always a DECK, never the
        # investment memorandum (which is a separate supporting document).
        if not proposal_pdf and local_pptx_fallback:
            logger.warning(
                "No Gamma PDF for %s — converting local PPTX deck to PDF as proposal",
                target,
            )
            try:
                proposal_pdf = convert_pptx_to_pdf(local_pptx_fallback)
                logger.info("Local PPTX → PDF proposal generated: %s", proposal_pdf)
            except Exception as exc:
                logger.error("Local PPTX → PDF conversion failed for %s: %s", target, exc)

        # Last-resort fallback: if BOTH Gamma and local PPTX→PDF failed,
        # use the memorandum so the customer at least gets something.
        if not proposal_pdf:
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
        _update(state, 6, "Complete!")
        state["status"] = "completed"
        logger.info("Express run %s completed successfully.", run_id)

    except Exception as exc:
        logger.error("Express run %s failed: %s", run_id, exc, exc_info=True)
        state["status"] = "error"
        state["error_message"] = str(exc)
        state["step_label"] = f"Error: {exc}"
