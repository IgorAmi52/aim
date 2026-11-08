import { rm } from "node:fs/promises";
import path from "node:path";
import { eq, inArray, or } from "drizzle-orm";
import { configuration } from "./configuration";
import { database } from "./database/client";
import { matches, people, sessions, workCards } from "./database/schema";
import { cardDocument, type WorkCard } from "./distiller";
import { appendRawTranscript } from "./rawStore";
import { embedText } from "./voyage";

const anaSessionId = "0a7c3e52-5d1b-4f6e-9c2a-812000000812";
const anaEmail = "ana.kovac@acme.dev";
const repositoryRootPath = "/Users/ana/code/payments";
const pullRequestUrl = "https://github.com/acme/payments/pull/812";

type Turn = { user: string } | { assistant: string } | { tool: string; input: Record<string, unknown> };

const turns: Turn[] = [
  {
    user: "Support ticket: some customers were charged twice for one order. The logs show Stripe delivered payment_intent.succeeded twice for the same event id, about 40 minutes apart. Can you find out why we process it twice?",
  },
  { tool: "Read", input: { file_path: `${repositoryRootPath}/src/payments/webhookHandler.ts` } },
  { tool: "Read", input: { file_path: `${repositoryRootPath}/src/payments/charges.ts` } },
  {
    assistant:
      "handleStripeWebhook creates a charge and starts fulfillment for every delivery it receives. Nothing checks whether the event was already processed. Fulfillment takes around 12 seconds, so Stripe times out waiting for our 200 and retries, and the retry creates a second charge and a second fulfillment.",
  },
  { user: "Could we just put a Redis lock around the handler?" },
  {
    assistant:
      "A lock only helps when two deliveries overlap in time. Stripe retries with exponential backoff for up to 3 days, so most duplicates arrive long after any lock has expired. The 40-minute gap in your logs is exactly that case. We need a durable record of which events were processed, not a lock.",
  },
  { user: "Ok, what do you suggest?" },
  {
    assistant:
      "Store every processed Stripe event id in a processed_webhook_events table with the event id as primary key, and insert it in the same database transaction as the charge. If the insert conflicts, the event was already handled and we return 200 without doing anything. I would also move fulfillment to a background job so we answer Stripe within a second and stop triggering retries.",
  },
  { user: "Do the table and the check now. The background job can be a separate PR." },
  { tool: "Write", input: { file_path: `${repositoryRootPath}/migrations/004_processed_webhook_events.sql` } },
  { tool: "Edit", input: { file_path: `${repositoryRootPath}/src/payments/webhookHandler.ts` } },
  { tool: "Edit", input: { file_path: `${repositoryRootPath}/src/payments/charges.ts` } },
  { tool: "Bash", input: { command: "npm test -- webhookHandler" } },
  {
    assistant:
      "Added the migration, and createCharge now runs in one transaction with INSERT INTO processed_webhook_events ... ON CONFLICT DO NOTHING. A replayed event returns 200 and creates nothing. I added a test that delivers the same event twice; all 14 webhook tests pass.",
  },
  { user: "Should we key on the payment intent id instead of the event id?" },
  {
    assistant:
      "No. One payment intent produces several events we handle on purpose (created, processing, succeeded). The event id is what Stripe repeats on retries, so it is the right idempotency key. Keying on the payment intent would drop legitimate events.",
  },
  { user: "Makes sense. Open a PR." },
  { tool: "Bash", input: { command: 'gh pr create --title "Make the Stripe webhook handler idempotent" --fill' } },
  {
    assistant:
      "Opened PR #812. It is waiting for review. Follow-up noted: move fulfillment to a background job so the webhook answers quickly (not part of this PR).",
  },
];

const workCard: WorkCard = {
  title: "Make the Stripe webhook handler idempotent",
  intent:
    "Customers were charged twice for one order because Stripe retries the payment webhook when our handler responds slowly, and every delivery of the same event created a new charge.",
  approach:
    "Record each processed Stripe event id in a processed_webhook_events table, inserted in the same transaction as the charge with ON CONFLICT DO NOTHING, so a repeated event returns 200 without creating anything. Covered by a test that replays the same event twice.",
  decisions: [
    {
      decision: "Rejected a Redis lock around the handler",
      reason: "Stripe retries for up to 3 days, long after a lock expires, so it would not stop most duplicates",
    },
    {
      decision: "Use the Stripe event id as the idempotency key, not the payment intent id",
      reason: "One payment intent produces several legitimate events; the event id is what repeats on retries",
    },
    {
      decision: "Move fulfillment to a background job in a follow-up PR",
      reason: "Answering Stripe within a second avoids triggering retries in the first place",
    },
  ],
  outcome: "solved",
  symbols: ["handleStripeWebhook", "createCharge", "processed_webhook_events", "payment_intent.succeeded"],
};

function toTranscript(startedAt: Date): string {
  const records = turns.map((turn, index) => {
    const timestamp = new Date(startedAt.getTime() + index * 90_000).toISOString();
    const base = { timestamp, cwd: repositoryRootPath, gitBranch: "fix/webhook-idempotency", sessionId: anaSessionId, isSidechain: false };
    if ("user" in turn) {
      return { ...base, type: "user", message: { role: "user", content: turn.user } };
    }
    if ("assistant" in turn) {
      return { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "text", text: turn.assistant }] } };
    }
    return {
      ...base,
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", id: `tool-${index}`, name: turn.tool, input: turn.input }] },
    };
  });
  records.push({ type: "pr-link", prUrl: pullRequestUrl, timestamp: records.at(-1)!.timestamp } as never);
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

const startedAt = new Date(Date.now() - 3 * 86_400_000 - 2 * 3_600_000);
const lastActivityAt = new Date(startedAt.getTime() + turns.length * 90_000);
const editedFiles = ["migrations/004_processed_webhook_events.sql", "src/payments/webhookHandler.ts", "src/payments/charges.ts"];

await database.delete(matches).where(or(eq(matches.targetSessionId, anaSessionId), eq(matches.sourceSessionId, anaSessionId)));
await database.delete(workCards).where(eq(workCards.sessionId, anaSessionId));
await database.delete(sessions).where(eq(sessions.id, anaSessionId));
await database.delete(people).where(inArray(people.email, [anaEmail]));
await rm(path.join(configuration.AIM_RAW_STORE_PATH, `${anaSessionId}.jsonl`), { force: true });

const [ana] = await database.insert(people).values({ email: anaEmail, displayName: "Ana Kovač" }).returning();
const transcript = toTranscript(startedAt);
await appendRawTranscript(anaSessionId, transcript);
await database.insert(sessions).values({
  id: anaSessionId,
  personId: ana.id,
  repository: "github.com/acme/payments",
  repositoryRootPath,
  branch: "fix/webhook-idempotency",
  workingDirectory: repositoryRootPath,
  editedFiles,
  pullRequestUrls: [pullRequestUrl],
  sourceByteOffset: Buffer.byteLength(transcript),
  distilledByteOffset: Buffer.byteLength(transcript),
  startedAt,
  lastActivityAt,
  distilledAt: lastActivityAt,
});

const document = cardDocument(workCard);
await database.insert(workCards).values({
  sessionId: anaSessionId,
  ...workCard,
  searchDocument: `${document}\n\nFiles: ${editedFiles.join(" ")}`,
  embedding: await embedText(document, "document"),
  updatedAt: lastActivityAt,
});

await database.$client.end();
console.log(`Seeded Ana's session ${anaSessionId}`);
