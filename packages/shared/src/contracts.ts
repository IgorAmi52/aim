import { z } from "zod";

export const personSchema = z.object({
  email: z.email(),
  displayName: z.string().min(1),
});

export const sessionMetadataSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9-]+$/),
  person: personSchema,
  repositoryRemoteUrl: z.string().min(1),
  repositoryRootPath: z.string().min(1),
  branch: z.string().optional(),
  workingDirectory: z.string().min(1),
});

export const appendTranscriptRequestSchema = z
  .object({
    session: sessionMetadataSchema,
    sourceStartOffset: z.number().int().nonnegative(),
    sourceEndOffset: z.number().int().nonnegative(),
    content: z.string(),
  })
  .refine((request) => request.sourceEndOffset >= request.sourceStartOffset, {
    message: "sourceEndOffset must not be before sourceStartOffset",
  })
  .refine((request) => request.content === "" || request.content.endsWith("\n"), {
    message: "content must contain only complete lines",
  });

export const appendTranscriptResponseSchema = z.object({
  acceptedEndOffset: z.number().int(),
});

export const offsetConflictResponseSchema = z.object({
  error: z.literal("offset_conflict"),
  expectedStartOffset: z.number().int(),
});

export const workOutcomeSchema = z.enum(["in_progress", "solved", "abandoned"]);

export const decisionSchema = z.object({
  decision: z.string(),
  reason: z.string(),
});

export const sessionSummarySchema = z.object({
  sessionId: z.string(),
  title: z.string().nullable(),
  intent: z.string().nullable(),
  outcome: workOutcomeSchema.nullable(),
  repository: z.string(),
  branch: z.string().nullable(),
  editedFiles: z.array(z.string()),
  pullRequestUrls: z.array(z.string()),
  lastActivityAt: z.string().nullable(),
  isActive: z.boolean(),
});

export const slackContactSchema = z.object({
  userId: z.string(),
  deepLink: z.string(),
});

export const ownerSchema = z.object({
  email: z.string(),
  displayName: z.string(),
  slack: slackContactSchema.nullable(),
});

export const matchTypeSchema = z.enum(["duplicate", "collision"]);

export const matchRequestSchema = z.object({
  session: sessionMetadataSchema,
  intentText: z.string().min(1),
  editedFiles: z.array(z.string()).default([]),
});

export const matchSchema = z.object({
  matchId: z.string(),
  type: matchTypeSchema,
  confidence: z.number(),
  reason: z.string(),
  session: sessionSummarySchema,
  owner: ownerSchema,
});

export const matchResponseSchema = z.object({
  matches: z.array(matchSchema),
});

export const matchActionSchema = z.enum(["slack", "peer_agent", "details", "ignored"]);

export const matchActionRequestSchema = z.object({
  action: matchActionSchema,
});

export const searchRequestSchema = z.object({
  query: z.string().min(1),
  repositoryRemoteUrl: z.string().optional(),
  limit: z.number().int().positive().max(50).default(10),
});

export const searchResponseSchema = z.object({
  results: z.array(z.object({ session: sessionSummarySchema, owner: ownerSchema })),
});

export const sessionContextResponseSchema = z.object({
  session: sessionSummarySchema,
  approach: z.string().nullable(),
  decisions: z.array(decisionSchema),
  owner: ownerSchema,
  excerpts: z.array(z.string()),
});

export const sessionListResponseSchema = z.object({
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      repository: z.string(),
      branch: z.string().nullable(),
      title: z.string().nullable(),
      lastActivityAt: z.string().nullable(),
      uploadedBytes: z.number().int(),
    }),
  ),
});

export type Person = z.infer<typeof personSchema>;
export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;
export type AppendTranscriptRequest = z.infer<typeof appendTranscriptRequestSchema>;
export type AppendTranscriptResponse = z.infer<typeof appendTranscriptResponseSchema>;
export type OffsetConflictResponse = z.infer<typeof offsetConflictResponseSchema>;
export type WorkOutcome = z.infer<typeof workOutcomeSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SlackContact = z.infer<typeof slackContactSchema>;
export type Owner = z.infer<typeof ownerSchema>;
export type MatchType = z.infer<typeof matchTypeSchema>;
export type MatchRequest = z.infer<typeof matchRequestSchema>;
export type Match = z.infer<typeof matchSchema>;
export type MatchResponse = z.infer<typeof matchResponseSchema>;
export type MatchAction = z.infer<typeof matchActionSchema>;
export type MatchActionRequest = z.infer<typeof matchActionRequestSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type SessionContextResponse = z.infer<typeof sessionContextResponseSchema>;
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
