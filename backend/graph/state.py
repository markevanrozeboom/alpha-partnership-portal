"""LangGraph state definition — TypedDict-based shared context store."""

from __future__ import annotations
from typing import TypedDict, Optional, Any


class GraphState(TypedDict, total=False):
    """The shared context store that flows through the LangGraph pipeline.

    All agents read from and write to this state. It is persisted by the
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
    financial_assumptions: dict[str, Any]
    financial_model: dict[str, Any]

    # --- Narrative reports (markdown) ---
    country_report: str
    education_report: str
    strategy_report: str

    # --- HITL feedback (serialised dicts) ---
    country_report_feedback: Optional[dict[str, Any]]
    education_report_feedback: Optional[dict[str, Any]]
    strategy_feedback: Optional[dict[str, Any]]
    assumptions_feedback: Optional[dict[str, Any]]
    model_feedback: Optional[dict[str, Any]]
    document_feedback: Optional[dict[str, Any]]

    # --- Output file paths ---
    pptx_path: Optional[str]
    docx_path: Optional[str]
    xlsx_path: Optional[str]
    country_report_docx_path: Optional[str]
    education_report_docx_path: Optional[str]
    strategy_report_docx_path: Optional[str]

    # --- Logging ---
    agent_logs: list[str]
    error_message: Optional[str]
