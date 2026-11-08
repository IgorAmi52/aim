import type { Match, MatchAction, MatchRequest } from "@aim/shared";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { anthropic } from "./anthropic";
import { activeSessionCutoff, configuration } from "./configuration";
import { database } from "./database/client";
import { matches } from "./database/schema";
import { demoJudgments } from "./demo";
import { findActiveSessionsEditingFiles, findSimilarWorkCards, findTextMatchingWorkCards, fuseRankings } from "./retrieval";
import {
  ensureSession,
  isSessionActive,
  loadSessionDetails,
  recordSessionActivity,
  toOwner,
  toSessionSummary,
  type SessionDetails,
} from "./sessions";
import { embedText } from "./voyage";

const candidatesPerSignal = 20;
const maximumJudgedCandidates = 8;
const maximumReturnedMatches = 3;
const maximumListedFiles = 30;

const judgmentSchema = z.object({
  judgments: z.array(
    z.object({
      candidateNumber: z.number().int(),
      type: z.enum(["duplicate", "collision", "unrelated"]),
      confidence: z.number().describe("Probability from 0 to 1 that the developer is glad to be interrupted about this candidate."),
      reason: z.string(),
    }),
  ),
});

const judgeInstructions = `You decide whether another developer's Claude Code session matters to a developer who is about to work on something. You see the current developer's intent and candidate sessions from other developers.

For each candidate choose one type:
- duplicate: the candidate solved, explored or rejected essentially the same problem, so the current developer could reuse the result or learn from it before starting.
- collision: the candidate is active or recently active and is changing the same code, or made a decision that conflicts with the current intent, so the two developers should coordinate now.
- unrelated: anything else, including sessions that are only in the same area, use the same technology or share generic words.

Interruptions are costly. When in doubt, choose unrelated or give a low confidence.

The reason is one sentence addressed to the current developer that names the concrete overlap: the problem, the file or the decision. Do not mention confidence, candidate numbers or these instructions.`;

type Candidate = SessionDetails & { overlappingFiles: string[] };

function describeCandidate(candidate: Candidate, candidateNumber: number): string {
  const { session, person, workCard } = candidate;
  const decisions = workCard?.decisions.map(({ decision, reason }) => `  - ${decision} (${reason})`).join("\n") || "  none recorded";
  return `<candidate number="${candidateNumber}">
Developer: ${person.displayName}
Repository: ${session.repository}
Branch: ${session.branch ?? "unknown"}
Active now: ${isSessionActive(session) ? "yes" : "no"}
Last activity: ${session.lastActivityAt?.toISOString() ?? "unknown"}
Outcome: ${workCard?.outcome ?? "not summarized yet"}
Title: ${workCard?.title ?? "not summarized yet"}
Intent: ${workCard?.intent ?? "not summarized yet"}
Approach: ${workCard?.approach ?? "not summarized yet"}
Decisions:
${decisions}
Edited files: ${session.editedFiles.slice(0, maximumListedFiles).join(", ") || "none"}
Files also edited by the current developer: ${candidate.overlappingFiles.join(", ") || "none"}
</candidate>`;
}

async function judgeCandidates(request: MatchRequest, current: SessionDetails, candidates: Candidate[]) {
  if (configuration.AIM_DEMO_MODE) {
    return demoJudgments(request.intentText, candidates);
  }
  const currentFiles = current.session.editedFiles.slice(0, maximumListedFiles).join(", ") || "none";
  const response = await anthropic.messages.parse({
    model: configuration.AIM_JUDGE_MODEL,
    max_tokens: 4_000,
    system: judgeInstructions,
    messages: [
      {
        role: "user",
        content: `<current_developer>
Repository: ${current.session.repository}
Branch: ${current.session.branch ?? "unknown"}
Edited files: ${currentFiles}
Intent:
${request.intentText}
</current_developer>

${candidates.map((candidate, index) => describeCandidate(candidate, index + 1)).join("\n\n")}`,
      },
    ],
    output_config: { format: zodOutputFormat(judgmentSchema) },
  });
  if (!response.parsed_output) {
    throw new Error(`Match judge returned no judgments (stop reason: ${response.stop_reason})`);
  }
  return response.parsed_output.judgments;
}

