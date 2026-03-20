"""Pipeline — simple step-based executor with in-memory state store.

Replaces the LangGraph interrupt/resume mechanism with a straightforward
dict-based state store and direct agent calls.  Much more reliable than
the checkpoint-based approach for deployed environments.

Streamlined flow (March 17, 2026):
  1. country_research  → review_country_report     (HITL) — includes education data
  2. strategy          → review_strategy            (HITL)
  3. assumptions       → review_assumptions         (HITL)
  4. financial_model   → review_model               (HITL)
  5. documents         → review_documents           (HITL) — includes term sheet
  6. finalize          → completed

Removed gates (folded into other stages):
  - education_research (merged into country_research)
  - term_sheet_assumptions (folded into document generation)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from models.schemas import (
    CountryProfile, EducationAnalysis, Strategy,
    FinancialAssumptions, FinancialModel,
    AudienceType, PipelineStatus, EntryMode,
)
from agents.country_research import run_country_research
from agents.education_research import run_education_research
from agents.strategy import run_strategy
from agents.financial import generate_assumptions, build_model, recalculate_model
from agents.document_generation import generate_documents
from agents.term_sheet import (
    generate_term_sheet, generate_term_sheet_assumptions,
    get_financial_model_adjustments,
)
from agents.state_deck import generate_state_deck
from agents.language_qa import run_language_qa
from services.gamma import download_export

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory state store
# ---------------------------------------------------------------------------

_run_states: dict[str, dict[str, Any]] = {}


def _make_initial_state(run_id: str, target: str) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "target_input": target,
        "status": PipelineStatus.RESEARCHING_COUNTRY.value,
        "country_profile": {},
        "education_analysis": {},
        "strategy": {},
        "financial_assumptions": {},
        "financial_model": {},
        "country_report": "",
        "education_report": "",
        "strategy_report": "",
        "country_report_feedback": None,
        "education_report_feedback": None,
        "strategy_feedback": None,
        "assumptions_feedback": None,
        "model_feedback": None,
        "term_sheet_assumptions": {},
        "term_sheet_assumptions_feedback": None,
        "document_feedback": None,
        "gamma_url": None,
        "gamma_export_url": None,
        "pptx_path": None,
        "docx_path": None,
        "xlsx_path": None,
        "term_sheet_docx_path": None,
        "country_report_docx_path": None,
        "education_report_docx_path": None,
        "strategy_report_docx_path": None,
        "agent_logs": [f"[{datetime.now().isoformat()}] Pipeline started for '{target}'"],
        "error_message": None,
    }


def _log(state: dict, msg: str) -> None:
    """Append a timestamped message to agent_logs."""
    state.setdefault("agent_logs", []).append(f"[{datetime.now().isoformat()}] {msg}")


# ---------------------------------------------------------------------------
# Step executors — each runs one agent and updates state
# ---------------------------------------------------------------------------

async def _run_country_research(state: dict) -> None:
    """Run the combined Country + Education Research stage.

    Post-streamline: country_research.py produces both the CountryProfile
    and seeds education data.  We then run the thin education_research
    wrapper to generate the focused education brief + EducationAnalysis,
    skipping the old separate HITL gate for education.
    """
    target = state["target_input"]
    _log(state, f"Starting combined country & education research for '{target}'...")
    state["status"] = PipelineStatus.RESEARCHING_COUNTRY.value

    # --- Country research (includes education data) ---
    feedback_text = None
    prev_report = state.get("country_report") or None
    fb = state.get("country_report_feedback")
    if fb and not fb.get("approved") and fb.get("feedback"):
        feedback_text = fb["feedback"]
        _log(state, "Revising country report with feedback...")

    profile, report_md, docx_path = await run_country_research(
        target, feedback=feedback_text, previous_report=prev_report
    )

    state["country_profile"] = profile.model_dump()

    # --- Language QA on country report ---
    report_md, qa_report = run_language_qa(report_md)
    if qa_report["total_issues"] > 0:
        _log(state, f"Language QA (country report): {qa_report['total_issues']} issue(s) auto-fixed")

    state["country_report"] = report_md
    state["country_report_docx_path"] = docx_path

    # --- Education research (thin wrapper — no new Perplexity call) ---
    _log(state, "Generating education brief from country data...")
    edu_fb_text = None
    edu_prev = state.get("education_report") or None
    edu_fb = state.get("education_report_feedback")
    if edu_fb and not edu_fb.get("approved") and edu_fb.get("feedback"):
        edu_fb_text = edu_fb["feedback"]

    analysis, edu_report_md, edu_docx_path = await run_education_research(
        target, CountryProfile(**state["country_profile"]),
        feedback=edu_fb_text, previous_report=edu_prev,
    )

    state["education_analysis"] = analysis.model_dump()

    # --- Language QA on education report ---
    edu_report_md, edu_qa = run_language_qa(edu_report_md)
    if edu_qa["total_issues"] > 0:
        _log(state, f"Language QA (education report): {edu_qa['total_issues']} issue(s) auto-fixed")

    state["education_report"] = edu_report_md
    state["education_report_docx_path"] = edu_docx_path

    state["status"] = PipelineStatus.REVIEW_COUNTRY_REPORT.value
    _log(state, f"Country & education research complete. Type: {profile.target.type.value} (unified model — no tiers)")


async def _run_education_research(state: dict) -> None:
    """Run the Education Research Agent."""
    target = state["target_input"]
    _log(state, "Starting education research...")
    state["status"] = PipelineStatus.RESEARCHING_EDUCATION.value

    country_profile = CountryProfile(**state["country_profile"])

    feedback_text = None
    prev_report = state.get("education_report") or None
    fb = state.get("education_report_feedback")
    if fb and not fb.get("approved") and fb.get("feedback"):
        feedback_text = fb["feedback"]
        _log(state, "Revising education report with feedback...")

    analysis, report_md, docx_path = await run_education_research(
        target, country_profile,
        feedback=feedback_text, previous_report=prev_report,
    )

    state["education_analysis"] = analysis.model_dump()
    state["education_report"] = report_md
    state["education_report_docx_path"] = docx_path
    state["status"] = PipelineStatus.REVIEW_EDUCATION_REPORT.value
    _log(state, "Education research complete.")


async def _run_strategy(state: dict) -> None:
    """Run the Strategy Agent."""
    target = state["target_input"]
    _log(state, "Starting strategy development...")
    state["status"] = PipelineStatus.STRATEGIZING.value

    country_profile = CountryProfile(**state["country_profile"])
    education_analysis = EducationAnalysis(**state["education_analysis"])

    entry_mode = None
    cr_fb = state.get("country_report_feedback")
    if cr_fb and cr_fb.get("entry_mode"):
        entry_mode = EntryMode(cr_fb["entry_mode"])

    feedback_text = None
    prev_report = state.get("strategy_report") or None
    fb = state.get("strategy_feedback")
    if fb and not fb.get("approved") and fb.get("feedback"):
        feedback_text = fb["feedback"]
        _log(state, "Revising strategy with feedback...")

    strategy_obj, report_md, docx_path = await run_strategy(
        target, country_profile, education_analysis,
        entry_mode=entry_mode,
        feedback=feedback_text, previous_report=prev_report,
    )

    state["strategy"] = strategy_obj.model_dump()

    # --- Language QA on strategy report ---
    report_md, strat_qa = run_language_qa(report_md)
    if strat_qa["total_issues"] > 0:
        _log(state, f"Language QA (strategy report): {strat_qa['total_issues']} issue(s) auto-fixed")

    state["strategy_report"] = report_md
    state["strategy_report_docx_path"] = docx_path
    state["status"] = PipelineStatus.REVIEW_STRATEGY.value
    _log(state, f"Strategy complete. Entry mode: {strategy_obj.entry_mode}")


async def _run_assumptions(state: dict) -> None:
    """Generate financial assumptions."""
    target = state["target_input"]
    _log(state, "Generating financial assumptions...")
    state["status"] = PipelineStatus.PRESENTING_ASSUMPTIONS.value

    country_profile = CountryProfile(**state["country_profile"])
    strategy_obj = Strategy(**state["strategy"])

    assumptions = generate_assumptions(target, country_profile, strategy_obj)

    fb = state.get("assumptions_feedback")
    if fb and fb.get("adjustments"):
        for item in assumptions.assumptions:
            if item.key in fb["adjustments"] and not item.locked:
                item.value = fb["adjustments"][item.key]

    state["financial_assumptions"] = assumptions.model_dump()
    state["status"] = PipelineStatus.REVIEW_ASSUMPTIONS.value
    _log(state, f"{len(assumptions.assumptions)} assumptions generated.")


async def _run_financial_model(state: dict) -> None:
    """Build the financial model."""
    target = state["target_input"]
    _log(state, "Building financial model...")
    state["status"] = PipelineStatus.BUILDING_MODEL.value

    strategy_obj = Strategy(**state["strategy"])
    assumptions = FinancialAssumptions(**state["financial_assumptions"])

    fb = state.get("assumptions_feedback")
    if fb and fb.get("adjustments"):
        for item in assumptions.assumptions:
            if item.key in fb["adjustments"] and not item.locked:
                item.value = max(item.min_val, min(item.max_val, fb["adjustments"][item.key]))

    model = build_model(assumptions, target, strategy_obj)

    mfb = state.get("model_feedback")
    if mfb and mfb.get("adjustments"):
        from agents.financial import recalculate_model
        assumptions, model = recalculate_model(assumptions, mfb["adjustments"], target, strategy_obj)

    state["financial_model"] = model.model_dump()
    state["financial_assumptions"] = assumptions.model_dump()
    state["status"] = PipelineStatus.REVIEW_MODEL.value
    _log(state, (
        f"Financial model built. Y5 revenue: ${model.pnl_projection[-1].revenue:,.0f}, "
        f"IRR: {model.returns_analysis.irr}%"
    ))


async def _run_term_sheet_assumptions(state: dict) -> None:
    """Generate term sheet assumptions for HITL review.

    If user has provided adjustments that overlap with the financial model,
    recalculate the financial model first, then generate/update assumptions.
    """
    target = state["target_input"]
    _log(state, "Generating term sheet deal assumptions...")
    state["status"] = PipelineStatus.PRESENTING_TERM_SHEET_ASSUMPTIONS.value

    country_profile = CountryProfile(**state["country_profile"])
    strategy_obj = Strategy(**state["strategy"])
    model = FinancialModel(**state["financial_model"])
    fin_assumptions = FinancialAssumptions(**state["financial_assumptions"])

    # Check if user adjusted term sheet assumptions that impact the financial model
    ts_fb = state.get("term_sheet_assumptions_feedback")
    if ts_fb and ts_fb.get("adjustments"):
        fm_adjustments = get_financial_model_adjustments(ts_fb["adjustments"])
        if fm_adjustments:
            _log(state, f"Term sheet changes impact financial model — recalculating ({list(fm_adjustments.keys())})...")
            fin_assumptions, model = recalculate_model(
                fin_assumptions, fm_adjustments, target, strategy_obj
            )
            state["financial_model"] = model.model_dump()
            state["financial_assumptions"] = fin_assumptions.model_dump()
            _log(state, "Financial model recalculated with updated deal terms.")

    ts_assumptions = generate_term_sheet_assumptions(
        target, country_profile, strategy_obj, model, fin_assumptions,
    )

    # Apply any prior user adjustments to the generated assumptions
    if ts_fb and ts_fb.get("adjustments"):
        for item in ts_assumptions.assumptions:
            if item.key in ts_fb["adjustments"] and not item.locked:
                item.value = ts_fb["adjustments"][item.key]

    state["term_sheet_assumptions"] = ts_assumptions.model_dump()
    state["status"] = PipelineStatus.REVIEW_TERM_SHEET_ASSUMPTIONS.value
    _log(state, f"{len(ts_assumptions.assumptions)} term sheet assumptions generated for review.")


async def _run_documents(state: dict) -> None:
    """Generate documents (deck, term sheet, proposal, spreadsheet).

    For US states: generates Oklahoma-style governor pitch deck.
    For sovereign nations: generates investor deck.
    Always generates: term sheet, investment memorandum, financial XLSX.
    """
    target = state["target_input"]
    _log(state, "Generating documents...")
    state["status"] = PipelineStatus.GENERATING_DOCUMENTS.value

    country_profile = CountryProfile(**state["country_profile"])
    education_analysis = EducationAnalysis(**state["education_analysis"])
    strategy_obj = Strategy(**state["strategy"])
    model = FinancialModel(**state["financial_model"])
    assumptions = FinancialAssumptions(**state["financial_assumptions"])

    audience = AudienceType.INVESTOR
    dfb = state.get("document_feedback")
    if dfb and dfb.get("audience"):
        audience = AudienceType(dfb["audience"])
    revision_notes = None
    if dfb and dfb.get("revision_notes"):
        revision_notes = dfb["revision_notes"]

    is_us_state = country_profile.target.type.value == "us_state"

    # --- Generate deck via Gamma (route by target type) ---
    if is_us_state:
        _log(state, f"Generating governor pitch deck for {target} via Gamma...")
        gamma_url, gamma_export_url, _ = await generate_state_deck(
            target, country_profile, education_analysis,
            strategy_obj, model, assumptions,
        )
    else:
        # Sovereign nation — investor deck generated by generate_documents via Gamma
        gamma_url = None
        gamma_export_url = None

    # --- Generate term sheet ---
    _log(state, "Generating term sheet...")
    ts_data = state.get("term_sheet_assumptions")
    ts_assumptions = (
        FinancialAssumptions(**ts_data)
        if ts_data and isinstance(ts_data, dict) and ts_data.get("assumptions")
        else None
    )
    _, term_sheet_path = await generate_term_sheet(
        target, country_profile, education_analysis,
        strategy_obj, model, assumptions,
        term_sheet_assumptions=ts_assumptions,
    )
    state["term_sheet_docx_path"] = term_sheet_path

    # --- Generate investment memorandum + XLSX (and investor deck for sovereign via Gamma) ---
    gen_gamma_url, gen_export_url, docx_path, xlsx_path, local_pptx_fallback, _ = await generate_documents(
        target, country_profile, education_analysis, strategy_obj,
        model, assumptions, audience, revision_notes,
    )

    # For US states, use the state deck Gamma URLs; for sovereign nations, use the investor deck ones
    state["gamma_url"] = gamma_url if is_us_state else gen_gamma_url
    state["gamma_export_url"] = gamma_export_url if is_us_state else gen_export_url

    # Download PPTX locally so the download link never expires
    export_url = state["gamma_export_url"]
    deck_label = "governor_pitch_deck" if is_us_state else "investor_deck"
    pptx_path = await download_export(export_url, target, label=deck_label) if export_url else None

    # Fallback: use locally-generated PPTX if Gamma download failed.
    # The local PPTX is ALWAYS generated now (not just on failure),
    # so this fallback should be reliable.
    if not pptx_path and local_pptx_fallback:
        _log(state, "Using locally-generated PPTX deck (Gamma unavailable or download failed).")
        pptx_path = local_pptx_fallback

    state["pptx_path"] = pptx_path
    state["docx_path"] = docx_path
    state["xlsx_path"] = xlsx_path
    state["status"] = PipelineStatus.REVIEW_DOCUMENTS.value

    has_gamma = state.get("gamma_url") is not None
    if has_gamma and pptx_path:
        _log(state, "All documents generated (Gamma deck, term sheet, memorandum, XLSX).")
    elif pptx_path:
        _log(state, (
            "All documents generated (local PPTX deck, term sheet, memorandum, XLSX). "
            "Gamma API was unavailable — local deck used."
        ))
    else:
        _log(state, (
            "Documents generated (term sheet, memorandum, XLSX). "
            "WARNING: Deck unavailable — both Gamma API and local PPTX generation failed."
        ))


async def _finalize(state: dict) -> None:
    """Mark pipeline as completed."""
    state["status"] = PipelineStatus.COMPLETED.value
    _log(state, "Pipeline complete! All deliverables ready.")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def create_run(target: str) -> str:
    """Create a new pipeline run — returns the run_id immediately."""
    run_id = str(uuid.uuid4())
    state = _make_initial_state(run_id, target)
    _run_states[run_id] = state
    logger.info("Created pipeline run %s for '%s'", run_id, target)
    return run_id


async def execute_step(run_id: str) -> None:
    """Execute the current step of the pipeline (call in background).

    Looks at the current ``status`` to decide which agent to run next.
    After the agent completes, status is set to the corresponding review gate.
    """
    state = _run_states.get(run_id)
    if not state:
        logger.error("execute_step called for unknown run %s", run_id)
        return

    status = state["status"]
    logger.info("execute_step for run %s — current status: %s", run_id, status)

    try:
        if status == PipelineStatus.RESEARCHING_COUNTRY.value:
            # Combined stage: country research + education brief (no separate education gate)
            await _run_country_research(state)
        elif status == PipelineStatus.RESEARCHING_EDUCATION.value:
            # Legacy compat: if pipeline somehow lands here, run education then skip to strategy
            await _run_education_research(state)
        elif status == PipelineStatus.STRATEGIZING.value:
            await _run_strategy(state)
        elif status == PipelineStatus.PRESENTING_ASSUMPTIONS.value:
            await _run_assumptions(state)
        elif status == PipelineStatus.BUILDING_MODEL.value:
            await _run_financial_model(state)
        elif status == PipelineStatus.PRESENTING_TERM_SHEET_ASSUMPTIONS.value:
            # Legacy compat: term sheet assumptions now folded into document gen
            await _run_term_sheet_assumptions(state)
        elif status == PipelineStatus.GENERATING_DOCUMENTS.value:
            # Generates all documents INCLUDING term sheet (folded in)
            await _run_documents(state)
        else:
            logger.warning("execute_step called with unexpected status %s for run %s", status, run_id)
            return

        logger.info("execute_step complete for run %s — new status: %s", run_id, state["status"])

    except Exception as exc:
        logger.error("execute_step failed for run %s: %s", run_id, exc, exc_info=True)
        state["status"] = PipelineStatus.ERROR.value
        state["error_message"] = str(exc)
        _log(state, f"ERROR: {exc}")


def submit_feedback(
    run_id: str,
    feedback_key: str,
    feedback_value: dict,
    approved: bool,
    next_working_status: str,
    revision_working_status: str,
) -> str:
    """Apply user feedback and determine the next status.

    Returns the next working status (the agent will start running).
    """
    state = _run_states.get(run_id)
    if not state:
        raise ValueError(f"Run {run_id} not found")

    state[feedback_key] = feedback_value

    if approved:
        state["status"] = next_working_status
        _log(state, f"User approved. Moving to {next_working_status}...")
        return next_working_status
    else:
        state["status"] = revision_working_status
        _log(state, f"User requested changes. Re-running {revision_working_status}...")
        return revision_working_status


def finalize_run(run_id: str) -> None:
    """Mark a run as completed (called after document approval)."""
    state = _run_states.get(run_id)
    if state:
        state["status"] = PipelineStatus.COMPLETED.value
        _log(state, "Pipeline complete! All deliverables ready.")


def rewind_to_stage(run_id: str, target_status: str) -> None:
    """Rewind the pipeline to an earlier review gate so the user can re-edit.

    Clears downstream artefacts that will be regenerated when the pipeline
    resumes from the rewound stage.

    Supported targets:
      - ``review_assumptions``  — re-edit financial assumptions (clears model,
        term-sheet, and documents).
      - ``review_term_sheet_assumptions`` — re-edit deal terms (clears documents
        only; financial model is preserved).
    """
    state = _run_states.get(run_id)
    if not state:
        raise ValueError(f"Run {run_id} not found")

    valid_targets = {
        PipelineStatus.REVIEW_ASSUMPTIONS.value,
        PipelineStatus.REVIEW_TERM_SHEET_ASSUMPTIONS.value,
    }
    if target_status not in valid_targets:
        raise ValueError(f"Cannot rewind to '{target_status}'. Valid targets: {valid_targets}")

    if target_status == PipelineStatus.REVIEW_ASSUMPTIONS.value:
        # Clear everything downstream of assumptions
        state["financial_model"] = {}
        state["model_feedback"] = None
        state["term_sheet_assumptions"] = {}
        state["term_sheet_assumptions_feedback"] = None
        state["document_feedback"] = None
        state["gamma_url"] = None
        state["gamma_export_url"] = None
        state["pptx_path"] = None
        state["docx_path"] = None
        state["xlsx_path"] = None
        state["term_sheet_docx_path"] = None

    elif target_status == PipelineStatus.REVIEW_TERM_SHEET_ASSUMPTIONS.value:
        # Clear documents only — financial model is preserved
        state["document_feedback"] = None
        state["gamma_url"] = None
        state["gamma_export_url"] = None
        state["pptx_path"] = None
        state["docx_path"] = None
        state["xlsx_path"] = None
        state["term_sheet_docx_path"] = None

    state["status"] = target_status
    _log(state, f"Pipeline rewound to {target_status} for re-editing.")


def get_run_state(run_id: str) -> dict[str, Any]:
    """Get the current state of a pipeline run."""
    if run_id in _run_states:
        return dict(_run_states[run_id])
    return {"status": PipelineStatus.ERROR.value, "error_message": "Run not found"}
