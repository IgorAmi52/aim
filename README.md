<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo/aim-wordmark-on-dark.svg">
    <img src="logo/aim-wordmark.svg" alt="aim" width="240">
  </picture>
</p>

<p align="center">
  <b>Know before you build.</b><br>
  aim tells you when a teammate already solved the problem you're starting on, and lets you ask their Claude Code session about it.
</p>

---

Developers lose hours rebuilding something a teammate explored last week, or find out at merge time that someone else changed the same code. The knowledge already exists in everyone's agent sessions; nobody can see it. aim captures those sessions, turns them into searchable work cards, and checks your work against them while you use Claude Code.

## How it works

1. **Capture.** The Claude Code plugin uploads your sessions in opted-in repositories. Secrets are redacted on your machine first.
2. **Understand.** The server turns each session into a work card (intent, approach, decisions, outcome, files touched) and indexes it for vector, full-text and file-overlap search.
3. **Check.** When you start a task, leave plan mode or edit a file, aim searches teammates' work in the background, and an LLM judge decides whether it's a real **duplicate** or **collision**.
4. **Connect.** Claude asks you what to do:

   > **aim** · Ana solved this 3 days ago (PR #812): Make the Stripe webhook handler idempotent.
   > ○ Ask Ana's session agent ○ Message Ana on Slack ○ Show details ○ Ignore

   **Ask Ana's session agent** opens a subagent that has read her whole session. You can ask it why she rejected a Redis lock, what she tried, or what's left to do. It speaks about Ana, never for her, and ends with a proposed agreement you can send her.

```
 Claude Code + aim plugin                         aim server
┌──────────────────────────────┐   HTTPS   ┌─────────────────────────────────────┐
│ hooks → redact → upload      │ ────────► │ ingest → work cards → embeddings    │
│ hooks → match check (async)  │ ◄──────── │ match: retrieve → gate → judge      │
│ MCP tools · aim:peer agent   │           │ Postgres + pgvector · raw JSONL     │
└──────────────────────────────┘           └─────────────────────────────────────┘
```

## Repository

| Path | What |
|---|---|
| `packages/server` | Hono API, distiller worker, matching, Postgres + pgvector schema (Drizzle) |
| `packages/plugin` | Claude Code plugin: hooks, MCP server, `aim:peer` agent, `/aim:*` commands |
| `packages/shared` | API contracts (zod) and secret redaction, used by both |
| `demo/` | Demo repository template and recording runbook |
| `logo/` | Wordmark, icon and colours |
| `AGENTS.md` | Product spec and architecture in detail |

## Try the demo (no API keys)

Demo mode swaps embeddings, the judge, reranking and Slack for local fakes and seeds Ana's session, so you only need Docker, Node 22+, pnpm and Claude Code.

```bash
docker compose up -d
pnpm install
pnpm --filter @aim/server database:migrate
pnpm --filter @aim/plugin build

claude plugin marketplace add "$PWD"
claude plugin install aim@aim-local
echo '{"server_url":"http://localhost:4100","token":"demo-token"}' | claude plugin configure aim@aim-local --values-stdin

pnpm --filter @aim/server demo:seed
./demo/create-repository.sh          # creates ~/aim-demo/payments
pnpm --filter @aim/server demo       # api + worker on :4100
```

Open `~/aim-demo/payments` in Claude Code, run `/aim:enable` once, start a new session and type:

```
Customers sometimes get charged twice when Stripe retries the webhook. Make the handler idempotent.
```

Pick **Ask Ana's session agent** and ask `Why didn't she just use a Redis lock?`. See [`demo/README.md`](demo/README.md) for details.

## Run it for real

```bash
cp packages/server/.env.example packages/server/.env   # AIM_TOKEN, ANTHROPIC_API_KEY, VOYAGE_API_KEY, optional SLACK_BOT_TOKEN
pnpm --filter @aim/server dev
```

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://aim:aim@localhost:5432/aim` | Postgres with pgvector |
| `AIM_TOKEN` | required | Bearer token the plugin uses |
| `ANTHROPIC_API_KEY` | required | Work cards and match judge |
| `VOYAGE_API_KEY` | required | Embeddings and reranking |
| `SLACK_BOT_TOKEN` | optional | Resolve teammates to Slack DMs |
| `AIM_DISTILL_MODEL` / `AIM_JUDGE_MODEL` | `claude-haiku-4-5` | Models for summarizing and judging |
| `AIM_MATCH_CONFIDENCE_THRESHOLD` | `0.7` | Minimum judge confidence to interrupt |
| `AIM_ACTIVE_SESSION_MINUTES` | `30` | How long a session counts as active for collisions |

In the plugin, set the server URL and token in the plugin options.

## Plugin commands

| Command | |
|---|---|
| `/aim:enable` | Turn aim on for this repository and optionally import the last 30 days of sessions |
| `/aim:disable` | Turn it off for this repository |
| `/aim:pause` | Stop capture for the rest of this session |
| `/aim:status` | Show what's enabled and what was uploaded |
| `/aim:search <query>` | Search teammates' sessions |
| `/aim:import [days]` | Import past sessions for this repository |

## Privacy

- Nothing is captured until you enable a repository.
- Transcripts are redacted on your machine (keys, tokens, connection-string passwords, assigned secrets) and again on the server.
- Tool output is never sent to the LLM; work cards are built from the conversation only.
- Session agents answer *about* a teammate's work and never commit them to anything.

## Status

MVP: one company, Claude Code only, self-hosted. Next up: GitHub App for merge outcomes and access control, notifying owners when their session is consulted, and opening a teammate's full session in its own window. See [`AGENTS.md`](AGENTS.md) for the full plan.
