"""LangGraph state definition — TypedDict-based shared context store."""

from __future__ import annotations

from typing import TypedDict, Optional, Any


class GraphState(TypedDict, total=False):
    """The shared context store that flows through the LangGraph pipeline.

    All agents read from and write to this state.  It is persisted by the
    checkpointer so that HITL gates can pause and resume the workflow.
    """

    # --- Run metadata ---
    run_id: str
    target_input: str
    status: str  # PipelineStatus value

    # --- Agent outputs (serialised dicts from Pydantic models) ---
    country_profile: dict[str, Any]
    education_analysis: dict[str, Any]
    strategy: dict[str, Any]
    financial_model: dict[str, Any]

    # --- HITL decisions ---
    gate1_decision: Optional[dict[str, Any]]
    gate2_decision: Optional[dict[str, Any]]
    gate3_decision: Optional[dict[str, Any]]

    # --- Output file paths ---
    pptx_path: Optional[str]
    docx_path: Optional[str]
    xlsx_path: Optional[str]

    # --- Logging ---
    agent_logs: list[str]
    error_message: Optional[str]
