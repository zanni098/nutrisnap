"""MCP server — exposes NutriSnap's wellness tools over the Model Context Protocol.

This is the same tool registry the in-process ReAct agent uses (``agent/tools.py``),
re-published as a standard **MCP server** so *any* MCP-compatible client — Claude
Desktop, the Gemini / Agents CLI, or another agent — can call the NutriSnap tools
directly over stdio. It demonstrates the course's MCP module: a clean, typed tool
boundary decoupled from the agent that consumes it.

Tools exposed:
    parse_food_image        vision analysis of a meal photo (Gemini or mock)
    fetch_logged_macros     read the nutrition diary
    calculate_trajectory    quantify intake vs goals; surface deficits + trends
    generate_wellness_plan  corrective plan + grocery list from the trajectory
    log_meal                commit an approved analysis to the diary

Run (stdio transport):
    python -m agent.mcp_server

Register with an MCP client (example ``mcpServers`` entry):
    {
      "nutrisnap": {
        "command": "python",
        "args": ["-m", "agent.mcp_server"],
        "cwd": "<path to nutrisnap repo>"
      }
    }
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from . import data_store, tools

mcp = FastMCP(
    "nutrisnap-wellness",
    instructions=(
        "NutriSnap wellness tools. Always read history (fetch_logged_macros) and "
        "quantify the trajectory (calculate_trajectory) BEFORE judging any single "
        "meal. Never fabricate nutrition data for a non-food image."
    ),
)


@mcp.tool()
def parse_food_image(image_path: str) -> dict[str, Any]:
    """Analyze a meal photo: per-item nutrition, totals, healthScore (1-10),
    confidence (0-1). Rejects non-food images (isNonFood=True) instead of guessing."""
    return tools.parse_food_image(image_path)


@mcp.tool()
def fetch_logged_macros(days: int = 7) -> dict[str, Any]:
    """Read the nutrition diary: per-day macro totals + meal list for the last N
    days, plus the user's profile goals."""
    return tools.fetch_logged_macros(days)


@mcp.tool()
def calculate_trajectory(days: int = 7) -> dict[str, Any]:
    """Compare average intake vs goals over N days; returns deficits, surpluses,
    and the health-score trend (declining/improving)."""
    return tools.calculate_trajectory(days)


@mcp.tool()
def generate_wellness_plan(focus: str = "general wellness") -> dict[str, Any]:
    """Build a corrective action plan and grocery list that closes the gaps found
    in the current trajectory."""
    return tools.generate_wellness_plan(focus)


@mcp.tool()
def log_meal(analysis: dict[str, Any], meal_type: str = "lunch",
             servings: float = 1.0) -> dict[str, Any]:
    """Commit an approved meal analysis to the diary. Refuses non-food analyses."""
    return tools.log_meal(analysis, meal_type, servings)


def main() -> None:
    # Ensure the demo diary exists so a fresh client sees data immediately.
    data_store.seed_demo_history(force=False)
    mcp.run()  # stdio transport


if __name__ == "__main__":
    main()
