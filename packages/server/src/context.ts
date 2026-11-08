import type { SessionContextResponse } from "@aim/shared";
import { readRawTranscript } from "./rawStore";
import { loadSessionDetails, toOwner, toSessionSummary } from "./sessions";
import { condenseTranscript, groupEntries, parseTranscript } from "./transcript";
import { rerankDocuments } from "./voyage";

const passageCharacters = 6_000;
const maximumRerankedPassages = 200;
const excerptCount = 6;

async function selectExcerpts(passages: string[], focus: string | undefined): Promise<string[]> {
  if (!focus || passages.length <= excerptCount) {
    return passages.slice(-excerptCount);
  }
  const rerankedPassages = passages.slice(-maximumRerankedPassages);
  const topIndexes = await rerankDocuments(focus, rerankedPassages, excerptCount);
  return topIndexes.sort((first, second) => first - second).map((index) => rerankedPassages[index]);
}

export async function getSessionContext(sessionId: string, focus: string | undefined): Promise<SessionContextResponse | null> {
  const [details] = await loadSessionDetails([sessionId]);
  if (!details) {
    return null;
  }
  const { content } = await readRawTranscript(sessionId);
  const passages = groupEntries(condenseTranscript(parseTranscript(content)), passageCharacters);

  return {
    session: toSessionSummary(details),
    approach: details.workCard?.approach ?? null,
    decisions: details.workCard?.decisions ?? [],
    owner: await toOwner(details.person),
    excerpts: await selectExcerpts(passages, focus),
  };
}
