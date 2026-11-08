import type { SlackContact } from "@aim/shared";
import { embeddingDimensions } from "./database/schema";
import { isSessionActive, type SessionDetails } from "./sessions";

type DemoCandidate = SessionDetails & { overlappingFiles: string[] };

const stopWords = new Set(
  "the and for with that this from are was were but not you your our its has have had can could should would will into when then than them they there their what which who why how all any one per out about after before also just make made".split(
    " ",
  ),
);
const demoSimilarityThreshold = 0.15;

function stem(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 2 && !stopWords.has(word)).map(stem);
}

function hash(token: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < token.length; index++) {
    value ^= token.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

export function demoEmbedding(text: string): number[] {
  const vector = new Array<number>(embeddingDimensions).fill(0);
  for (const token of tokens(text)) {
    const tokenHash = hash(token);
    vector[tokenHash % embeddingDimensions] += (tokenHash >>> 16) & 1 ? 1 : -1;
  }
  const length = Math.hypot(...vector);
  if (length === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / length);
}

function similarity(first: string, second: string): number {
  const firstVector = demoEmbedding(first);
  const secondVector = demoEmbedding(second);
  return firstVector.reduce((total, value, index) => total + value * secondVector[index], 0);
}

export function demoRerank(query: string, documents: string[], topCount: number): number[] {
  return documents
    .map((document, index) => ({ index, score: similarity(query, document) }))
    .sort((first, second) => second.score - first.score)
    .slice(0, topCount)
    .map((ranked) => ranked.index);
}

function daysAgo(date: Date | null): string {
  if (!date) {
    return "recently";
  }
  const days = Math.round((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "yesterday";
  }
  return `${days} days ago`;
}

function pullRequestLabel(pullRequestUrls: string[]): string {
  const number = pullRequestUrls[0]?.match(/\/pull\/(\d+)/)?.[1];
  return number ? ` (PR #${number})` : "";
}

export function demoJudgments(intentText: string, candidates: DemoCandidate[]) {
  return candidates.map((candidate, index) => {
    const { session, person, workCard, overlappingFiles } = candidate;
    const firstName = person.displayName.split(" ")[0];
    const title = workCard?.title ?? "work in progress";
    if (overlappingFiles.length > 0 && isSessionActive(session)) {
      return {
        candidateNumber: index + 1,
        type: "collision" as const,
        confidence: 0.9,
        reason: `${firstName} is editing ${overlappingFiles.join(", ")} right now (${title}).`,
      };
    }
    const score = workCard ? similarity(intentText, `${workCard.title} ${workCard.intent} ${workCard.approach}`) : 0;
    if (score < demoSimilarityThreshold) {
      return { candidateNumber: index + 1, type: "unrelated" as const, confidence: 0, reason: "" };
    }
    const verb = workCard?.outcome === "solved" ? "already solved" : "worked on";
    return {
      candidateNumber: index + 1,
      type: "duplicate" as const,
      confidence: Math.min(0.95, 0.75 + score),
      reason: `${firstName} ${verb} this ${daysAgo(session.lastActivityAt)}${pullRequestLabel(session.pullRequestUrls)}: ${title}.`,
    };
  });
}

export function demoWorkCard(excerpt: string) {
  const firstRequest = excerpt
    .split("\n")
    .find((entry) => entry.startsWith("User: "))
    ?.slice("User: ".length) ?? "Work in progress";
  return {
    title: firstRequest.split(/\s+/).slice(0, 8).join(" "),
    intent: firstRequest,
    approach: "Not summarized in demo mode.",
    decisions: [],
    outcome: "in_progress" as const,
    symbols: [],
  };
}

export function demoSlackContact(): SlackContact {
  return { userId: "U0DEMO", deepLink: "slack://open" };
}
