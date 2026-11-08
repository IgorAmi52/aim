import path from "node:path";
import {
  redactTranscript,
  type AppendTranscriptRequest,
  type Owner,
  type SessionListResponse,
  type SessionMetadata,
  type SessionSummary,
} from "@aim/shared";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { activeSessionCutoff } from "./configuration";
import { database } from "./database/client";
import { people, sessions, workCards, type PersonRow, type SessionRow, type WorkCardRow } from "./database/schema";
import { appendRawTranscript, rawTranscriptSize } from "./rawStore";
import { resolveSlackContact } from "./slack";
import { extractTranscriptFacts, parseTranscript } from "./transcript";

export type SessionDetails = {
  session: SessionRow;
  person: PersonRow;
  workCard: WorkCardRow | null;
};

export type AppendTranscriptResult =
  | { status: "accepted"; acceptedEndOffset: number }
  | { status: "offset_conflict"; expectedStartOffset: number };

export function normalizeRepositoryRemoteUrl(remoteUrl: string): string {
  return remoteUrl
    .trim()
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/^([^/:]+):(\d+\/)?/, "$1/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function toRepositoryRelativePath(filePath: string, repositoryRootPath: string): string | undefined {
  if (!path.isAbsolute(filePath)) {
    return filePath;
  }
  const relativePath = path.relative(repositoryRootPath, filePath);
  if (relativePath.startsWith("..")) {
    return undefined;
  }
  return relativePath;
}

function union(existing: string[], additions: string[]): string[] {
  return [...new Set([...existing, ...additions])];
}

export async function ensureSession(metadata: SessionMetadata): Promise<SessionDetails> {
  const [person] = await database
    .insert(people)
    .values({ email: metadata.person.email.toLowerCase(), displayName: metadata.person.displayName })
    .onConflictDoUpdate({ target: people.email, set: { displayName: metadata.person.displayName } })
    .returning();

  const [session] = await database
    .insert(sessions)
    .values({
      id: metadata.sessionId,
      personId: person.id,
      repository: normalizeRepositoryRemoteUrl(metadata.repositoryRemoteUrl),
      repositoryRootPath: metadata.repositoryRootPath,
      branch: metadata.branch,
      workingDirectory: metadata.workingDirectory,
    })
    .onConflictDoUpdate({
      target: sessions.id,
      set: { branch: sql`coalesce(excluded.branch, ${sessions.branch})` },
    })
    .returning();

  const [workCard] = await database.select().from(workCards).where(eq(workCards.sessionId, session.id));
  return { session, person, workCard: workCard ?? null };
}

export async function appendTranscriptChunk(request: AppendTranscriptRequest): Promise<AppendTranscriptResult> {
  await ensureSession(request.session);

  return database.transaction(async (transaction) => {
    const [session] = await transaction.select().from(sessions).where(eq(sessions.id, request.session.sessionId)).for("update");

    if (request.sourceEndOffset <= session.sourceByteOffset) {
      return { status: "accepted", acceptedEndOffset: session.sourceByteOffset };
    }
    if (request.sourceStartOffset !== session.sourceByteOffset) {
      return { status: "offset_conflict", expectedStartOffset: session.sourceByteOffset };
    }

    const redactedContent = redactTranscript(request.content);
    const facts = extractTranscriptFacts(parseTranscript(redactedContent));
    const editedFiles = facts.editedFilePaths.flatMap((filePath) => toRepositoryRelativePath(filePath, session.repositoryRootPath) ?? []);

    await appendRawTranscript(session.id, redactedContent);

    let lastActivityAt = session.lastActivityAt;
    if (facts.lastActivityAt && (!lastActivityAt || facts.lastActivityAt > lastActivityAt)) {
      lastActivityAt = facts.lastActivityAt;
    }

    await transaction
      .update(sessions)
      .set({
        sourceByteOffset: request.sourceEndOffset,
        editedFiles: union(session.editedFiles, editedFiles),
        pullRequestUrls: union(session.pullRequestUrls, facts.pullRequestUrls),
        branch: facts.branch ?? session.branch,
        startedAt: session.startedAt ?? facts.firstActivityAt,
        lastActivityAt,
        distillRequestedAt: new Date(),
      })
      .where(eq(sessions.id, session.id));

    return { status: "accepted", acceptedEndOffset: request.sourceEndOffset };
  });
}

export async function recordSessionActivity(session: SessionRow, editedFiles: string[]): Promise<void> {
  await database
    .update(sessions)
    .set({ lastActivityAt: new Date(), editedFiles: union(session.editedFiles, editedFiles) })
    .where(eq(sessions.id, session.id));
}

export async function loadSessionDetails(sessionIds: string[]): Promise<SessionDetails[]> {
  if (sessionIds.length === 0) {
    return [];
  }
  const rows = await database
    .select()
    .from(sessions)
    .innerJoin(people, eq(people.id, sessions.personId))
    .leftJoin(workCards, eq(workCards.sessionId, sessions.id))
    .where(inArray(sessions.id, sessionIds));

  const detailsBySessionId = new Map(
    rows.map((row) => [row.sessions.id, { session: row.sessions, person: row.people, workCard: row.work_cards }]),
  );
  return sessionIds.flatMap((sessionId) => detailsBySessionId.get(sessionId) ?? []);
}

export function isSessionActive(session: SessionRow): boolean {
  return session.lastActivityAt !== null && session.lastActivityAt >= activeSessionCutoff();
}

export function toSessionSummary({ session, workCard }: SessionDetails): SessionSummary {
  return {
    sessionId: session.id,
    title: workCard?.title ?? null,
    intent: workCard?.intent ?? null,
    outcome: workCard?.outcome ?? null,
    repository: session.repository,
    branch: session.branch,
    editedFiles: session.editedFiles,
    pullRequestUrls: session.pullRequestUrls,
    lastActivityAt: session.lastActivityAt?.toISOString() ?? null,
    isActive: isSessionActive(session),
  };
}

export async function toOwner(person: PersonRow): Promise<Owner> {
  let slack: Owner["slack"] = null;
  try {
    slack = await resolveSlackContact(person);
  } catch (error) {
    console.error(`Slack lookup failed for ${person.email}`, error);
  }
  return { email: person.email, displayName: person.displayName, slack };
}

export async function listSessionsForPerson(email: string): Promise<SessionListResponse> {
  const rows = await database
    .select({ session: sessions, title: workCards.title })
    .from(sessions)
    .innerJoin(people, eq(people.id, sessions.personId))
    .leftJoin(workCards, eq(workCards.sessionId, sessions.id))
    .where(eq(people.email, email.toLowerCase()))
    .orderBy(desc(sessions.lastActivityAt))
    .limit(50);

  return {
    sessions: await Promise.all(
      rows.map(async ({ session, title }) => ({
        sessionId: session.id,
        repository: session.repository,
        branch: session.branch,
        title,
        lastActivityAt: session.lastActivityAt?.toISOString() ?? null,
        uploadedBytes: await rawTranscriptSize(session.id),
      })),
    ),
  };
}
