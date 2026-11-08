import { matchActionSchema } from "@aim/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runInBackground } from "./background";
import { getSessionContext, listSessions, recordMatchAction, searchSessions } from "./client";
import { projectDirectory } from "./configuration";
import { gitIdentity, repositoryInformation } from "./git";
import { findHistoricalSessions } from "./history";
import { isRepositoryEnabled, readSessionState, setRepositoryEnabled, writeSessionState } from "./state";

const defaultImportDays = 30;

function textResult(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `aim error: ${message}` }], isError: true };
}

async function safely(action: () => Promise<unknown> | unknown) {
  try {
    return textResult(await action());
  } catch (error) {
    return errorResult(error);
  }
}

function currentRepository() {
  const repository = repositoryInformation(projectDirectory());
  if (!repository) {
    throw new Error(`${projectDirectory()} is not inside a git repository`);
  }
  return repository;
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: "aim", version: "0.1.0" });

  server.registerTool(
    "search",
    {
      description: "Search other developers' Claude Code sessions for work related to a topic, problem or piece of code.",
      inputSchema: {
        query: z.string().describe("What to look for, in plain words."),
        thisRepositoryOnly: z.boolean().default(false),
      },
    },
    ({ query, thisRepositoryOnly }) =>
      safely(() =>
        searchSessions({
          query,
          repositoryRemoteUrl: thisRepositoryOnly ? currentRepository().remoteUrl : undefined,
          limit: 10,
        }),
      ),
  );

  server.registerTool(
    "get_session_context",
    {
      description:
        "Get another developer's session: its work card (intent, approach, decisions, outcome), owner and the transcript excerpts most relevant to the focus.",
      inputSchema: {
        sessionId: z.string(),
        focus: z.string().optional().describe("The question or topic to pull transcript excerpts for."),
      },
    },
    ({ sessionId, focus }) => safely(() => getSessionContext(sessionId, focus)),
  );

  server.registerTool(
    "report_match_action",
    {
      description: "Record what the developer chose to do with an aim match.",
      inputSchema: { matchId: z.string(), action: matchActionSchema },
    },
    ({ matchId, action }) => safely(() => recordMatchAction(matchId, action)),
  );

  server.registerTool(
    "status",
    {
      description: "Show whether aim is enabled for this repository, who the developer is, and which of their sessions were uploaded.",
      inputSchema: {},
    },
    () =>
      safely(async () => {
        const repository = currentRepository();
        const identity = gitIdentity(repository.rootPath);
        const enabled = isRepositoryEnabled(repository.rootPath);
        const uploaded = identity ? await listSessions(identity.email) : { sessions: [] };
        return { repository, identity, enabled, uploadedSessions: uploaded.sessions.slice(0, 10) };
      }),
  );

  server.registerTool(
    "set_repository_enabled",
    {
      description: "Turn aim capture and matching on or off for the current repository.",
      inputSchema: { enabled: z.boolean() },
    },
    ({ enabled }) =>
      safely(() => {
        const repository = currentRepository();
        setRepositoryEnabled(repository.rootPath, enabled);
        return { repository: repository.rootPath, enabled };
      }),
  );

  server.registerTool(
    "pause_session",
    {
      description: "Stop aim capture and matching for the rest of one session. Already uploaded parts stay on the server.",
      inputSchema: { sessionId: z.string() },
    },
    ({ sessionId }) =>
      safely(() => {
        const state = readSessionState(sessionId);
        if (!state) {
          return "aim is not capturing this session.";
        }
        writeSessionState({ ...state, paused: true });
        return "aim is paused for this session.";
      }),
  );

  server.registerTool(
    "import_history",
    {
      description:
        "Import the developer's past Claude Code sessions for this repository. Call with confirm false to preview, and with confirm true only after the developer agreed.",
      inputSchema: {
        confirm: z.boolean(),
        days: z.number().int().positive().max(365).default(defaultImportDays),
      },
    },
    ({ confirm, days }) =>
      safely(() => {
        const repository = currentRepository();
        if (!isRepositoryEnabled(repository.rootPath)) {
          throw new Error("aim is not enabled for this repository; enable it first");
        }
        const sessions = findHistoricalSessions(repository.rootPath, days);
        if (!confirm) {
          return {
            sessionCount: sessions.length,
            totalMegabytes: Math.round(sessions.reduce((total, session) => total + session.sizeBytes, 0) / 1_048_576),
            sessions: sessions.slice(0, 20).map((session) => ({
              title: session.title ?? "untitled",
              lastModifiedAt: session.lastModifiedAt.toISOString(),
            })),
          };
        }
        runInBackground("import", [repository.rootPath, String(days)]);
        return `Importing ${sessions.length} sessions in the background. Secrets are redacted before upload.`;
      }),
  );

  await server.connect(new StdioServerTransport());
}
