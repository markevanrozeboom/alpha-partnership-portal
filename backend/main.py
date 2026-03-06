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
    CreateRunRequest, RunStatusResponse, RecalculateRequest,
    ReportFeedback, AssumptionsFeedback, ModelFeedback, DocumentFeedback,
    CountryProfile, EducationAnalysis, Strategy,
    FinancialAssumptions, FinancialModel, PipelineStatus,
)
from graph.pipeline import (
    create_run as pipeline_create_run,
    execute_step,
    submit_feedback,
    finalize_run,
    get_run_state,
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

    # Narrative reports
    resp.country_report = state.get("country_report") or None
    resp.education_report = state.get("education_report") or None
    resp.strategy_report = state.get("strategy_report") or None

    # File paths
    resp.pptx_path = state.get("pptx_path")
    resp.docx_path = state.get("docx_path")
    resp.xlsx_path = state.get("xlsx_path")
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
                next_working_status=PipelineStatus.GENERATING_DOCUMENTS.value,
                revision_working_status=PipelineStatus.BUILDING_MODEL.value,
            )
        else:
            next_status = submit_feedback(
                run_id, "model_feedback", feedback.model_dump(),
                approved=False,
                next_working_status=PipelineStatus.GENERATING_DOCUMENTS.value,
                revision_working_status=PipelineStatus.BUILDING_MODEL.value,
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


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "2.1.0"}
