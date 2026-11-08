import path from "node:path";
import { runInBackground } from "./background";
import { gitIdentity, repositoryInformation } from "./git";
import { formatMatchesForClaude } from "./presentation";
import { isRepositoryEnabled, readSessionState, takePendingMatches, writeSessionState, type SessionState } from "./state";

export type HookInput = {
  hook_event_name: string;
  session_id: string;
  transcript_path: string;
  cwd: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

export type HookOutput = {
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
};

const minimumIntentCharacters = 20;
const maximumIntentCharacters = 4_000;
const fileEditingTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function loadOrCreateSessionState(input: HookInput): SessionState | undefined {
  const existing = readSessionState(input.session_id);
  if (existing) {
    return existing;
  }
  const repository = repositoryInformation(input.cwd);
  if (!repository || !isRepositoryEnabled(repository.rootPath)) {
    return undefined;
  }
  const identity = gitIdentity(repository.rootPath);
  if (!identity) {
    return undefined;
  }
  const state: SessionState = {
    metadata: {
      sessionId: input.session_id,
      person: identity,
      repositoryRemoteUrl: repository.remoteUrl,
      repositoryRootPath: repository.rootPath,
      branch: repository.branch,
      workingDirectory: input.cwd,
    },
    transcriptPath: input.transcript_path,
    intentText: undefined,
    editedFiles: [],
    checkedFiles: [],
    paused: false,
  };
  writeSessionState(state);
  return state;
}

function withPendingMatches(sessionId: string, hookEventName: string): HookOutput | undefined {
  const matches = takePendingMatches(sessionId);
  if (matches.length === 0) {
    return undefined;
  }
  return { hookSpecificOutput: { hookEventName, additionalContext: formatMatchesForClaude(matches) } };
}

function onUserPromptSubmit(input: HookInput, state: SessionState): HookOutput | undefined {
  const prompt = input.prompt?.trim() ?? "";
  if (!state.intentText && prompt.length >= minimumIntentCharacters && !prompt.startsWith("/")) {
    state.intentText = prompt.slice(0, maximumIntentCharacters);
    writeSessionState(state);
    runInBackground("match", [state.metadata.sessionId]);
  }
  return withPendingMatches(state.metadata.sessionId, input.hook_event_name);
}

function repositoryRelativePath(filePath: string, repositoryRootPath: string): string | undefined {
  const relativePath = path.relative(repositoryRootPath, path.resolve(repositoryRootPath, filePath));
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }
  return relativePath;
}

function onPostToolUse(input: HookInput, state: SessionState): HookOutput | undefined {
  const toolInput = input.tool_input ?? {};
  if (input.tool_name === "ExitPlanMode" && typeof toolInput.plan === "string") {
    state.intentText = toolInput.plan.slice(0, maximumIntentCharacters);
    writeSessionState(state);
    runInBackground("match", [state.metadata.sessionId]);
  }
  const filePath = toolInput.file_path ?? toolInput.notebook_path;
  if (fileEditingTools.has(input.tool_name ?? "") && typeof filePath === "string") {
    const relativePath = repositoryRelativePath(filePath, state.metadata.repositoryRootPath);
    if (relativePath && !state.checkedFiles.includes(relativePath)) {
      state.checkedFiles.push(relativePath);
      state.editedFiles.push(relativePath);
      writeSessionState(state);
      runInBackground("match", [state.metadata.sessionId]);
    }
  }
  return withPendingMatches(state.metadata.sessionId, input.hook_event_name);
}

export function handleHook(input: HookInput): HookOutput | undefined {
  const state =
    input.hook_event_name === "PostToolUse" ? readSessionState(input.session_id) : loadOrCreateSessionState(input);
  if (!state || state.paused) {
    return undefined;
  }
  if (input.hook_event_name === "UserPromptSubmit") {
    return onUserPromptSubmit(input, state);
  }
  if (input.hook_event_name === "PostToolUse") {
    return onPostToolUse(input, state);
  }
  if (["Stop", "PreCompact", "SessionEnd"].includes(input.hook_event_name)) {
    runInBackground("upload", [state.metadata.sessionId]);
  }
  return undefined;
}
