"""LLM service — Claude Sonnet (primary) + GPT-4o (fallback)."""

from __future__ import annotations

import logging
from typing import Type, TypeVar

from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from pydantic import BaseModel

from config import ANTHROPIC_API_KEY, OPENAI_API_KEY, PRIMARY_MODEL, FALLBACK_MODEL

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Singletons
_claude: ChatAnthropic | None = None
_gpt4o: ChatOpenAI | None = None


def get_claude() -> ChatAnthropic:
    global _claude
    if _claude is None:
        _claude = ChatAnthropic(
            model=PRIMARY_MODEL,
            anthropic_api_key=ANTHROPIC_API_KEY,
            max_tokens=32000,
            temperature=0.2,
        )
    return _claude


def get_gpt4o() -> ChatOpenAI:
    global _gpt4o
    if _gpt4o is None:
        _gpt4o = ChatOpenAI(
            model=FALLBACK_MODEL,
            openai_api_key=OPENAI_API_KEY,
            max_tokens=16384,
            temperature=0.2,
        )
    return _gpt4o


async def call_llm(
    system_prompt: str,
    user_prompt: str,
    output_schema: Type[T] | None = None,
    temperature: float = 0.2,
) -> str | T:
    """Call the primary LLM (Claude), falling back to GPT-4o on failure.

    If *output_schema* is provided the response is parsed into that Pydantic
    model using structured output.  Otherwise a plain string is returned.
    """
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]

    # --- Try Claude first ---
    try:
        llm = get_claude()
        if output_schema is not None:
            structured = llm.with_structured_output(output_schema)
            result = await structured.ainvoke(messages)
            return result  # type: ignore[return-value]
        resp = await llm.ainvoke(messages)
        return resp.content  # type: ignore[return-value]
    except Exception as exc:
        logger.warning("Claude call failed (%s), falling back to GPT-4o", exc)

    # --- Fallback to GPT-4o ---
    try:
        llm = get_gpt4o()
        if output_schema is not None:
            structured = llm.with_structured_output(output_schema)
            result = await structured.ainvoke(messages)
            return result  # type: ignore[return-value]
        resp = await llm.ainvoke(messages)
        return resp.content  # type: ignore[return-value]
    except Exception as exc:
        logger.error("GPT-4o fallback also failed: %s", exc)
        raise


async def call_llm_plain(system_prompt: str, user_prompt: str) -> str:
    """Convenience wrapper — always returns a string."""
    result = await call_llm(system_prompt, user_prompt)
    return str(result)
