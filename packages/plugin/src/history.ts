import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitIdentity, repositoryInformation } from "./git";
import { log, readSessionState, writeSessionState } from "./state";
import { uploadSession } from "./uploader";

export type HistoricalSession = {
  sessionId: string;
  transcriptPath: string;
  workingDirectory: string;
  title: string | undefined;
  lastModifiedAt: Date;
  sizeBytes: number;
};

const headerBytes = 256 * 1024;

function claudeProjectsDirectory(): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "projects");
}

function readHeader(transcriptPath: string): string {
  const descriptor = openSync(transcriptPath, "r");
  try {
    const buffer = Buffer.alloc(headerBytes);
    const bytesRead = readSync(descriptor, buffer, 0, headerBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

function describeTranscript(transcriptPath: string): Pick<HistoricalSession, "workingDirectory" | "title"> | undefined {
  let workingDirectory: string | undefined;
  let title: string | undefined;
  for (const line of readHeader(transcriptPath).split("\n")) {
    try {
      const record = JSON.parse(line) as { cwd?: string; type?: string; aiTitle?: string };
      workingDirectory ??= record.cwd;
      if (record.type === "ai-title" && record.aiTitle) {
        title = record.aiTitle;
      }
    } catch {
      continue;
    }
  }
  return workingDirectory ? { workingDirectory, title } : undefined;
}

function isInside(childPath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

export function findHistoricalSessions(repositoryRootPath: string, days: number): HistoricalSession[] {
  const cutoff = Date.now() - days * 24 * 60 * 60_000;
  const sessions: HistoricalSession[] = [];
  let projectDirectories: string[] = [];
  try {
    projectDirectories = readdirSync(claudeProjectsDirectory());
  } catch {
    return [];
  }
  for (const projectDirectory of projectDirectories) {
    const projectPath = path.join(claudeProjectsDirectory(), projectDirectory);
    let fileNames: string[] = [];
    try {
      fileNames = readdirSync(projectPath).filter((fileName) => fileName.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const fileName of fileNames) {
      const transcriptPath = path.join(projectPath, fileName);
      const fileStatus = statSync(transcriptPath);
      if (fileStatus.mtimeMs < cutoff) {
        continue;
      }
      const description = describeTranscript(transcriptPath);
      if (!description || !isInside(description.workingDirectory, repositoryRootPath)) {
        continue;
      }
      sessions.push({
        sessionId: path.basename(fileName, ".jsonl"),
        transcriptPath,
        ...description,
        lastModifiedAt: fileStatus.mtime,
        sizeBytes: fileStatus.size,
      });
    }
  }
  return sessions.sort((first, second) => second.lastModifiedAt.getTime() - first.lastModifiedAt.getTime());
}

export async function importHistory(workingDirectory: string, days: number): Promise<number> {
  const repository = repositoryInformation(workingDirectory);
  const identity = gitIdentity(workingDirectory);
  if (!repository || !identity) {
    return 0;
  }
  let imported = 0;
  for (const historicalSession of findHistoricalSessions(repository.rootPath, days)) {
    if (!readSessionState(historicalSession.sessionId)) {
      writeSessionState({
        metadata: {
          sessionId: historicalSession.sessionId,
          person: identity,
          repositoryRemoteUrl: repository.remoteUrl,
          repositoryRootPath: repository.rootPath,
          workingDirectory: historicalSession.workingDirectory,
        },
        transcriptPath: historicalSession.transcriptPath,
        intentText: undefined,
        editedFiles: [],
        checkedFiles: [],
        paused: false,
      });
    }
    try {
      await uploadSession(historicalSession.sessionId);
      imported++;
    } catch (error) {
      log(`Importing session ${historicalSession.sessionId} failed`, error);
    }
  }
  return imported;
}
