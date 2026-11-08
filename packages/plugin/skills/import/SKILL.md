---
description: Import your past Claude Code sessions for this repository into aim.
disable-model-invocation: true
argument-hint: "[days, default 30]"
---

Call `mcp__plugin_aim_aim__import_history` with `confirm: false` (and `days` set to $ARGUMENTS if a number was given) to preview. Show the count, the total size and a few titles, and use AskUserQuestion to confirm. Only after the developer agrees, call it again with `confirm: true` and the same `days`.
