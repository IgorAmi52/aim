# aim

Proactive work awareness for AI coding sessions. aim captures every developer's agent sessions, turns them into searchable knowledge, and — while you work — quietly checks whether someone else already solved your problem or is changing the same thing right now. When it finds a real match, it offers to connect you: a Slack message to that person, or a subagent that carries their session's context so you can ask it questions.

Think "proactive Glean for agent sessions": Glean answers questions you ask; aim answers the question you didn't know to ask.

## Problem

- Developers spend hours exploring an idea, only to learn a teammate explored (or rejected) the same idea last week.
- Two developers change the same module in parallel with contradictory decisions and only find out at merge time.
- The knowledge exists — it's sitting in agent session transcripts — but nobody can see it.

## Goals

1. **Prevent duplicate work** — surface prior art from past sessions before you invest in the same problem.
2. **Prevent collisions** — surface concurrent sessions that touch the same code or make contradicting decisions.
3. **Make the match actionable** — one selection away from talking to the person or to an agent with their context.
4. **Stay quiet unless it matters** — precision over recall. A noisy proactive tool gets uninstalled.

## Non-goals (MVP)

- Multi-tenant SaaS, billing, org isolation (MVP is an internal, single-company tool).
- Agents other than Claude Code (Cursor, Codex, …).
- Cloud-hosted peer agents (MVP runs the peer agent locally as a Claude Code subagent).
- Web dashboard.
- Graph/knowledge-graph storage.

## Concepts

| Term | Meaning |
|---|---|
| **Session** | One Claude Code session (`session_id`), by one developer, in one repo. |
| **Raw transcript** | The session's JSONL, redacted on the developer's machine, uploaded incrementally. Source of truth, never edited. |
| **Work card** | LLM-distilled, structured summary of a session: intent, approach, decisions (with reasons), outcome, files/symbols touched. The unit we search over. Updated as the session progresses. |
| **Condensed transcript** | The raw transcript reduced to user and assistant text plus one line per tool call. Tool output (about 80% of tokens) is dropped. Input to the distiller and source of peer-agent excerpts. |
| **Match** | A judged relationship between the current session and another session. |
| **Match type** | `duplicate` — someone already solved/explored this. `collision` — someone is concurrently changing the same thing or deciding the opposite. |
| **Peer agent** | A subagent seeded with another session's work card and relevant excerpts, so you can ask "what did you do and why?". It explains; it cannot agree on anyone's behalf. |

## System overview

Two independently deployed parts sharing one contract:

