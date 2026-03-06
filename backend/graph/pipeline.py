"""LangGraph pipeline — multi-agent workflow with 6 HITL decision gates.

Pipeline flow:
  START
    → country_research         (IB-quality country report)
    → ⏸  HITL Gate 1            User reviews country report → feedback/approve
    → education_research       (McKinsey-quality education report)
    → ⏸  HITL Gate 2            User reviews education report → feedback/approve
    → strategy                 (McKinsey/VC strategy report)
    → ⏸  HITL Gate 3            User reviews strategy report → feedback/approve
    → financial_assumptions    (Present configurable assumptions)
    → ⏸  HITL Gate 4            User validates/adjusts assumptions
    → financial_model          (Build model from confirmed assumptions)
    → ⏸  HITL Gate 5            User reviews model, adjusts sliders, locks
    → document_generation      (Deck + Proposal + Spreadsheet)
    → ⏸  HITL Gate 6            User reviews documents → approve
    → finalize
  END
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from graph.state import GraphState
from models.schemas import (
    CountryProfile, EducationAnalysis, Strategy,
    FinancialAssumptions, FinancialModel,
    ReportFeedback, AssumptionsFeedback, ModelFeedback, DocumentFeedback,
    AudienceType, PipelineStatus, EntryMode,
)
from agents.country_research import run_country_research
from agents.education_research import run_education_research
from agents.strategy import run_strategy
from agents.financial import generate_assumptions, build_model, export_model_xlsx
from agents.document_generation import generate_documents

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Node functions
# ---------------------------------------------------------------------------

async def country_research_node(state: GraphState) -> dict[str, Any]:
    """Run the Country Research Agent."""
    target = state["target_input"]
    logs = list(state.get("agent_logs", []))
    logs.append(f"[{datetime.now().isoformat()}] Starting country research for '{target}'...")

    try:
        # Check for revision feedback
        feedback_text = None
        prev_report = state.get("country_report")
        fb = state.get("country_report_feedback")
        if fb and not fb.get("approved") and fb.get("feedback"):
            feedback_text = fb["feedback"]
            logs.append(f"[{datetime.now().isoformat()}] Revising country report with feedback...")

        profile, report_md, docx_path = await run_country_research(
            target, feedback=feedback_text, previous_report=prev_report
        )

        logs.append(
            f"[{datetime.now().isoformat()}] Country research complete. "
            f"Tier: {profile.target.tier}, Type: {profile.target.type.value}"
        )

        return {
            "country_profile": profile.model_dump(),
            "country_report": report_md,
            "country_report_docx_path": docx_path,
            "status": PipelineStatus.REVIEW_COUNTRY_REPORT.value,
            "agent_logs": logs,
        }
    except Exception as exc:
        logs.append(f"[{datetime.now().isoformat()}] ERROR: {exc}")
        return {"status": PipelineStatus.ERROR.value, "error_message": str(exc), "agent_logs": logs}


async def education_research_node(state: GraphState) -> dict[str, Any]:
    """Run the Education Research Agent."""
    target = state["target_input"]
    logs = list(state.get("agent_logs", []))
    logs.append(f"[{datetime.now().isoformat()}] Starting education research...")

    try:
        country_profile = CountryProfile(**state["country_profile"])

        feedback_text = None
        prev_report = state.get("education_report")
        fb = state.get("education_report_feedback")
        if fb and not fb.get("approved") and fb.get("feedback"):
            feedback_text = fb["feedback"]
            logs.append(f"[{datetime.now().isoformat()}] Revising education report with feedback...")

        analysis, report_md, docx_path = await run_education_research(
            target, country_profile,
            feedback=feedback_text, previous_report=prev_report,
        )

        logs.append(f"[{datetime.now().isoformat()}] Education research complete.")

        return {
            "education_analysis": analysis.model_dump(),
            "education_report": report_md,
            "education_report_docx_path": docx_path,
            "status": PipelineStatus.REVIEW_EDUCATION_REPORT.value,
            "agent_logs": logs,
        }
    except Exception as exc:
        logs.append(f"[{datetime.now().isoformat()}] ERROR: {exc}")
        return {"status": PipelineStatus.ERROR.value, "error_message": str(exc), "agent_logs": logs}


async def strategy_node(state: GraphState) -> dict[str, Any]:
    """Run the Strategy Agent."""
    target = state["target_input"]
    logs = list(state.get("agent_logs", []))
    logs.append(f"[{datetime.now().isoformat()}] Starting strategy development...")

    try:
        country_profile = CountryProfile(**state["country_profile"])
        education_analysis = EducationAnalysis(**state["education_analysis"])

        # Entry mode from country report feedback
        entry_mode = None
        cr_fb = state.get("country_report_feedback")
        if cr_fb and cr_fb.get("entry_mode"):
            entry_mode = EntryMode(cr_fb["entry_mode"])

        feedback_text = None
        prev_report = state.get("strategy_report")
        fb = state.get("strategy_feedback")
        if fb and not fb.get("approved") and fb.get("feedback"):
            feedback_text = fb["feedback"]
            logs.append(f"[{datetime.now().isoformat()}] Revising strategy with feedback...")

        strategy, report_md, docx_path = await run_strategy(
            target, country_profile, education_analysis,
            entry_mode=entry_mode,
            feedback=feedback_text, previous_report=prev_report,
        )

        logs.append(
            f"[{datetime.now().isoformat()}] Strategy complete. "
            f"Entry mode: {strategy.entry_mode}"
        )

        return {
            "strategy": strategy.model_dump(),
            "strategy_report": report_md,
            "strategy_report_docx_path": docx_path,
            "status": PipelineStatus.REVIEW_STRATEGY.value,
            "agent_logs": logs,
        }
    except Exception as exc:
        logs.append(f"[{datetime.now().isoformat()}] ERROR: {exc}")
        return {"status": PipelineStatus.ERROR.value, "error_message": str(exc), "agent_logs": logs}


async def financial_assumptions_node(state: GraphState) -> dict[str, Any]:
    """Generate financial assumptions for user validation."""
    target = state["target_input"]
    logs = list(state.get("agent_logs", []))
    logs.append(f"[{datetime.now().isoformat()}] Generating financial assumptions...")

    try:
        country_profile = CountryProfile(**state["country_profile"])
        strategy = Strategy(**state["strategy"])

        assumptions = generate_assumptions(target, country_profile, strategy)

        # Apply any user adjustments from previous round
        fb = state.get("assumptions_feedback")
        if fb and fb.get("adjustments"):
            for item in assumptions.assumptions:
                if item.key in fb["adjustments"] and not item.locked:
                    item.value = fb["adjustments"][item.key]

        logs.append(f"[{datetime.now().isoformat()}] {len(assumptions.assumptions)} assumptions generated.")

        return {
            "financial_assumptions": assumptions.model_dump(),
            "status": PipelineStatus.REVIEW_ASSUMPTIONS.value,
            "agent_logs": logs,
        }
    except Exception as exc:
        logs.append(f"[{datetime.now().isoformat()}] ERROR: {exc}")
        return {"status": PipelineStatus.ERROR.value, "error_message": str(exc), "agent_logs": logs}


async def financial_model_node(state: GraphState) -> dict[str, Any]:
    """Build the financial model from confirmed assumptions."""
    target = state["target_input"]
    logs = list(state.get("agent_logs", []))
    logs.append(f"[{datetime.now().isoformat()}] Building financial model...")

    try:
        strategy = Strategy(**state["strategy"])
        assumptions = FinancialAssumptions(**state["financial_assumptions"])

        # Apply user adjustments if any
        fb = state.get("assumptions_feedback")
        if fb and fb.get("adjustments"):
            for item in assumptions.assumptions:
                if item.key in fb["adjustments"] and not item.locked:
                    item.value = max(item.min_val, min(item.max_val, fb["adjustments"][item.key]))

        model = build_model(assumptions, target, strategy)

        # Also apply model feedback adjustments
        mfb = state.get("model_feedback")
        if mfb and mfb.get("adjustments"):
            from agents.financial import recalculate_model
            assumptions, model = recalculate_model(assumptions, mfb["adjustments"], target, strategy)

        logs.append(
            f"[{datetime.now().isoformat()}] Financial model built. "
            f"Y5 revenue: ${model.pnl_projection[-1].revenue:,.0f}, "
            f"IRR: {model.returns_analysis.irr}%"
        )

        return {
            "financial_model": model.model_dump(),
            "financial_assumptions": assumptions.model_dump(),
            "status": PipelineStatus.REVIEW_MODEL.value,
            "agent_logs": logs,
        }
    except Exception as exc:
        logs.append(f"[{datetime.now().isoformat()}] ERROR: {exc}")
        return {"status": PipelineStatus.ERROR.value, "error_message": str(exc), "agent_logs": logs}


async def document_generation_node(state: GraphState) -> dict[str, Any]:
    """Generate investor deck, proposal, and spreadsheet."""
    target = state["target_input"]
    logs = list(state.get("agent_logs", []))
    logs.append(f"[{datetime.now().isoformat()}] Generating documents...")

    try:
        country_profile = CountryProfile(**state["country_profile"])
        education_analysis = EducationAnalysis(**state["education_analysis"])
        strategy = Strategy(**state["strategy"])
        model = FinancialModel(**state["financial_model"])
        assumptions = FinancialAssumptions(**state["financial_assumptions"])

        audience = AudienceType.INVESTOR
        dfb = state.get("document_feedback")
        if dfb and dfb.get("audience"):
            audience = AudienceType(dfb["audience"])

        revision_notes = None
        if dfb and dfb.get("revision_notes"):
            revision_notes = dfb["revision_notes"]

        pptx_path, docx_path, xlsx_path = await generate_documents(
            target, country_profile, education_analysis, strategy,
            model, assumptions, audience, revision_notes,
        )

        logs.append(f"[{datetime.now().isoformat()}] All documents generated.")

        return {
            "pptx_path": pptx_path,
            "docx_path": docx_path,
            "xlsx_path": xlsx_path,
            "status": PipelineStatus.REVIEW_DOCUMENTS.value,
            "agent_logs": logs,
        }
    except Exception as exc:
        logs.append(f"[{datetime.now().isoformat()}] ERROR: {exc}")
        return {"status": PipelineStatus.ERROR.value, "error_message": str(exc), "agent_logs": logs}


async def finalize_node(state: GraphState) -> dict[str, Any]:
    """Mark pipeline as completed."""
    logs = list(state.get("agent_logs", []))
    logs.append(f"[{datetime.now().isoformat()}] Pipeline complete! All deliverables ready.")
    return {"status": PipelineStatus.COMPLETED.value, "agent_logs": logs}


# --- HITL Gate nodes (pause points) ---

async def gate_country_report(state: GraphState) -> dict[str, Any]:
    return {"status": PipelineStatus.REVIEW_COUNTRY_REPORT.value}

async def gate_education_report(state: GraphState) -> dict[str, Any]:
    return {"status": PipelineStatus.REVIEW_EDUCATION_REPORT.value}

async def gate_strategy(state: GraphState) -> dict[str, Any]:
    return {"status": PipelineStatus.REVIEW_STRATEGY.value}

async def gate_assumptions(state: GraphState) -> dict[str, Any]:
    return {"status": PipelineStatus.REVIEW_ASSUMPTIONS.value}

async def gate_model(state: GraphState) -> dict[str, Any]:
    return {"status": PipelineStatus.REVIEW_MODEL.value}

async def gate_documents(state: GraphState) -> dict[str, Any]:
    return {"status": PipelineStatus.REVIEW_DOCUMENTS.value}


# ---------------------------------------------------------------------------
# Routing logic — handles "revise" vs "proceed" for feedback gates
# ---------------------------------------------------------------------------

def route_country_feedback(state: GraphState) -> str:
    fb = state.get("country_report_feedback")
    if fb and not fb.get("approved") and fb.get("feedback"):
        return "country_research"  # re-run with feedback
    return "education_research"


def route_education_feedback(state: GraphState) -> str:
    fb = state.get("education_report_feedback")
    if fb and not fb.get("approved") and fb.get("feedback"):
        return "education_research"
    return "strategy"


def route_strategy_feedback(state: GraphState) -> str:
    fb = state.get("strategy_feedback")
    if fb and not fb.get("approved") and fb.get("feedback"):
        return "strategy"
    return "financial_assumptions"


def route_assumptions_feedback(state: GraphState) -> str:
    # Assumptions are always "proceed" but might have adjustments applied
    return "financial_model"


def route_model_feedback(state: GraphState) -> str:
    fb = state.get("model_feedback")
    if fb and not fb.get("locked") and fb.get("adjustments"):
        return "financial_model"  # rebuild with new adjustments
    return "document_generation"


def route_document_feedback(state: GraphState) -> str:
    fb = state.get("document_feedback")
    if fb and not fb.get("approved") and fb.get("revision_notes"):
        return "document_generation"
    return "finalize"


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def build_pipeline() -> tuple:
    """Build and compile the LangGraph pipeline with 6 HITL gates."""

    checkpointer = MemorySaver()
    graph = StateGraph(GraphState)

    # Add nodes
    graph.add_node("country_research", country_research_node)
    graph.add_node("gate_country_report", gate_country_report)
    graph.add_node("education_research", education_research_node)
    graph.add_node("gate_education_report", gate_education_report)
    graph.add_node("strategy", strategy_node)
    graph.add_node("gate_strategy", gate_strategy)
    graph.add_node("financial_assumptions", financial_assumptions_node)
    graph.add_node("gate_assumptions", gate_assumptions)
    graph.add_node("financial_model", financial_model_node)
    graph.add_node("gate_model", gate_model)
    graph.add_node("document_generation", document_generation_node)
    graph.add_node("gate_documents", gate_documents)
    graph.add_node("finalize", finalize_node)

    # Define edges
    graph.set_entry_point("country_research")
    graph.add_edge("country_research", "gate_country_report")

    # After each gate, route based on feedback
    graph.add_conditional_edges("gate_country_report", route_country_feedback, {
        "country_research": "country_research",
        "education_research": "education_research",
    })

    graph.add_edge("education_research", "gate_education_report")
    graph.add_conditional_edges("gate_education_report", route_education_feedback, {
        "education_research": "education_research",
        "strategy": "strategy",
    })

    graph.add_edge("strategy", "gate_strategy")
    graph.add_conditional_edges("gate_strategy", route_strategy_feedback, {
        "strategy": "strategy",
        "financial_assumptions": "financial_assumptions",
    })

    graph.add_edge("financial_assumptions", "gate_assumptions")
    graph.add_conditional_edges("gate_assumptions", route_assumptions_feedback, {
        "financial_model": "financial_model",
    })

    graph.add_edge("financial_model", "gate_model")
    graph.add_conditional_edges("gate_model", route_model_feedback, {
        "financial_model": "financial_model",
        "document_generation": "document_generation",
    })

    graph.add_edge("document_generation", "gate_documents")
    graph.add_conditional_edges("gate_documents", route_document_feedback, {
        "document_generation": "document_generation",
        "finalize": "finalize",
    })

    graph.add_edge("finalize", END)

    compiled = graph.compile(
        checkpointer=checkpointer,
        interrupt_before=[
            "gate_country_report", "gate_education_report", "gate_strategy",
            "gate_assumptions", "gate_model", "gate_documents",
        ],
    )

    return compiled, checkpointer


# ---------------------------------------------------------------------------
# Singleton pipeline instance
# ---------------------------------------------------------------------------

_pipeline = None
_checkpointer = None


def get_pipeline():
    global _pipeline, _checkpointer
    if _pipeline is None:
        _pipeline, _checkpointer = build_pipeline()
    return _pipeline, _checkpointer


async def start_run(target: str) -> str:
    """Start a new pipeline run. Returns the run_id."""
    run_id = str(uuid.uuid4())
    pipeline, _ = get_pipeline()

    initial_state: GraphState = {
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
        "document_feedback": None,
        "pptx_path": None,
        "docx_path": None,
        "xlsx_path": None,
        "country_report_docx_path": None,
        "education_report_docx_path": None,
        "strategy_report_docx_path": None,
        "agent_logs": [f"[{datetime.now().isoformat()}] Pipeline started for '{target}'"],
        "error_message": None,
    }

    config = {"configurable": {"thread_id": run_id}}
    logger.info("Starting pipeline run %s for '%s'", run_id, target)
    await pipeline.ainvoke(initial_state, config)
    return run_id


async def resume_run(run_id: str, gate_update: dict[str, Any] | None = None) -> None:
    """Resume a paused pipeline run after a HITL decision."""
    pipeline, _ = get_pipeline()
    config = {"configurable": {"thread_id": run_id}}

    if gate_update:
        await pipeline.aupdate_state(config, gate_update)

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
