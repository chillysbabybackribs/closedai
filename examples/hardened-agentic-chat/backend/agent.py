"""Hardened LangGraph Agent backend with robust token streaming,
checkpointed memory, exception safety, and cancellation awareness.
"""

import os
import sys
import json
import asyncio
from typing import AsyncGenerator, Dict, Any, Optional, List

# Check dependencies or provide fallback typing
try:
    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, BaseMessage
    from langchain_core.runnables import RunnableConfig
    from langgraph.graph import StateGraph, START, END, MessagesState
    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.errors import GraphRecursionError
    LANGGRAPH_AVAILABLE = True
except ImportError:
    LANGGRAPH_AVAILABLE = False


def create_hardened_agent(
    model_name: Optional[str] = None,
    system_prompt: str = "You are a helpful, concise AI assistant.",
    recursion_limit: int = 50,
):
    """Factory creating a production-hardened LangGraph agent with state checkpointing."""
    if not LANGGRAPH_AVAILABLE:
        return None

    from langchain_openai import ChatOpenAI

    selected_model = model_name or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    api_key = os.getenv("OPENAI_API_KEY", "")

    # Configure model with explicit streaming, timeout, and retries
    llm = ChatOpenAI(
        model=selected_model,
        api_key=api_key or "placeholder",
        streaming=True,
        request_timeout=30.0,
        max_retries=2,
    )

    class AgentState(MessagesState):
        """Extended conversation state."""
        reasoning_active: bool = False

    # Define Agent Node
    async def call_model(state: AgentState, config: RunnableConfig):
        messages = [SystemMessage(content=system_prompt)] + state["messages"]
        response = await llm.ainvoke(messages, config=config)
        return {"messages": [response]}

    # Build Graph
    builder = StateGraph(AgentState)
    builder.add_node("agent", call_model)
    builder.add_edge(START, "agent")
    builder.add_edge("agent", END)

    # In-memory checkpointer preserves thread history across turns
    checkpointer = MemorySaver()
    return builder.compile(checkpointer=checkpointer)


async def stream_agent_events(
    graph,
    user_message: str,
    thread_id: str = "default-thread",
    recursion_limit: int = 50,
) -> AsyncGenerator[str, None]:
    """Consumes LangGraph v2 stream events and yields standard SSE formatted strings.
    
    Catches recursion limits, network timeouts, and model errors mid-stream
    without dropping the HTTP connection.
    """
    config: RunnableConfig = {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": recursion_limit,
    }

    input_state = {
        "messages": [HumanMessage(content=user_message)]
    }

    try:
        # astream_events v2 captures fine-grained token-level streaming events
        async for event in graph.astream_events(input_state, config=config, version="v2"):
            kind = event.get("event")

            # 1. Token chunk from LLM
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content") and chunk.content:
                    delta = chunk.content
                    yield f"data: {json.dumps({'type': 'text-delta', 'delta': delta})}\n\n"

            # 2. Tool call events
            elif kind == "on_tool_start":
                tool_name = event.get("name", "tool")
                tool_id = event.get("run_id", "tool-call")
                yield f"data: {json.dumps({'type': 'tool-call-start', 'id': str(tool_id), 'name': tool_name})}\n\n"

            elif kind == "on_tool_end":
                tool_output = event.get("data", {}).get("output", "")
                tool_id = event.get("run_id", "tool-call")
                yield f"data: {json.dumps({'type': 'tool-result', 'id': str(tool_id), 'result': str(tool_output)})}\n\n"

        # Signal completion
        yield f"data: {json.dumps({'type': 'done', 'stopReason': 'end_turn'})}\n\n"

    except GraphRecursionError:
        yield f"data: {json.dumps({'type': 'error', 'code': 'RECURSION_LIMIT_EXCEEDED', 'message': 'Agent reached maximum step limit.'})}\n\n"

    except asyncio.CancelledError:
        # Client aborted the request
        yield f"data: {json.dumps({'type': 'error', 'code': 'CLIENT_ABORTED', 'message': 'Stream aborted by client.'})}\n\n"
        raise

    except Exception as exc:
        # Graceful mid-stream error formatting
        yield f"data: {json.dumps({'type': 'error', 'code': 'STREAM_EXECUTION_FAILED', 'message': str(exc)})}\n\n"


if __name__ == "__main__":
    print("Hardened LangGraph agent module ready.")