```
┌──────────────────────────── developer machine ────────────────────────────┐
│ Claude Code + aim plugin                                                  │
│   hooks ──► local spool ──► background uploader (redacts) ─────────────┐  │
│   hooks ──► background matcher ──► pending match ──► next hook injects │  │
│   MCP server (aim_* tools) ◄──── Claude / peer subagent               │  │
└───────────────────────────────────────────────────────────────────────┼──┘
                                                                        │ HTTPS
┌──────────────────────────── aim server ───────────────────────────────▼──┐
│ API: ingest · match · session context · people/slack                     │
│ Distiller worker: condensed transcript → work card + embedding           │
│ Postgres + pgvector (all queryable state)   Blob store (raw JSONL)       │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Production:** server hosted centrally, ingesting sessions from every repo.
- **Demo:** server runs locally as its own process (`docker compose` for Postgres), one repo. Same code path, same database schema — repo is just a field.

## Part 1 — aim server

### Storage

One Postgres database (with `pgvector`) holds everything queryable. Raw transcripts live in a blob store (local directory for demo, S3 in production) referenced by URI. RAG is not a separate store; it is the distiller + match logic over this database.

Core tables:

| Table | Key fields |
|---|---|
| `people` | `email` (from git config), `display_name`, `slack_user_id`, `slack_checked_at` |
| `sessions` | `id` (Claude Code session id), `person_id`, `repository` (normalized remote URL), `repository_root_path`, `branch`, `working_directory`, `edited_files` (repo-relative, text[]), `pull_request_urls`, `source_byte_offset`, `distilled_byte_offset`, `started_at`, `last_activity_at`, `distill_requested_at`, `distilled_at` |
| `work_cards` | `session_id`, `title`, `intent`, `approach`, `decisions` (jsonb: `[{decision, reason}]`), `outcome` (`in_progress` \| `solved` \| `abandoned`), `symbols`, `search_document`, `search_vector` (generated tsvector), `embedding` (vector 1024), `updated_at` |
| `matches` | `source_session_id`, `target_session_id` (unique pair), `type`, `confidence`, `reason`, `user_action` (`slack` \| `peer_agent` \| `details` \| `ignored`), `acted_at` |

`sessions` holds deterministic facts extracted at ingest; `work_cards` holds LLM output. `matches.user_action` is the feedback loop for tuning thresholds. Transcript excerpts are not embedded ahead of time; they are ranked on demand (see Session context).

### Ingestion

- `POST /transcripts` — appends a JSONL slice with session metadata and source byte offsets (offsets refer to the developer's original file). Content must end on a line boundary. Overlapping resends are acknowledged, gaps return `409` with the expected offset. Creates the person and session on first call.
- Server re-runs secret redaction (`@aim/shared` `redactTranscript`) as a second line of defense.
- Deterministic facts are extracted immediately: edited files (from `Edit`/`Write`/`MultiEdit`/`NotebookEdit`, made repo-relative, paths outside the repo dropped), PR links (`pr-link` records), branch, activity timestamps.
- Each append sets `distill_requested_at`. The worker distills a session after 2 minutes without new data (`AIM_DISTILL_DEBOUNCE_SECONDS`), or at least every 15 minutes while it keeps changing (`AIM_DISTILL_MAXIMUM_WAIT_SECONDS`). The queue is the `sessions` table, with no separate broker.

### Distiller worker

Per session, after new data lands (debounced):

1. Read the raw transcript from `distilled_byte_offset` and condense it.
2. **Work card:** Haiku (`claude-haiku-4-5`, structured output) updates the previous card from the new excerpt (excerpts over 300K characters are processed in sequence).
3. **Embed** the card (title, intent, approach, decisions, symbols) with Voyage `voyage-4-lite`; the full-text document also includes edited files.
4. Failures postpone the session by one debounce period.

A session is **active** if `last_activity_at` is within a configurable window (default 30 min).

### Matching

`POST /matches/search` with `{ session, intentText, editedFiles }`. The caller's session is created if needed, and its activity and edited files are recorded, so collisions are visible before its first upload.

1. **Candidates** (excluding the caller's own sessions and sessions already matched for this session), from:
   - top 20 by vector similarity on `work_cards.embedding`, kept only above `AIM_MINIMUM_SIMILARITY` (default 0.4)
   - top 20 by full-text rank on `work_cards.search_vector` (any-word query)
   - active sessions (`AIM_ACTIVE_SESSION_MINUTES`, default 30) whose `edited_files` overlap the caller's
2. **Gate** — if neither strong similarity nor file overlap produced a candidate, return no matches without calling the LLM. Text matches alone never trigger the judge.
3. **Score fusion** — reciprocal rank fusion; file overlap weighs double. Top 8 go to the judge.
4. **Judge** — `AIM_JUDGE_MODEL` (default Haiku) returns per candidate `{ type: duplicate | collision | unrelated, confidence, reason }`.
5. Return up to 3 matches above `AIM_MATCH_CONFIDENCE_THRESHOLD` (default 0.7), persisted to `matches`. A target is returned at most once per source session.

Matching runs across all repos. Same-repo and file-overlap signals rank higher; cross-repo matches must clear the judge on intent alone.

### Session context (for the peer agent)

`GET /sessions/:sessionId/context?focus=<text>` → session summary, approach, decisions, owner, and up to 6 excerpts. The condensed transcript is split into ~6K-character passages. With `focus`, Voyage `rerank-3-lite` picks the most relevant passages (from the latest 200) and returns them in chronological order; without it, the latest passages are returned. Excerpts are already redacted.

### People / Slack

- Resolve `email → slack_user_id` via Slack `users.lookupByEmail` (bot token on server), cached in `people`; misses are retried after a day. Owners in match, search and context responses carry `slack: { userId, deepLink }` or `null`.
- The plugin drafts the message (Claude has the context); the server only provides the contact. Posting via bot is a later option.

### Other endpoints

- `POST /matches/:matchId/action` `{ action }` records the developer's choice.
- `POST /search` `{ query, repositoryRemoteUrl?, limit? }` is manual search (vector + full text, no judge).
- `GET /sessions?personEmail=` lists a developer's uploaded sessions (for `/aim status`).
- `GET /health` needs no auth. Everything else requires `Authorization: Bearer $AIM_TOKEN`.

Request and response schemas live in `packages/shared/src/contracts.ts`.

### Auth (MVP)

Single shared bearer token per deployment. Developer identity = git `user.email`. Real SSO is post-MVP.

## Part 2 — aim Claude Code plugin

A standard Claude Code plugin (works in CLI, Desktop app Code tab, IDE extensions), named `aim`.

```
packages/plugin/
  .claude-plugin/plugin.json   # manifest + userConfig (server_url, token)
  hooks/hooks.json             # every hook runs: node dist/aim.mjs hook
  .mcp.json                    # MCP server "aim": node dist/aim.mjs mcp
  agents/peer.md               # subagent aim:peer
  skills/<name>/SKILL.md       # /aim:enable, /aim:disable, /aim:pause, /aim:status, /aim:search, /aim:import
  src/                         # bundled by esbuild into dist/aim.mjs
