"""NutriSnap Agent — autonomous Proactive Wellness Critic layer.

Wraps the existing NutriSnap vision/logging features as LLM-callable tools
and runs them inside a ReAct (Reason + Act) execution loop.

Public surface:
    agent.tools       — the tool registry the LLM can invoke
    agent.data_store  — JSON bridge mirroring the app's localStorage schema
    agent.memory      — short-term scratchpad + long-term profile state
    agent.guardrails  — runtime safety checks and threshold validation
    agent.llm_client  — Gemini-primary LLM client with offline mock mode
"""

__version__ = "1.0.0"
