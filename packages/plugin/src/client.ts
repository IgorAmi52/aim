import type {
  AppendTranscriptRequest,
  AppendTranscriptResponse,
  MatchAction,
  MatchRequest,
  MatchResponse,
  OffsetConflictResponse,
  SearchRequest,
  SearchResponse,
  SessionContextResponse,
  SessionListResponse,
} from "@aim/shared";
import { readServerSettings } from "./configuration";

export class AimServerError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(`aim server responded with ${status}: ${JSON.stringify(responseBody)}`);
  }
}

const requestTimeoutMilliseconds = 30_000;

async function sendRequest(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const { serverUrl, token } = readServerSettings();
  const response = await fetch(new URL(path, serverUrl), {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(requestTimeoutMilliseconds),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function requestJson<Response>(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await sendRequest(method, path, body);
  if (response.status >= 400) {
    throw new AimServerError(response.status, response.body);
  }
  return response.body as Response;
}

export async function appendTranscript(
  request: AppendTranscriptRequest,
): Promise<{ status: "accepted"; acceptedEndOffset: number } | { status: "offset_conflict"; expectedStartOffset: number }> {
  const response = await sendRequest("POST", "/transcripts", request);
  if (response.status === 409) {
    return { status: "offset_conflict", expectedStartOffset: (response.body as OffsetConflictResponse).expectedStartOffset };
  }
  if (response.status >= 400) {
    throw new AimServerError(response.status, response.body);
  }
  return { status: "accepted", acceptedEndOffset: (response.body as AppendTranscriptResponse).acceptedEndOffset };
}

export function findMatches(request: MatchRequest): Promise<MatchResponse> {
  return requestJson("POST", "/matches/search", request);
}

export function recordMatchAction(matchId: string, action: MatchAction): Promise<unknown> {
  return requestJson("POST", `/matches/${matchId}/action`, { action });
}

export function searchSessions(request: SearchRequest): Promise<SearchResponse> {
  return requestJson("POST", "/search", request);
}

export function getSessionContext(sessionId: string, focus: string | undefined): Promise<SessionContextResponse> {
  const query = focus ? `?focus=${encodeURIComponent(focus)}` : "";
  return requestJson("GET", `/sessions/${encodeURIComponent(sessionId)}/context${query}`);
}

export function listSessions(personEmail: string): Promise<SessionListResponse> {
  return requestJson("GET", `/sessions?personEmail=${encodeURIComponent(personEmail)}`);
}