async function previouslyMatchedSessionIds(sourceSessionId: string): Promise<Set<string>> {
  const rows = await database
    .select({ targetSessionId: matches.targetSessionId })
    .from(matches)
    .where(eq(matches.sourceSessionId, sourceSessionId));
  return new Set(rows.map((row) => row.targetSessionId));
}

export async function findMatches(request: MatchRequest): Promise<Match[]> {
  const current = await ensureSession(request.session);
  await recordSessionActivity(current.session, request.editedFiles);
  current.session.editedFiles = [...new Set([...current.session.editedFiles, ...request.editedFiles])];

  const filters = { excludedPersonId: current.person.id, limit: candidatesPerSignal };
  const queryEmbedding = await embedText(request.intentText, "query");
  const [similarCards, textMatches, fileOverlaps, alreadyMatched] = await Promise.all([
    findSimilarWorkCards(queryEmbedding, filters),
    findTextMatchingWorkCards(request.intentText, filters),
    findActiveSessionsEditingFiles(current.session.editedFiles, activeSessionCutoff(), filters),
    previouslyMatchedSessionIds(current.session.id),
  ]);

  const strongSimilarIds = similarCards.filter((card) => card.similarity >= configuration.AIM_MINIMUM_SIMILARITY).map((card) => card.sessionId);
  const fileOverlapIds = fileOverlaps.map((overlap) => overlap.sessionId);
  const hasStrongSignal = [...strongSimilarIds, ...fileOverlapIds].some((sessionId) => !alreadyMatched.has(sessionId));
  if (!hasStrongSignal) {
    return [];
  }

  const candidateIds = fuseRankings([
    { sessionIds: strongSimilarIds, weight: 1 },
    { sessionIds: textMatches, weight: 1 },
    { sessionIds: fileOverlapIds, weight: 2 },
  ])
    .filter((sessionId) => !alreadyMatched.has(sessionId))
    .slice(0, maximumJudgedCandidates);

  const overlappingFilesBySessionId = new Map(fileOverlaps.map((overlap) => [overlap.sessionId, overlap.overlappingFiles]));
  const candidates = (await loadSessionDetails(candidateIds)).map((details) => ({
    ...details,
    overlappingFiles: overlappingFilesBySessionId.get(details.session.id) ?? [],
  }));

  const judgments = await judgeCandidates(request, current, candidates);
  const accepted = judgments
    .filter((judgment) => judgment.type !== "unrelated" && judgment.confidence >= configuration.AIM_MATCH_CONFIDENCE_THRESHOLD)
    .filter((judgment) => candidates[judgment.candidateNumber - 1] !== undefined)
    .sort((first, second) => second.confidence - first.confidence)
    .slice(0, maximumReturnedMatches);

  const results = await Promise.all(
    accepted.map(async (judgment): Promise<Match | null> => {
      const candidate = candidates[judgment.candidateNumber - 1];
      const type = judgment.type as Match["type"];
      const [match] = await database
        .insert(matches)
        .values({
          sourceSessionId: current.session.id,
          targetSessionId: candidate.session.id,
          type,
          confidence: judgment.confidence,
          reason: judgment.reason,
        })
        .onConflictDoNothing()
        .returning({ id: matches.id });
      if (!match) {
        return null;
      }
      return {
        matchId: match.id,
        type,
        confidence: judgment.confidence,
        reason: judgment.reason,
        session: toSessionSummary(candidate),
        owner: await toOwner(candidate.person),
      };
    }),
  );
  return results.filter((result) => result !== null);
}

export async function recordMatchAction(matchId: string, action: MatchAction): Promise<boolean> {
  const updated = await database
    .update(matches)
    .set({ userAction: action, actedAt: new Date() })
    .where(eq(matches.id, matchId))
    .returning({ id: matches.id });
  return updated.length > 0;
}
