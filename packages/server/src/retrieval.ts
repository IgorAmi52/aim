import { and, arrayOverlaps, cosineDistance, desc, eq, gte, ne, sql } from "drizzle-orm";
import { database } from "./database/client";
import { sessions, workCards } from "./database/schema";

type RetrievalFilters = {
  excludedPersonId?: string;
  repository?: string;
  limit: number;
};

export type SimilarWorkCard = { sessionId: string; similarity: number };
export type FileOverlap = { sessionId: string; overlappingFiles: string[] };

const reciprocalRankConstant = 60;

function filterConditions(filters: RetrievalFilters) {
  return [
    filters.excludedPersonId ? ne(sessions.personId, filters.excludedPersonId) : undefined,
    filters.repository ? eq(sessions.repository, filters.repository) : undefined,
  ];
}

export async function findSimilarWorkCards(queryEmbedding: number[], filters: RetrievalFilters): Promise<SimilarWorkCard[]> {
  const distance = cosineDistance(workCards.embedding, queryEmbedding);
  return database
    .select({ sessionId: workCards.sessionId, similarity: sql<number>`1 - (${distance})` })
    .from(workCards)
    .innerJoin(sessions, eq(sessions.id, workCards.sessionId))
    .where(and(...filterConditions(filters)))
    .orderBy(distance)
    .limit(filters.limit);
}

function toAnyWordQuery(text: string): string | undefined {
  const words = [...new Set(text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])].slice(0, 40);
  if (words.length === 0) {
    return undefined;
  }
  return words.join(" or ");
}

export async function findTextMatchingWorkCards(queryText: string, filters: RetrievalFilters): Promise<string[]> {
  const anyWordQuery = toAnyWordQuery(queryText);
  if (!anyWordQuery) {
    return [];
  }
  const textQuery = sql`websearch_to_tsquery('english', ${anyWordQuery})`;
  const rows = await database
    .select({ sessionId: workCards.sessionId })
    .from(workCards)
    .innerJoin(sessions, eq(sessions.id, workCards.sessionId))
    .where(and(sql`${workCards.searchVector} @@ ${textQuery}`, ...filterConditions(filters)))
    .orderBy(desc(sql`ts_rank(${workCards.searchVector}, ${textQuery})`))
    .limit(filters.limit);
  return rows.map((row) => row.sessionId);
}

export async function findActiveSessionsEditingFiles(
  files: string[],
  activeSince: Date,
  filters: RetrievalFilters,
): Promise<FileOverlap[]> {
  if (files.length === 0) {
    return [];
  }
  const rows = await database
    .select({ sessionId: sessions.id, editedFiles: sessions.editedFiles })
    .from(sessions)
    .where(and(arrayOverlaps(sessions.editedFiles, files), gte(sessions.lastActivityAt, activeSince), ...filterConditions(filters)));

  const requestedFiles = new Set(files);
  return rows
    .map((row) => ({
      sessionId: row.sessionId,
      overlappingFiles: row.editedFiles.filter((file) => requestedFiles.has(file)),
    }))
    .sort((first, second) => second.overlappingFiles.length - first.overlappingFiles.length)
    .slice(0, filters.limit);
}

export function fuseRankings(rankings: Array<{ sessionIds: string[]; weight: number }>): string[] {
  const scores = new Map<string, number>();
  for (const { sessionIds, weight } of rankings) {
    sessionIds.forEach((sessionId, rank) => {
      scores.set(sessionId, (scores.get(sessionId) ?? 0) + weight / (reciprocalRankConstant + rank + 1));
    });
  }
  return [...scores.entries()].sort((first, second) => second[1] - first[1]).map(([sessionId]) => sessionId);
}
