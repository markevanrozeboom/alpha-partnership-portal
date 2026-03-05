"""LangGraph pipeline — multi-agent workflow with HITL decision gates.

Pipeline flow:
  START → research_phase → HITL Gate 1 → strategy_phase → HITL Gate 2
  → generation_phase → HITL Gate 3 → END
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from graph.state import GraphState
from models.schemas import (
    CountryProfile,
    EducationAnalysis,
    Strategy,
    FinancialModel,
    Gate1Decision,
    Gate2Decision,
    Gate3Decision,
    AudienceType,
    PipelineStatus,
)
from agents.country_research import run_country_research
from agents.education_research import run_education_research
from agents.strategy import run_strategy
from agents.financial import run_financial_model
from agents.document_generation import run_document_generation

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Node functions
# ---------------------------------------------------------------------------

async def research_node(state: GraphState) -> dict[str, Any]:
    """Run Country Research + Education Research agents in parallel."""
    target = state["target_input"]
    logs = list(state.get("agent_logs", []))
    logs.append(f"[{datetime.now().isoformat()}] Starting research phase for '{target}'...")

    try:
        # Run country research first (education research depends on it)
        country_profile = await run_country_research(target)
        logs.append(f"[{datetime.now().isoformat()}] Country research complete. "
                    f"Tier: {country_profile.target.tier}, Type: {country_profile.target.type.value}")

        # Run education research with country profile context
        education_analysis = await run_education_research(target, country_profile)
        logs.append(f"[{datetime.now().isoformat()}] Education research complete.")

        return {
            "country_profile": country_profile.model_dump(),
            "education_analysis": education_analysis.model_dump(),
            "status": PipelineStatus.AWAITING_GATE_1.value,
            "agent_logs": logs,
        }
    except Exception as exc:
        logs.append(f"[{datetime.now().isoformat()}] ERROR in research phase: {exc}")
        return {
            "status": PipelineStatus.ERROR.value,
            "error_message": str(exc),
            "agent_logs": logs,
        }


async def strategy_node(state: GraphState) -> dict[str, Any]:
    """Run Strategy Agent with Gate 1 decisions applied."""
    target = state["target_input"]
    logs = list(state.get("agent_logs", []))
    logs.append(f"[{datetime.now().isoformat()}] Starting strategy phase...")

    try:
        country_profile = CountryProfile(**state["country_profile"])
        education_analysis = EducationAnalysis(**state["education_analysis"])

        gate1 = None
        if state.get("gate1_decision"):
            gate1 = Gate1Decision(**state["gate1_decision"])

        strategy = await run_strategy(target, country_profile, education_analysis, gate1)
        logs.append(f"[{datetime.now().isoformat()}] Strategy complete. "
                    f"Entry mode: {strategy.entry_mode}, "
                    f"Target students: {strategy.target_student_count_year5:,}")

        return {
            "strategy": strategy.model_dump(),
            "status": PipelineStatus.AWAITING_GATE_2.value,
            "agent_logs": logs,
        }
    except Exception as exc:
        logs.append(f"[{datetime.now().isoformat()}] ERROR in strategy phase: {exc}")
        return {
            "status": PipelineStatus.ERROR.value,
            "error_message": str(exc),
            "agent_logs": logs,
        }


async def generation_node(state: GraphState) -> dict[str, Any]:
    """Run Financial Model + Document Generation agents."""
    target = state["target_input"]
    logs = list(state.get("agent_logs", []))
    logs.append(f"[{datetime.now().isoformat()}] Starting generation phase...")

    try:
        country_profile = CountryProfile(**state["country_profile"])
        education_analysis = EducationAnalysis(**state["education_analysis"])
        strategy = Strategy(**state["strategy"])

        gate2 = None
        if state.get("gate2_decision"):
            gate2 = Gate2Decision(**state["gate2_decision"])

        # Determine audience
        audience = AudienceType.INVESTOR
        if gate2 and gate2.audience:
            audience = gate2.audience

        # Run financial model
        financial_model = await run_financial_model(
            target, country_profile, education_analysis, strategy, gate2
        )
        logs.append(f"[{datetime.now().isoformat()}] Financial model complete.")

        # Run document generation
        pptx_path, docx_path, xlsx_path = await run_document_generation(
            target, country_profile, education_analysis, strategy, financial_model, audience
        )
        logs.append(f"[{datetime.now().isoformat()}] Documents generated.")

        return {
            "financial_model": financial_model.model_dump(),
            "pptx_path": pptx_path,
            "docx_path": docx_path,
            "xlsx_path": xlsx_path,
            "status": PipelineStatus.AWAITING_GATE_3.value,
            "agent_logs": logs,
        }
    except Exception as exc:
        logs.append(f"[{datetime.now().isoformat()}] ERROR in generation phase: {exc}")
        return {
            "status": PipelineStatus.ERROR.value,
            "error_message": str(exc),
            "agent_logs": logs,
        }


async def finalize_node(state: GraphState) -> dict[str, Any]:
    """Mark pipeline as completed."""
    logs = list(state.get("agent_logs", []))
    logs.append(f"[{datetime.now().isoformat()}] Pipeline complete! All deliverables ready.")
    return {
        "status": PipelineStatus.COMPLETED.value,
        "agent_logs": logs,
    }


# HITL gate nodes (these are "pause" points)
async def hitl_gate_1(state: GraphState) -> dict[str, Any]:
    """Pause point after research — user reviews and confirms entry mode."""
    return {"status": PipelineStatus.AWAITING_GATE_1.value}


async def hitl_gate_2(state: GraphState) -> dict[str, Any]:
    """Pause point after strategy — user confirms scale, pricing, audience."""
    return {"status": PipelineStatus.AWAITING_GATE_2.value}


async def hitl_gate_3(state: GraphState) -> dict[str, Any]:
    """Pause point after generation — user reviews outputs."""
    return {"status": PipelineStatus.AWAITING_GATE_3.value}


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def build_pipeline() -> tuple[StateGraph, MemorySaver]:
    """Build and compile the LangGraph pipeline."""

    checkpointer = MemorySaver()

    graph = StateGraph(GraphState)

    # Add nodes
    graph.add_node("research", research_node)
    graph.add_node("hitl_gate_1", hitl_gate_1)
    graph.add_node("strategy", strategy_node)
    graph.add_node("hitl_gate_2", hitl_gate_2)
    graph.add_node("generation", generation_node)
    graph.add_node("hitl_gate_3", hitl_gate_3)
    graph.add_node("finalize", finalize_node)

    # Define edges (sequential flow)
    graph.set_entry_point("research")
    graph.add_edge("research", "hitl_gate_1")
    graph.add_edge("hitl_gate_1", "strategy")
    graph.add_edge("strategy", "hitl_gate_2")
    graph.add_edge("hitl_gate_2", "generation")
    graph.add_edge("generation", "hitl_gate_3")
    graph.add_edge("hitl_gate_3", "finalize")
    graph.add_edge("finalize", END)

    compiled = graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["hitl_gate_1", "hitl_gate_2", "hitl_gate_3"],
    )

    return compiled, checkpointer


# ---------------------------------------------------------------------------
# Singleton pipeline instance
# ---------------------------------------------------------------------------

_pipeline = None
_checkpointer = None


def get_pipeline():
    """Return the singleton compiled pipeline and checkpointer."""
    global _pipeline, _checkpointer
    if _pipeline is None:
        _pipeline, _checkpointer = build_pipeline()
    return _pipeline, _checkpointer


async def start_run(target: str) -> str:
    """Start a new pipeline run. Returns the run_id (thread_id)."""
    run_id = str(uuid.uuid4())
    pipeline, _ = get_pipeline()

    initial_state: GraphState = {
        "run_id": run_id,
        "target_input": target,
        "status": PipelineStatus.RESEARCHING.value,
        "country_profile": {},
        "education_analysis": {},
        "strategy": {},
        "financial_model": {},
        "gate1_decision": None,
        "gate2_decision": None,
        "gate3_decision": None,
        "pptx_path": None,
        "docx_path": None,
        "xlsx_path": None,
        "agent_logs": [f"[{datetime.now().isoformat()}] Pipeline started for '{target}'"],
        "error_message": None,
    }

    config = {"configurable": {"thread_id": run_id}}

    # Run until first interrupt (Gate 1)
    logger.info("Starting pipeline run %s for '%s'", run_id, target)
    await pipeline.ainvoke(initial_state, config)

    return run_id


async def resume_run(run_id: str, gate_decision: dict[str, Any] | None = None) -> None:
    """Resume a paused pipeline run after a HITL decision."""
    pipeline, _ = get_pipeline()
    config = {"configurable": {"thread_id": run_id}}

    # Update state with the user's decision
    if gate_decision:
        await pipeline.aupdate_state(config, gate_decision)

    # Resume — will run until next interrupt or completion
    logger.info("Resuming pipeline run %s", run_id)
    await pipeline.ainvoke(None, config)


def get_run_state(run_id: str) -> dict[str, Any]:
    """Get the current state of a pipeline run."""
    pipeline, _ = get_pipeline()
    config = {"configurable": {"thread_id": run_id}}

    try:
        snapshot = pipeline.get_state(config)
        if snapshot and snapshot.values:
            return dict(snapshot.values)
    except Exception as exc:
        logger.error("Error getting state for run %s: %s", run_id, exc)

    return {"status": PipelineStatus.ERROR.value, "error_message": "Run not found"}
