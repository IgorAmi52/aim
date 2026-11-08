import type { SearchRequest, SearchResponse } from "@aim/shared";
import { findSimilarWorkCards, findTextMatchingWorkCards, fuseRankings } from "./retrieval";
import { loadSessionDetails, normalizeRepositoryRemoteUrl, toOwner, toSessionSummary } from "./sessions";
import { embedText } from "./voyage";

export async function searchWorkCards(request: SearchRequest): Promise<SearchResponse> {
  const filters = {
    repository: request.repositoryRemoteUrl ? normalizeRepositoryRemoteUrl(request.repositoryRemoteUrl) : undefined,
    limit: request.limit * 2,
  };
  const queryEmbedding = await embedText(request.query, "query");
  const [similarCards, textMatches] = await Promise.all([
    findSimilarWorkCards(queryEmbedding, filters),
    findTextMatchingWorkCards(request.query, filters),
  ]);
  const sessionIds = fuseRankings([
    { sessionIds: similarCards.map((card) => card.sessionId), weight: 1 },
    { sessionIds: textMatches, weight: 1 },
  ]).slice(0, request.limit);

  const details = await loadSessionDetails(sessionIds);
  return {
    results: await Promise.all(
      details.map(async (detail) => ({ session: toSessionSummary(detail), owner: await toOwner(detail.person) })),
    ),
  };
}
