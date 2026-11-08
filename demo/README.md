# aim demo

A ~30-second recording: Igor asks Claude to fix double charges from Stripe webhook retries, aim shows that Ana already solved it three days ago (PR #812), and Igor asks Ana's session agent why she didn't use a Redis lock.

The server runs in demo mode (`AIM_DEMO_MODE=true`): local hashed embeddings, a rule-based judge and keyword reranking, so no Anthropic, Voyage or Slack keys are needed. Claude Code itself runs on your normal plan.

## One-time setup

From the aim repository root:

```bash
docker compose up -d
pnpm install
pnpm --filter @aim/server database:migrate
pnpm --filter @aim/plugin build

claude plugin marketplace add "$PWD"
claude plugin install aim@aim-local
echo '{"server_url":"http://localhost:4100","token":"demo-token"}' | claude plugin configure aim --values-stdin
```

## Before every take

```bash
pnpm --filter @aim/server demo:seed        # resets Ana's session and her matches
./demo/create-repository.sh                # fresh ~/aim-demo/payments with the bug, git identity "Igor"
pnpm --filter @aim/server demo             # api + worker; leave it running
```

The first time only: open `~/aim-demo/payments` in the Claude Desktop app (Code tab), run `/aim:enable` and decline the history import. The repository stays enabled for later takes because the path doesn't change.

Then start a **new** session for each take (a session only checks its first prompt).

## The take

1. Type: `Customers sometimes get charged twice when Stripe retries the webhook. Make the handler idempotent.`
2. Claude reads `webhookHandler.ts`, and the aim question appears: Ana solved this 3 days ago (PR #812).
3. Pick **Ask Ana's session agent**.
4. When asked, type: `Why didn't she just use a Redis lock?`
5. Ana's agent explains that Stripe retries for up to 3 days, long after a lock expires, and proposes reusing her `processed_webhook_events` table.

## Troubleshooting

- No question appears: check `~/.claude/plugins/data/*/aim.log` and that `curl localhost:4100/health` answers.
- Already-seen match: re-run `demo:seed` and start a new session.
