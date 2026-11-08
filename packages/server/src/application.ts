import {
  appendTranscriptRequestSchema,
  matchActionRequestSchema,
  matchRequestSchema,
  searchRequestSchema,
  type AppendTranscriptResponse,
  type MatchResponse,
  type OffsetConflictResponse,
} from "@aim/shared";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { configuration } from "./configuration";
import { getSessionContext, getSessionTranscriptPage } from "./context";
import { findMatches, recordMatchAction } from "./matching";
import { searchWorkCards } from "./search";
import { appendTranscriptChunk, listSessionsForPerson } from "./sessions";

export const application = new Hono();

application.get("/health", (context) => context.json({ status: "ok" }));

application.use("*", bearerAuth({ token: configuration.AIM_TOKEN! }));

application.post("/transcripts", async (context) => {
  const request = appendTranscriptRequestSchema.parse(await context.req.json());
  const result = await appendTranscriptChunk(request);
  if (result.status === "offset_conflict") {
    return context.json<OffsetConflictResponse>({ error: "offset_conflict", expectedStartOffset: result.expectedStartOffset }, 409);
  }
  return context.json<AppendTranscriptResponse>({ acceptedEndOffset: result.acceptedEndOffset });
});

application.post("/matches/search", async (context) => {
  const request = matchRequestSchema.parse(await context.req.json());
  return context.json<MatchResponse>({ matches: await findMatches(request) });
});

application.post("/matches/:matchId/action", async (context) => {
  const matchId = z.uuid().parse(context.req.param("matchId"));
  const { action } = matchActionRequestSchema.parse(await context.req.json());
  if (!(await recordMatchAction(matchId, action))) {
    return context.json({ error: "match_not_found" }, 404);
  }
  return context.json({ status: "recorded" });
});

application.post("/search", async (context) => {
  const request = searchRequestSchema.parse(await context.req.json());
  return context.json(await searchWorkCards(request));
});

application.get("/sessions", async (context) => {
  const personEmail = z.email().parse(context.req.query("personEmail"));
  return context.json(await listSessionsForPerson(personEmail));
});

application.get("/sessions/:sessionId/context", async (context) => {
  const sessionContext = await getSessionContext(context.req.param("sessionId"), context.req.query("focus"));
  if (!sessionContext) {
    return context.json({ error: "session_not_found" }, 404);
  }
  return context.json(sessionContext);
});

application.get("/sessions/:sessionId/transcript", async (context) => {
  const page = z.coerce.number().int().positive().default(1).parse(context.req.query("page"));
  const transcriptPage = await getSessionTranscriptPage(context.req.param("sessionId"), page);
  if (!transcriptPage) {
    return context.json({ error: "session_not_found" }, 404);
  }
  return context.json(transcriptPage);
});

application.onError((error, context) => {
  if (error instanceof z.ZodError) {
    return context.json({ error: "invalid_request", issues: error.issues }, 400);
  }
  if (error instanceof SyntaxError) {
    return context.json({ error: "invalid_json" }, 400);
  }
  if (error instanceof HTTPException) {
    return error.getResponse();
  }
  console.error(error);
  return context.json({ error: "internal_error" }, 500);
});
