"""FastAPI application — API endpoints for the Alpha Country/State Pipeline.

Endpoints:
  POST   /api/runs                      — Start a new pipeline run
  GET    /api/runs/{run_id}             — Get status & data of a run
  POST   /api/runs/{run_id}/gate1       — Submit Gate 1 decision (entry mode)
  POST   /api/runs/{run_id}/gate2       — Submit Gate 2 decision (scale/pricing/audience)
  POST   /api/runs/{run_id}/gate3       — Submit Gate 3 decision (approve/revise)
  GET    /api/runs/{run_id}/download/{doc_type}  — Download generated file
  GET    /api/countries                  — List priority countries
  GET    /api/states                     — List priority US states
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from models.schemas import (
    CreateRunRequest,
    RunStatusResponse,
    Gate1Decision,
    Gate2Decision,
    Gate3Decision,
    PipelineStatus,
    AudienceType,
    CountryProfile,
    EducationAnalysis,
    Strategy,
    FinancialModel,
)
from graph.pipeline import start_run, resume_run, get_run_state

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Alpha Country & State Business Plan Pipeline",
    description="Agentic system for generating country/state-specific education partnership proposals",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory run registry (maps run_id → target)
_runs: dict[str, str] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _state_to_response(run_id: str, state: dict[str, Any]) -> RunStatusResponse:
    """Convert raw graph state to API response."""
    country_profile = None
    if state.get("country_profile"):
        try:
            country_profile = CountryProfile(**state["country_profile"])
        except Exception:
            pass

    education_analysis = None
    if state.get("education_analysis"):
        try:
            education_analysis = EducationAnalysis(**state["education_analysis"])
        except Exception:
            pass

    strategy = None
    if state.get("strategy"):
        try:
            strategy = Strategy(**state["strategy"])
        except Exception:
            pass

    financial_model = None
    if state.get("financial_model"):
        try:
            financial_model = FinancialModel(**state["financial_model"])
        except Exception:
            pass

    tier = None
    target_type = None
    if country_profile and country_profile.target:
        tier = country_profile.target.tier
        target_type = country_profile.target.type.value if country_profile.target.type else None

    return RunStatusResponse(
        run_id=run_id,
        status=PipelineStatus(state.get("status", "pending")),
        target=state.get("target_input", ""),
        tier=tier,
        target_type=target_type,
        agent_logs=state.get("agent_logs", []),
        country_profile=country_profile,
        education_analysis=education_analysis,
        strategy=strategy,
        financial_model=financial_model,
        pptx_path=state.get("pptx_path"),
        docx_path=state.get("docx_path"),
        xlsx_path=state.get("xlsx_path"),
        error_message=state.get("error_message"),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/runs", response_model=RunStatusResponse)
async def create_run(request: CreateRunRequest, background_tasks: BackgroundTasks):
    """Start a new pipeline run for a target country or US state."""
    target = request.target.strip()
    if not target:
        raise HTTPException(status_code=400, detail="Target country or state is required")

    logger.info("Creating new run for target: %s", target)

    # Start pipeline in background
    run_id = await start_run(target)
    _runs[run_id] = target

    # Get initial state
    state = get_run_state(run_id)
    return _state_to_response(run_id, state)


@app.get("/api/runs/{run_id}", response_model=RunStatusResponse)
async def get_run(run_id: str):
    """Get the current status and data of a pipeline run."""
    state = get_run_state(run_id)
    if state.get("status") == PipelineStatus.ERROR.value and state.get("error_message") == "Run not found":
        raise HTTPException(status_code=404, detail="Run not found")
    return _state_to_response(run_id, state)


@app.post("/api/runs/{run_id}/gate1", response_model=RunStatusResponse)
async def submit_gate1(run_id: str, decision: Gate1Decision):
    """Submit Gate 1 decision — confirm entry mode after research phase."""
    state = get_run_state(run_id)
    current_status = state.get("status")
    if current_status != PipelineStatus.AWAITING_GATE_1.value:
        raise HTTPException(
            status_code=400,
            detail=f"Run is not awaiting Gate 1 (current status: {current_status})"
        )

    logger.info("Gate 1 decision for run %s: %s", run_id, decision.entry_mode)

    # Resume pipeline with decision
    await resume_run(run_id, {"gate1_decision": decision.model_dump()})

    state = get_run_state(run_id)
    return _state_to_response(run_id, state)


@app.post("/api/runs/{run_id}/gate2", response_model=RunStatusResponse)
async def submit_gate2(run_id: str, decision: Gate2Decision):
    """Submit Gate 2 decision — confirm scale, pricing, school types, and audience."""
    state = get_run_state(run_id)
    current_status = state.get("status")
    if current_status != PipelineStatus.AWAITING_GATE_2.value:
        raise HTTPException(
            status_code=400,
            detail=f"Run is not awaiting Gate 2 (current status: {current_status})"
        )

    logger.info("Gate 2 decision for run %s", run_id)

    await resume_run(run_id, {"gate2_decision": decision.model_dump()})

    state = get_run_state(run_id)
    return _state_to_response(run_id, state)


@app.post("/api/runs/{run_id}/gate3", response_model=RunStatusResponse)
async def submit_gate3(run_id: str, decision: Gate3Decision):
    """Submit Gate 3 decision — approve or request revision of outputs."""
    state = get_run_state(run_id)
    current_status = state.get("status")
    if current_status != PipelineStatus.AWAITING_GATE_3.value:
        raise HTTPException(
            status_code=400,
            detail=f"Run is not awaiting Gate 3 (current status: {current_status})"
        )

    logger.info("Gate 3 decision for run %s: approved=%s", run_id, decision.approved)

    await resume_run(run_id, {"gate3_decision": decision.model_dump()})

    state = get_run_state(run_id)
    return _state_to_response(run_id, state)


@app.get("/api/runs/{run_id}/download/{doc_type}")
async def download_document(run_id: str, doc_type: str):
    """Download a generated document (pptx, docx, or xlsx)."""
    state = get_run_state(run_id)

    path_key = f"{doc_type}_path"
    file_path = state.get(path_key)

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"Document not found: {doc_type}")

    media_types = {
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }

    return FileResponse(
        file_path,
        media_type=media_types.get(doc_type, "application/octet-stream"),
        filename=os.path.basename(file_path),
    )


# ---------------------------------------------------------------------------
# Reference data endpoints
# ---------------------------------------------------------------------------

PRIORITY_COUNTRIES = [
    {"name": "Saudi Arabia", "tier": 1, "region": "Middle East", "potential": "$1B+",
     "key_factors": "100% foreign ownership. Vision 2030. 10.8M school-age pop."},
    {"name": "Qatar", "tier": 1, "region": "Middle East", "potential": "$300M–$500M",
     "key_factors": "100% foreign ownership. 228K private school students. GDP/cap ~$85K."},
    {"name": "Singapore", "tier": 1, "region": "Asia Pacific", "potential": "$200M–$400M",
     "key_factors": "No ownership restriction. Premium market ($35K–$52K tuition)."},
    {"name": "Switzerland", "tier": 1, "region": "Europe", "potential": "$200M–$500M",
     "key_factors": "Highest tuition globally. Cantonal regulation. Expat + domestic market."},
    {"name": "India", "tier": 3, "region": "South Asia", "potential": "$50M–$200M",
     "key_factors": "100% FDI allowed but NFP structure. 250M K-12 students. State-level reg."},
    {"name": "Brazil", "tier": 2, "region": "Latin America", "potential": "$100M–$300M",
     "key_factors": "No foreign ownership restriction. For-profit allowed. 47.3M K-12 students."},
    {"name": "South Korea", "tier": 2, "region": "Asia Pacific", "potential": "$100M–$250M",
     "key_factors": "Foreign foundations can establish schools. $35K–$54K premium tuition."},
    {"name": "United Kingdom", "tier": 2, "region": "Europe", "potential": "$100M–$200M",
     "key_factors": "Fully open. No curriculum mandates for independents. 20% VAT on fees."},
    {"name": "Nigeria", "tier": 3, "region": "Africa", "potential": "$25M–$75M",
     "key_factors": "Foreign ownership permitted. 220M+ population. Enormous scale potential."},
    {"name": "Kenya", "tier": 3, "region": "Africa", "potential": "$25M–$50M",
     "key_factors": "Any person may establish a school. Growing middle class."},
]

PRIORITY_STATES = [
    {"name": "Florida", "rank": 1, "esa_amount": "$9,500–$10,700",
     "students_on_vouchers": "500,000+", "key_factors": "Largest school choice market. $3.9B annual spend. Universal eligibility."},
    {"name": "Texas", "rank": 2, "esa_amount": "~$10,000–$10,200",
     "students_on_vouchers": "~95,000 (Y1 est.)", "key_factors": "Most powerful emerging market. 5.5M public school students. ESA launches 2026-27."},
    {"name": "Arizona", "rank": 3, "esa_amount": "$7,000–$8,000",
     "students_on_vouchers": "83,819", "key_factors": "Pioneer ESA state. Highest charter penetration outside DC at 20.5%."},
    {"name": "Indiana", "rank": 4, "esa_amount": "$6,100–$7,400",
     "students_on_vouchers": "79,448", "key_factors": "#1-ranked charter law. Fully universal July 2026."},
    {"name": "North Carolina", "rank": 5, "esa_amount": "$3,000–$7,000",
     "students_on_vouchers": "103,400", "key_factors": "Fastest growing ESA participation. 77% of charter schools have waitlists."},
]


@app.get("/api/countries")
async def list_countries():
    """List priority target countries."""
    return {"countries": PRIORITY_COUNTRIES}


@app.get("/api/states")
async def list_states():
    """List priority target US states."""
    return {"states": PRIORITY_STATES}


@app.get("/api/runs")
async def list_runs():
    """List all pipeline runs."""
    runs = []
    for run_id, target in _runs.items():
        state = get_run_state(run_id)
        runs.append({
            "run_id": run_id,
            "target": target,
            "status": state.get("status", "unknown"),
        })
    return {"runs": runs}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