```

`dist/aim.mjs` is one bundled script with subcommands: `hook`, `mcp`, and the background commands `upload`, `match` and `import`. Hooks spawn the background commands as detached processes and return in about 50–100 ms; they never wait on the network.

Local state lives in `${CLAUDE_PLUGIN_DATA}`, falling back to `~/.aim`:
- `repositories.json`: repo roots the developer opted in to
- `sessions/<id>/session.json`: metadata, intent, edited files, paused flag
- `sessions/<id>/upload-offset.json`
- `sessions/<id>/pending-matches.json`: matches waiting to be shown
- `aim.log`: background errors

### Capture

| Hook | Action |
|---|---|
| `SessionStart`, `UserPromptSubmit`, `Stop` | Create the session state if the repo is enabled. Identity comes from git `user.email` / `user.name`, the repository from the remote URL and from a root derived from the working directory (so symlinked paths still match). |
| `Stop`, `PreCompact`, `SessionEnd` | Spawn the uploader. |

The uploader reads `transcript_path` from its last offset, sends complete lines only (up to 4 MB per request), **redacts locally** with `@aim/shared` `redactTranscript`, and follows the server's `409` expected offset. Concurrent or repeated uploads are safe because the server deduplicates by offset. Uploading after every exchange keeps file collisions fresh, while the server's distill debounce controls LLM cost.

### Detection

Detection is asynchronous. A hook updates the session state and spawns `match`, which calls `POST /matches/search` and writes the result to `pending-matches.json`. The **next** `UserPromptSubmit` or `PostToolUse` (any tool) claims the pending matches and injects them as `additionalContext`.

Triggers:
- The first `UserPromptSubmit` with at least 20 characters that isn't a slash command (prompt = intent).
- `PostToolUse` on `ExitPlanMode` (the plan replaces the intent).
- `PostToolUse` on `Edit`/`Write`/`MultiEdit`/`NotebookEdit` touching a repo file not yet checked (sent as `editedFiles`).

The server returns each target session at most once per source session.

### Presentation

The injected context (`src/presentation.ts`) lists each match (who, title, type, outcome, activity, PRs, reason, matchId, sessionId, Slack availability). It tells Claude to call **AskUserQuestion** once, with one question per match and the options:

> - Ask Ana's session agent
> - Message Ana on Slack (or "Draft a message to Ana" when there is no Slack contact)
> - Show details
> - Ignore

Claude then records the choice (`report_match_action`) and acts on it. Peer agent: launch `aim:peer`. Slack: draft a message and show the DM link, never send it. Details: summarize the session context. Afterwards it continues with the developer's task.

### Peer agent

`agents/peer.md` (`aim:peer`) can only call `get_session_context`. It answers from the work card and the reranked excerpts, says when something isn't in the session, speaks about the owner in the third person, and never commits them to anything. When the developers need to settle something, it ends with a **Proposed agreement** the developer can send to the owner.

### MCP tools

Claude sees them as `mcp__plugin_aim_aim__<tool>`.

| Tool | Purpose |
|---|---|
| `search` | Search teammates' sessions (optionally this repo only). |
| `get_session_context` | Work card, owner and focused excerpts for a session. |
| `report_match_action` | Record the developer's choice on a match. |
| `status` | Repo, enabled flag, git identity, recently uploaded sessions. |
| `set_repository_enabled` | Opt the current repo in or out. |
| `pause_session` | Stop capture and matching for the rest of a session (the skill passes `${CLAUDE_SESSION_ID}`). |
| `import_history` | Preview (`confirm: false`) or import in the background (`confirm: true`) the past N days of local transcripts whose `cwd` is inside the repo. |

### Commands (skills)

`/aim:enable` turns aim on, explains what is shared, and offers to import history. The other commands are `/aim:disable`, `/aim:pause`, `/aim:status`, `/aim:search <query>` and `/aim:import [days]`. Only `search` can also be invoked by Claude on its own.

### Configuration

Plugin options (`userConfig`): `server_url` and `token` (sensitive). Hook and MCP processes receive them as `CLAUDE_PLUGIN_OPTION_SERVER_URL` / `CLAUDE_PLUGIN_OPTION_TOKEN`, with `AIM_SERVER_URL` / `AIM_TOKEN` env vars as a fallback for development. Repos are **opt-in** per developer.

## Privacy & trust

Adoption depends on developers trusting aim more than on retrieval quality.

- Opt-in per repo; `/aim pause` per session.
- Redaction on the developer's machine before anything leaves it; server re-checks.
- Developers can see what was uploaded for their sessions (`/aim status`).
- Configurable retention for raw transcripts.
- Post-MVP: owners are notified when someone's peer agent reads their session; access scoped to people who can see the repo.

## Tech stack

- TypeScript everywhere, Node 22+, pnpm workspaces.
- Server: Hono, Postgres 17 + pgvector, Drizzle.
- LLM: Claude Haiku 4.5 for distillation and judging. The peer agent runs inside the developer's Claude Code, so it uses their model — no server-side generation for it.
- Embeddings and reranking: Voyage AI (`voyage-4-lite`, `rerank-3-lite`).
- Shared request/response schemas (zod) and redaction in `@aim/shared`, used by both parts (TypeScript source, run with `tsx`).

```
aim/
  packages/
    server/    # API, distiller worker, matching, migrations
    plugin/    # Claude Code plugin
    shared/    # zod contracts and shared types
  docker-compose.yml   # postgres + pgvector for local/demo
