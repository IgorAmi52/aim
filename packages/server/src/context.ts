import type { SessionContextResponse, SessionTranscriptPageResponse } from "@aim/shared";
import { readRawTranscript } from "./rawStore";
import { loadSessionDetails, toOwner, toSessionSummary } from "./sessions";
import { condenseTranscript, groupEntries, parseTranscript } from "./transcript";
import { rerankDocuments } from "./voyage";

const passageCharacters = 6_000;
const transcriptPageCharacters = 60_000;
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

async function condensedTranscript(sessionId: string): Promise<string[]> {
  const { content } = await readRawTranscript(sessionId);
  return condenseTranscript(parseTranscript(content));
}

export async function getSessionTranscriptPage(sessionId: string, page: number): Promise<SessionTranscriptPageResponse | null> {
  const [details] = await loadSessionDetails([sessionId]);
  if (!details) {
    return null;
  }
  const pages = groupEntries(await condensedTranscript(sessionId), transcriptPageCharacters);
  return {
    sessionId,
    page,
    pageCount: pages.length,
    text: pages[page - 1] ?? "",
  };
}

export async function getSessionContext(sessionId: string, focus: string | undefined): Promise<SessionContextResponse | null> {
  const [details] = await loadSessionDetails([sessionId]);
  if (!details) {
    return null;
  }
  const passages = groupEntries(await condensedTranscript(sessionId), passageCharacters);

  return {
    session: toSessionSummary(details),
    approach: details.workCard?.approach ?? null,
    decisions: details.workCard?.decisions ?? [],
    owner: await toOwner(details.person),
    excerpts: await selectExcerpts(passages, focus),
  };
}
