---
description: Search teammates' Claude Code sessions for work related to a problem, feature or piece of code. Use before starting work that someone may already have done.
argument-hint: "[what to look for]"
---

Call `mcp__plugin_aim_aim__search` with `query: "$ARGUMENTS"` (if no arguments were given, use the developer's current task). Present the results as a short list: who, what they worked on, outcome, when, and the sessionId. Offer to show details for one (`mcp__plugin_aim_aim__get_session_context`) or to ask its session agent (the `aim:peer` subagent).