```

## Development

```bash
docker compose up -d                     # Postgres 17 + pgvector on :5432
pnpm install
cp packages/server/.env.example packages/server/.env   # fill in keys
pnpm --filter @aim/server database:migrate
pnpm --filter @aim/server dev            # api (:4100) + worker
pnpm --filter @aim/plugin build         # bundles packages/plugin/dist/aim.mjs
claude --plugin-dir packages/plugin      # load the plugin in Claude Code
pnpm typecheck
```

Schema changes: edit `packages/server/src/database/schema.ts`, then `pnpm --filter @aim/server database:generate` and commit the generated SQL in `packages/server/drizzle/`. Raw transcripts are stored in `packages/server/data/raw/` (S3 in production).

## Cost

Measured on real Claude Code transcripts: a median developer day is ~170K tokens raw, ~45K after dropping tool output (p90: 1.2M / 235K). With Haiku for distilling and judging, LLM cost is about $7/month for a median developer and $24 for a heavy one (~$10 blended). LLM spend is 85–90% of the total and grows linearly; hosting is small. Levers: distill less often for active sessions, judge only past the retrieval gate, Batch API for finished sessions.

## Onboarding & adoption

- **Import history:** Claude Code keeps local transcripts for 30 days. On first run the plugin offers to import them for opted-in repos (redacted, previewed). That gives day-one duplicate detection for about $1 per developer.
- **Roll out by team:** collision value depends on density, meaning people working in the same code at the same time. Pilot with one team of 8–20 developers on shared repos, then expand to neighbouring teams.
- **Shadow mode first:** compute matches without showing them for about a week, review samples, set the threshold, then turn interruptions on.
- **Trust before launch:** legal / works-council review, no per-person activity dashboards, opt-in per repo, visible pause.
- **Git access:** not needed for the MVP (the plugin sees remote, branch, edited files and PR links locally). Phase 2: a read-only GitHub App for merge outcomes, access control, PR-based history import and file ownership.
- **Success metric:** useful matches per developer per week (target ~1, with under 30% ignored).

## MVP demo (success criteria)

1. Developer A works in the demo repo on feature X; session is captured and a work card appears in the database within a minute of a `Stop`.
2. Developer B (different git identity) starts a session describing the same problem in different words → within one or two turns, Claude presents the aim picker naming A's session.
3. B chooses "Ask session agent" → the peer subagent answers "why did you choose approach Y?" from A's session context.
4. B chooses "Message on Slack" → gets a drafted message with context and a DM link to A.
5. B edits a file A is actively editing → aim surfaces a `collision` match.
6. An unrelated prompt produces no match (no false positive in the demo script).

## Open questions

- Judge model: Haiku (default) vs Sonnet 5.5 (2× the price; judge precision decides whether aim is useful or noise).
- Active-session window and match threshold defaults — tune from `matches.user_action` data.
- Retention period for raw transcripts.
- Slack: deep link + draft (MVP) vs bot posting on the developer's behalf.
- Should the session owner be notified (or asked) when their session is used as a peer agent?
- Git worktrees and monorepos: normalize repo identity by remote URL + path prefix?
