import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Match, SessionMetadata } from "@aim/shared";

export type SessionState = {
  metadata: SessionMetadata;
  transcriptPath: string;
  intentText: string | undefined;
  editedFiles: string[];
  checkedFiles: string[];
  paused: boolean;
};

export function dataDirectory(): string {
  return process.env.CLAUDE_PLUGIN_DATA ?? path.join(os.homedir(), ".aim");
}

function sessionDirectory(sessionId: string): string {
  return path.join(dataDirectory(), "sessions", sessionId);
}

function readJson<Value>(filePath: string): Value | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Value;
  } catch {
    return undefined;
  }
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  renameSync(temporaryPath, filePath);
}

export function readSessionState(sessionId: string): SessionState | undefined {
  return readJson<SessionState>(path.join(sessionDirectory(sessionId), "session.json"));
}

export function writeSessionState(state: SessionState): void {
  writeJsonAtomically(path.join(sessionDirectory(state.metadata.sessionId), "session.json"), state);
}

export function readUploadOffset(sessionId: string): number {
  return readJson<number>(path.join(sessionDirectory(sessionId), "upload-offset.json")) ?? 0;
}

export function writeUploadOffset(sessionId: string, offset: number): void {
  writeJsonAtomically(path.join(sessionDirectory(sessionId), "upload-offset.json"), offset);
}

function pendingMatchesPath(sessionId: string): string {
  return path.join(sessionDirectory(sessionId), "pending-matches.json");
}

export function addPendingMatches(sessionId: string, matches: Match[]): void {
  const pending = readJson<Match[]>(pendingMatchesPath(sessionId)) ?? [];
  writeJsonAtomically(pendingMatchesPath(sessionId), [...pending, ...matches]);
}

export function takePendingMatches(sessionId: string): Match[] {
  const claimedPath = `${pendingMatchesPath(sessionId)}.${process.pid}.claimed`;
  try {
    renameSync(pendingMatchesPath(sessionId), claimedPath);
  } catch {
    return [];
  }
  const matches = readJson<Match[]>(claimedPath) ?? [];
  rmSync(claimedPath, { force: true });
  return matches;
}

type RepositorySettings = { enabledRootPaths: string[] };

function repositorySettingsPath(): string {
  return path.join(dataDirectory(), "repositories.json");
}

export function isRepositoryEnabled(rootPath: string): boolean {
  const settings = readJson<RepositorySettings>(repositorySettingsPath());
  return settings?.enabledRootPaths.includes(rootPath) ?? false;
}

export function setRepositoryEnabled(rootPath: string, enabled: boolean): void {
  const settings = readJson<RepositorySettings>(repositorySettingsPath()) ?? { enabledRootPaths: [] };
  const others = settings.enabledRootPaths.filter((enabledRootPath) => enabledRootPath !== rootPath);
  writeJsonAtomically(repositorySettingsPath(), { enabledRootPaths: enabled ? [...others, rootPath] : others });
}

export function log(message: string, error?: unknown): void {
  try {
    mkdirSync(dataDirectory(), { recursive: true });
    const detail = error instanceof Error ? ` ${error.stack ?? error.message}` : "";
    appendFileSync(path.join(dataDirectory(), "aim.log"), `${new Date().toISOString()} ${message}${detail}\n`);
  } catch {
    return;
  }
}
