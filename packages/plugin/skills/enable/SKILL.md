---
description: Turn on aim for this repository so your sessions are shared with your team and checked against their work.
disable-model-invocation: true
---

1. Call `mcp__plugin_aim_aim__set_repository_enabled` with `enabled: true`.
2. Tell the developer in two or three sentences what this means: transcripts of their Claude Code sessions in this repository are uploaded to the team's aim server after secrets are redacted on this machine; aim warns them while they work when a teammate already solved the same problem or is changing the same code; `/aim:pause` stops capture for one session and `/aim:disable` turns it off for the repository.
3. Call `mcp__plugin_aim_aim__import_history` with `confirm: false` to preview past sessions for this repository. If there are any, use AskUserQuestion to ask whether to import them (show the count and a few titles). Only if they agree, call it again with `confirm: true`.
