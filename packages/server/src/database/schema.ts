import type { Decision } from "@aim/shared";
import { sql } from "drizzle-orm";
import { bigint, customType, index, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";

export const embeddingDimensions = 1024;

const textSearchVector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  slackUserId: text("slack_user_id"),
  slackCheckedAt: timestamp("slack_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    repository: text("repository").notNull(),
    repositoryRootPath: text("repository_root_path").notNull(),
    branch: text("branch"),
    workingDirectory: text("working_directory").notNull(),
    editedFiles: text("edited_files").array().notNull().default(sql`'{}'::text[]`),
    pullRequestUrls: text("pull_request_urls").array().notNull().default(sql`'{}'::text[]`),
    sourceByteOffset: bigint("source_byte_offset", { mode: "number" }).notNull().default(0),
    distilledByteOffset: bigint("distilled_byte_offset", { mode: "number" }).notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    distillRequestedAt: timestamp("distill_requested_at", { withTimezone: true }),
    distilledAt: timestamp("distilled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sessions_person_index").on(table.personId),
    index("sessions_edited_files_index").using("gin", table.editedFiles),
    index("sessions_distill_requested_index").on(table.distillRequestedAt),
  ],
);

export const workCards = pgTable(
  "work_cards",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => sessions.id),
    title: text("title").notNull(),
    intent: text("intent").notNull(),
    approach: text("approach").notNull(),
    decisions: jsonb("decisions").$type<Decision[]>().notNull(),
    outcome: text("outcome", { enum: ["in_progress", "solved", "abandoned"] }).notNull(),
    symbols: text("symbols").array().notNull(),
    searchDocument: text("search_document").notNull(),
    searchVector: textSearchVector("search_vector").generatedAlwaysAs(sql`to_tsvector('english', search_document)`),
    embedding: vector("embedding", { dimensions: embeddingDimensions }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("work_cards_embedding_index").using("hnsw", table.embedding.op("vector_cosine_ops")),
    index("work_cards_search_vector_index").using("gin", table.searchVector),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSessionId: text("source_session_id")
      .notNull()
      .references(() => sessions.id),
    targetSessionId: text("target_session_id")
      .notNull()
      .references(() => sessions.id),
    type: text("type", { enum: ["duplicate", "collision"] }).notNull(),
    confidence: real("confidence").notNull(),
    reason: text("reason").notNull(),
    userAction: text("user_action", { enum: ["slack", "peer_agent", "details", "ignored"] }),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("matches_source_target_index").on(table.sourceSessionId, table.targetSessionId)],
);

export type PersonRow = typeof people.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type WorkCardRow = typeof workCards.$inferSelect;
