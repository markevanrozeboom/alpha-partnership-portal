"""FastAPI backend — Alpha Country/State Business Plan Agentic System."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from models.schemas import (
    CreateRunRequest, RunStatusResponse, RecalculateRequest, RewindRequest,
    ReportFeedback, AssumptionsFeedback, ModelFeedback,
    TermSheetAssumptionsFeedback, DocumentFeedback,
    CountryProfile, EducationAnalysis, Strategy,
    FinancialAssumptions, FinancialModel, PipelineStatus,
)
from graph.pipeline import (
    create_run as pipeline_create_run,
    execute_step,
    submit_feedback,
    finalize_run,
    get_run_state,
    rewind_to_stage,
)
from graph.express_pipeline import (
    create_express_run,
    run_express_pipeline,
    get_express_state,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Alpha Country/State Business Plan API",
    description="Agentic pipeline for country/state market-entry analysis and deal structuring",
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Run Management
# ---------------------------------------------------------------------------

@app.post("/api/runs", response_model=dict)
async def create_run_endpoint(req: CreateRunRequest):
    """Start a new pipeline run (runs in background)."""
    target = req.target.strip()
    if not target:
        raise HTTPException(400, "Target is required")

    run_id = pipeline_create_run(target)
    # Start the first step (country research) in the background
    asyncio.create_task(execute_step(run_id))
    return {"run_id": run_id}


@app.get("/api/runs/{run_id}", response_model=RunStatusResponse)
async def get_run(run_id: str):
    """Get the current state and all data for a pipeline run."""
    state = get_run_state(run_id)

    # Build response
    resp = RunStatusResponse(
        run_id=run_id,
        status=PipelineStatus(state.get("status", "error")),
        target=state.get("target_input", ""),
        agent_logs=state.get("agent_logs", []),
        error_message=state.get("error_message"),
    )

    # Country profile
    cp_data = state.get("country_profile")
    if cp_data and isinstance(cp_data, dict) and cp_data.get("target"):
        try:
            cp = CountryProfile(**cp_data)
            resp.country_profile = cp
            resp.tier = cp.target.tier if cp.target.tier else None
            resp.target_type = cp.target.type.value
        except Exception:
            pass

    # Education analysis
    ea_data = state.get("education_analysis")
    if ea_data and isinstance(ea_data, dict):
        try:
            resp.education_analysis = EducationAnalysis(**ea_data)
        except Exception:
            pass

    # Strategy
    st_data = state.get("strategy")
    if st_data and isinstance(st_data, dict):
        try:
            resp.strategy = Strategy(**st_data)
        except Exception:
            pass

    # Financial assumptions
    fa_data = state.get("financial_assumptions")
    if fa_data and isinstance(fa_data, dict):
        try:
            resp.financial_assumptions = FinancialAssumptions(**fa_data)
        except Exception:
            pass

    # Financial model
    fm_data = state.get("financial_model")
    if fm_data and isinstance(fm_data, dict):
        try:
            resp.financial_model = FinancialModel(**fm_data)
        except Exception:
            pass

    # Term sheet assumptions
    tsa_data = state.get("term_sheet_assumptions")
    if tsa_data and isinstance(tsa_data, dict):
        try:
            resp.term_sheet_assumptions = FinancialAssumptions(**tsa_data)
        except Exception:
            pass

    # Narrative reports
    resp.country_report = state.get("country_report") or None
    resp.education_report = state.get("education_report") or None
    resp.strategy_report = state.get("strategy_report") or None

    # Gamma slide deck URLs
    resp.gamma_url = state.get("gamma_url")
    resp.gamma_export_url = state.get("gamma_export_url")

    # File paths
    resp.pptx_path = state.get("pptx_path")
    resp.docx_path = state.get("docx_path")
    resp.xlsx_path = state.get("xlsx_path")
    resp.term_sheet_docx_path = state.get("term_sheet_docx_path")
    resp.country_report_docx_path = state.get("country_report_docx_path")
    resp.education_report_docx_path = state.get("education_report_docx_path")
    resp.strategy_report_docx_path = state.get("strategy_report_docx_path")

    return resp


# ---------------------------------------------------------------------------
# HITL Gates — User Feedback Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/runs/{run_id}/feedback/country-report")
async def submit_country_report_feedback(run_id: str, feedback: ReportFeedback):
    """Submit feedback on the country research report."""
    try:
        if feedback.approved:
            next_status = submit_feedback(
                run_id, "country_report_feedback", feedback.model_dump(),
                approved=True,
                next_working_status=PipelineStatus.RESEARCHING_EDUCATION.value,
                revision_working_status=PipelineStatus.RESEARCHING_COUNTRY.value,
            )
        else:
            next_status = submit_feedback(
                run_id, "country_report_feedback", feedback.model_dump(),
                approved=False,
                next_working_status=PipelineStatus.RESEARCHING_EDUCATION.value,
                revision_working_status=PipelineStatus.RESEARCHING_COUNTRY.value,
            )

        # Start the next step in the background
        asyncio.create_task(execute_step(run_id))
        return {"status": "ok", "next_status": next_status}
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/runs/{run_id}/feedback/education-report")
async def submit_education_report_feedback(run_id: str, feedback: ReportFeedback):
    """Submit feedback on the education research report."""
    try:
        next_status = submit_feedback(
            run_id, "education_report_feedback", feedback.model_dump(),
            approved=feedback.approved,
            next_working_status=PipelineStatus.STRATEGIZING.value,
            revision_working_status=PipelineStatus.RESEARCHING_EDUCATION.value,
        )
        asyncio.create_task(execute_step(run_id))
        return {"status": "ok", "next_status": next_status}
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/runs/{run_id}/feedback/strategy")
async def submit_strategy_feedback(run_id: str, feedback: ReportFeedback):
    """Submit feedback on the strategy report."""
    try:
        next_status = submit_feedback(
            run_id, "strategy_feedback", feedback.model_dump(),
            approved=feedback.approved,
            next_working_status=PipelineStatus.PRESENTING_ASSUMPTIONS.value,
            revision_working_status=PipelineStatus.STRATEGIZING.value,
        )
        asyncio.create_task(execute_step(run_id))
        return {"status": "ok", "next_status": next_status}
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/runs/{run_id}/feedback/assumptions")
async def submit_assumptions_feedback(run_id: str, feedback: AssumptionsFeedback):
    """Submit validated/adjusted assumptions."""
    try:
        next_status = submit_feedback(
            run_id, "assumptions_feedback", feedback.model_dump(),
            approved=True,  # assumptions always proceed
            next_working_status=PipelineStatus.BUILDING_MODEL.value,
            revision_working_status=PipelineStatus.PRESENTING_ASSUMPTIONS.value,
        )
        asyncio.create_task(execute_step(run_id))
        return {"status": "ok", "next_status": next_status}
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/runs/{run_id}/feedback/model")
async def submit_model_feedback(run_id: str, feedback: ModelFeedback):
    """Submit financial model review — lock or adjust."""
    try:
        if feedback.locked:
            next_status = submit_feedback(
                run_id, "model_feedback", feedback.model_dump(),
                approved=True,
                next_working_status=PipelineStatus.PRESENTING_TERM_SHEET_ASSUMPTIONS.value,
                revision_working_status=PipelineStatus.BUILDING_MODEL.value,
            )
        else:
            next_status = submit_feedback(
                run_id, "model_feedback", feedback.model_dump(),
                approved=False,
                next_working_status=PipelineStatus.PRESENTING_TERM_SHEET_ASSUMPTIONS.value,
                revision_working_status=PipelineStatus.BUILDING_MODEL.value,
            )
        asyncio.create_task(execute_step(run_id))
        return {"status": "ok", "next_status": next_status}
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/runs/{run_id}/feedback/term-sheet-assumptions")
async def submit_term_sheet_assumptions_feedback(
    run_id: str, feedback: TermSheetAssumptionsFeedback
):
    """Submit term sheet assumptions review — accept or adjust deal terms."""
    try:
        state = get_run_state(run_id)

        # If user made adjustments, apply them to the term sheet assumptions
        if feedback.adjustments:
            tsa_data = state.get("term_sheet_assumptions", {})
            if tsa_data and isinstance(tsa_data, dict):
                assumptions_dict = tsa_data.get("assumptions", {})
                for key, val in feedback.adjustments.items():
                    if key in assumptions_dict:
                        assumptions_dict[key] = val
                tsa_data["assumptions"] = assumptions_dict
                state["term_sheet_assumptions"] = tsa_data

        next_status = submit_feedback(
            run_id, "term_sheet_assumptions_feedback", feedback.model_dump(),
            approved=feedback.approved,
            next_working_status=PipelineStatus.GENERATING_DOCUMENTS.value,
            revision_working_status=PipelineStatus.PRESENTING_TERM_SHEET_ASSUMPTIONS.value,
        )
        asyncio.create_task(execute_step(run_id))
        return {"status": "ok", "next_status": next_status}
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/runs/{run_id}/feedback/documents")
async def submit_document_feedback(run_id: str, feedback: DocumentFeedback):
    """Submit final document review."""
    try:
        if feedback.approved:
            finalize_run(run_id)
            return {"status": "ok", "next_status": "completed"}
        else:
            next_status = submit_feedback(
                run_id, "document_feedback", feedback.model_dump(),
                approved=False,
                next_working_status=PipelineStatus.COMPLETED.value,
                revision_working_status=PipelineStatus.GENERATING_DOCUMENTS.value,
            )
            asyncio.create_task(execute_step(run_id))
            return {"status": "ok", "next_status": next_status}
    except ValueError as e:
        raise HTTPException(404, str(e))


# ---------------------------------------------------------------------------
# Recalculate Financial Model (real-time slider adjustments)
# ---------------------------------------------------------------------------

@app.post("/api/runs/{run_id}/recalculate")
async def recalculate_financial_model(run_id: str, req: RecalculateRequest):
    """Recalculate the financial model with adjusted assumptions (does NOT resume pipeline)."""
    state = get_run_state(run_id)

    fa_data = state.get("financial_assumptions")
    st_data = state.get("strategy")

    if not fa_data or not st_data:
        raise HTTPException(400, "Financial assumptions or strategy not yet available")

    try:
        assumptions = FinancialAssumptions(**fa_data)
        strategy = Strategy(**st_data)

        from agents.financial import recalculate_model
        updated_assumptions, updated_model = recalculate_model(
            assumptions, req.adjustments, state.get("target_input", ""), strategy
        )

        return {
            "financial_model": updated_model.model_dump(),
            "financial_assumptions": updated_assumptions.model_dump(),
        }
    except Exception as exc:
        raise HTTPException(500, str(exc))


# ---------------------------------------------------------------------------
# Recalculate Term Sheet Impact on Financial Model
# ---------------------------------------------------------------------------

@app.post("/api/runs/{run_id}/recalculate-term-sheet")
async def recalculate_term_sheet_impact(run_id: str, req: RecalculateRequest):
    """Check if term sheet assumption changes impact the financial model
    and recalculate if needed."""
    state = get_run_state(run_id)

    fa_data = state.get("financial_assumptions")
    st_data = state.get("strategy")
    fm_data = state.get("financial_model")

    if not fa_data or not st_data or not fm_data:
        raise HTTPException(400, "Financial model data not yet available")

    try:
        from agents.term_sheet import get_financial_model_adjustments

        fin_adjustments = get_financial_model_adjustments(req.adjustments)

        result: dict[str, Any] = {
            "has_financial_impact": bool(fin_adjustments),
            "impacted_fields": list(fin_adjustments.keys()),
        }

        if fin_adjustments:
            assumptions = FinancialAssumptions(**fa_data)
            strategy = Strategy(**st_data)

            from agents.financial import recalculate_model
            updated_assumptions, updated_model = recalculate_model(
                assumptions, fin_adjustments,
                state.get("target_input", ""), strategy,
            )

            # Save updated model back to state
            state["financial_model"] = updated_model.model_dump()
            state["financial_assumptions"] = updated_assumptions.model_dump()

            result["financial_model"] = updated_model.model_dump()
            result["financial_assumptions"] = updated_assumptions.model_dump()

        return result
    except Exception as exc:
        raise HTTPException(500, str(exc))


# ---------------------------------------------------------------------------
# Pipeline Rewind (go back and re-edit earlier stages)
# ---------------------------------------------------------------------------

@app.post("/api/runs/{run_id}/rewind")
async def rewind_pipeline(run_id: str, req: RewindRequest):
    """Rewind the pipeline to an earlier review gate for re-editing.

    Supported target_stage values:
      - ``review_assumptions`` — go back to edit financial assumptions
      - ``review_term_sheet_assumptions`` — go back to edit deal terms
    """
    try:
        rewind_to_stage(run_id, req.target_stage)
        return {"status": "ok", "new_status": req.target_stage}
    except ValueError as e:
        raise HTTPException(404, str(e))


# ---------------------------------------------------------------------------
# File Downloads
# ---------------------------------------------------------------------------

@app.get("/api/runs/{run_id}/download/{file_type}")
async def download_file(run_id: str, file_type: str):
    """Download a generated file."""
    state = get_run_state(run_id)

    file_map = {
        "pptx": state.get("pptx_path"),
        "docx": state.get("docx_path"),
        "xlsx": state.get("xlsx_path"),
        "term_sheet": state.get("term_sheet_docx_path"),
        "country_report": state.get("country_report_docx_path"),
        "education_report": state.get("education_report_docx_path"),
        "strategy_report": state.get("strategy_report_docx_path"),
    }

    path = file_map.get(file_type)
    if not path or not os.path.exists(path):
        raise HTTPException(404, f"File not found: {file_type}")

    return FileResponse(
        path,
        filename=os.path.basename(path),
        media_type="application/octet-stream",
    )


# ===========================================================================
# CUSTOMER PORTAL — Express Pipeline Endpoints
# ===========================================================================

@app.post("/api/portal/runs", response_model=dict)
async def create_express_run_endpoint(req: CreateRunRequest):
    """Start an express pipeline run (customer portal — no HITL gates).

    Runs the full pipeline end-to-end and produces PDF deliverables.
    """
    target = req.target.strip()
    if not target:
        raise HTTPException(400, "Target is required")

    run_id = create_express_run(target)
    # Run the full pipeline in the background
    asyncio.create_task(run_express_pipeline(run_id))
    return {"run_id": run_id}


@app.get("/api/portal/runs/{run_id}")
async def get_express_run_status(run_id: str):
    """Get status of an express pipeline run (customer portal)."""
    state = get_express_state(run_id)
    if state.get("status") == "error" and state.get("error_message") == "Run not found":
        raise HTTPException(404, "Run not found")
    return state


@app.get("/api/portal/runs/{run_id}/download/{file_type}")
async def download_express_file(run_id: str, file_type: str):
    """Download a PDF from an express pipeline run.

    file_type: 'term_sheet' or 'proposal'
    """
    state = get_express_state(run_id)

    if state.get("status") != "completed":
        raise HTTPException(400, "Documents are not ready yet")

    file_map = {
        "term_sheet": state.get("term_sheet_pdf_path"),
        "proposal": state.get("proposal_pdf_path"),
    }

    path = file_map.get(file_type)
    if not path or not os.path.exists(path):
        raise HTTPException(404, f"File not found: {file_type}")

    return FileResponse(
        path,
        filename=os.path.basename(path),
        media_type="application/pdf",
    )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "2.1.0"}
