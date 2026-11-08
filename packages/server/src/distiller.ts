import { decisionSchema, workOutcomeSchema } from "@aim/shared";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { anthropic } from "./anthropic";
import { configuration } from "./configuration";
import { database } from "./database/client";
import { demoWorkCard } from "./demo";
import { sessions, workCards, type SessionRow, type WorkCardRow } from "./database/schema";
import { readRawTranscript } from "./rawStore";
import { condenseTranscript, groupEntries, parseTranscript } from "./transcript";
import { embedText } from "./voyage";

const workCardSchema = z.object({
  title: z.string().describe("Five to ten words naming the problem being worked on."),
  intent: z.string().describe("The problem or goal, stated so another developer facing the same problem would recognize it."),
  approach: z.string().describe("How the problem is being solved: the technique, components and steps, in a few sentences."),
  decisions: z.array(decisionSchema).describe("Choices made and why, including approaches that were rejected."),
  outcome: workOutcomeSchema,
  symbols: z.array(z.string()).describe("Up to 20 central identifiers: functions, classes, modules, endpoints, tables, configuration keys."),
});

export type WorkCard = z.infer<typeof workCardSchema>;

const maximumExcerptCharacters = 300_000;

const distillInstructions = `You maintain a work card for one developer's Claude Code session. Other developers' sessions are matched against this card to warn them before they duplicate this work or collide with it, so the card must describe the work in the terms another developer would use when starting on the same problem.

You receive the previous card (or none) and a new excerpt of the session transcript. Tool output is omitted; tool calls are shown as one line each. Return the updated card:
- Describe the problem in the intent, not the activity: "Payment webhook retries charge customers twice", not "Looking at the webhook code".
- Keep decisions that still hold, drop ones that were reversed, and add new ones. Rejected approaches count as decisions.
- Outcome: "solved" when the goal was reached (the change works, tests pass, a pull request was opened, or the developer confirmed it); "abandoned" when the developer gave up on it or moved on; otherwise "in_progress".
- If the session moves to a different problem, describe the problem the session spent the most effort on.
- Never include secrets, credentials or personal data.`;

async function updateWorkCard(previousCard: WorkCard | null, excerpt: string, session: SessionRow): Promise<WorkCard> {
  if (configuration.AIM_DEMO_MODE) {
    return previousCard ?? demoWorkCard(excerpt);
  }
  const previousCardText = previousCard ? JSON.stringify(previousCard, null, 2) : "none";
  const response = await anthropic.messages.parse({
    model: configuration.AIM_DISTILL_MODEL,
    max_tokens: 4_000,
    system: distillInstructions,
    messages: [
      {
        role: "user",
        content: `<previous_card>\n${previousCardText}\n</previous_card>\n\n<repository>${session.repository}</repository>\n<branch>${session.branch ?? "unknown"}</branch>\n\n<transcript_excerpt>\n${excerpt}\n</transcript_excerpt>`,
      },
    ],
    output_config: { format: zodOutputFormat(workCardSchema) },
  });
  if (!response.parsed_output) {
    throw new Error(`Work card distillation returned no card (stop reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}

function toWorkCard(row: WorkCardRow): WorkCard {
  return {
    title: row.title,
    intent: row.intent,
    approach: row.approach,
    decisions: row.decisions,
    outcome: row.outcome,
    symbols: row.symbols,
  };
}

export function cardDocument(card: WorkCard): string {
  const decisions = card.decisions.map(({ decision, reason }) => `- ${decision} (${reason})`).join("\n");
  return `${card.title}\n\n${card.intent}\n\n${card.approach}\n\nDecisions:\n${decisions}\n\nSymbols: ${card.symbols.join(", ")}`;
}

export async function distillSession(sessionId: string): Promise<void> {
  const startedAt = new Date();
  const [session] = await database.select().from(sessions).where(eq(sessions.id, sessionId));
  const [existingCard] = await database.select().from(workCards).where(eq(workCards.sessionId, sessionId));
  const { content, endOffset } = await readRawTranscript(sessionId, session.distilledByteOffset);
  const excerpts = groupEntries(condenseTranscript(parseTranscript(content)), maximumExcerptCharacters);

  let card: WorkCard | null = existingCard ? toWorkCard(existingCard) : null;
  for (const excerpt of excerpts) {
    card = await updateWorkCard(card, excerpt, session);
  }

  if (card && excerpts.length > 0) {
    const document = cardDocument(card);
    const values = {
      title: card.title,
      intent: card.intent,
      approach: card.approach,
      decisions: card.decisions,
      outcome: card.outcome,
      symbols: card.symbols,
      searchDocument: `${document}\n\nFiles: ${session.editedFiles.join(" ")}`,
      embedding: await embedText(document, "document"),
      updatedAt: startedAt,
    };
    await database
      .insert(workCards)
      .values({ sessionId, ...values })
      .onConflictDoUpdate({ target: workCards.sessionId, set: values });
  }

  await database.update(sessions).set({ distilledByteOffset: endOffset, distilledAt: startedAt }).where(eq(sessions.id, sessionId));
}

export async function findSessionsAwaitingDistillation(limit: number): Promise<string[]> {
  const quietCutoff = new Date(Date.now() - configuration.AIM_DISTILL_DEBOUNCE_SECONDS * 1_000);
  const maximumWaitCutoff = new Date(Date.now() - configuration.AIM_DISTILL_MAXIMUM_WAIT_SECONDS * 1_000);
  const rows = await database
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        isNotNull(sessions.distillRequestedAt),
        or(isNull(sessions.distilledAt), lt(sessions.distilledAt, sessions.distillRequestedAt)),
        or(
          lt(sessions.distillRequestedAt, quietCutoff),
          lt(sql`coalesce(${sessions.distilledAt}, ${sessions.createdAt})`, maximumWaitCutoff),
        ),
      ),
    )
    .orderBy(asc(sessions.distillRequestedAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

export async function postponeDistillation(sessionId: string): Promise<void> {
  await database.update(sessions).set({ distillRequestedAt: new Date() }).where(eq(sessions.id, sessionId));
}
