type ContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
};

type TranscriptRecord = {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  timestamp?: string;
  gitBranch?: string;
  prUrl?: string;
  message?: { content?: string | ContentBlock[] };
};

export type TranscriptFacts = {
  editedFilePaths: string[];
  pullRequestUrls: string[];
  branch: string | undefined;
  firstActivityAt: Date | undefined;
  lastActivityAt: Date | undefined;
};

const fileEditingTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const maximumEntryCharacters = 4_000;
const maximumToolSummaryCharacters = 300;

export function parseTranscript(content: string): TranscriptRecord[] {
  const records: TranscriptRecord[] = [];
  for (const line of content.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    try {
      records.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return records;
}

function contentBlocks(record: TranscriptRecord): ContentBlock[] {
  const content = record.message?.content;
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content ?? [];
}

function editedFilePath(block: ContentBlock): string | undefined {
  if (block.type !== "tool_use" || !fileEditingTools.has(block.name ?? "")) {
    return undefined;
  }
  const filePath = block.input?.file_path ?? block.input?.notebook_path;
  if (typeof filePath === "string") {
    return filePath;
  }
  return undefined;
}

export function extractTranscriptFacts(records: TranscriptRecord[]): TranscriptFacts {
  const editedFilePaths = new Set<string>();
  const pullRequestUrls = new Set<string>();
  let branch: string | undefined;
  let firstActivityAt: Date | undefined;
  let lastActivityAt: Date | undefined;

  for (const record of records) {
    if (record.type === "pr-link" && record.prUrl) {
      pullRequestUrls.add(record.prUrl);
    }
    if (record.gitBranch) {
      branch = record.gitBranch;
    }
    if (record.timestamp && (record.type === "user" || record.type === "assistant")) {
      const timestamp = new Date(record.timestamp);
      if (!firstActivityAt || timestamp < firstActivityAt) {
        firstActivityAt = timestamp;
      }
      if (!lastActivityAt || timestamp > lastActivityAt) {
        lastActivityAt = timestamp;
      }
    }
    if (record.type === "assistant") {
      for (const block of contentBlocks(record)) {
        const filePath = editedFilePath(block);
        if (filePath) {
          editedFilePaths.add(filePath);
        }
      }
    }
  }

  return {
    editedFilePaths: [...editedFilePaths],
    pullRequestUrls: [...pullRequestUrls],
    branch,
    firstActivityAt,
    lastActivityAt,
  };
}

function truncate(text: string, maximumCharacters: number): string {
  if (text.length <= maximumCharacters) {
    return text;
  }
  return `${text.slice(0, maximumCharacters)}…`;
}

function describeToolUse(block: ContentBlock): string {
  const input = block.input ?? {};
  if (typeof input.file_path === "string") {
    return `Tool ${block.name}: ${input.file_path}`;
  }
  if (typeof input.command === "string") {
    return `Tool ${block.name}: ${truncate(input.command, maximumToolSummaryCharacters)}`;
  }
  return `Tool ${block.name}: ${truncate(JSON.stringify(input), maximumToolSummaryCharacters)}`;
}

export function condenseTranscript(records: TranscriptRecord[]): string[] {
  const entries: string[] = [];
  for (const record of records) {
    if (record.isSidechain || record.isMeta) {
      continue;
    }
    if (record.type !== "user" && record.type !== "assistant") {
      continue;
    }
    const speaker = record.type === "user" ? "User" : "Assistant";
    for (const block of contentBlocks(record)) {
      if (block.type === "text" && block.text?.trim()) {
        entries.push(`${speaker}: ${truncate(block.text.trim(), maximumEntryCharacters)}`);
      }
      if (block.type === "tool_use") {
        entries.push(describeToolUse(block));
      }
    }
  }
  return entries;
}

export function groupEntries(entries: string[], maximumCharacters: number): string[] {
  const groups: string[] = [];
  let current = "";
  for (const entry of entries) {
    if (current !== "" && current.length + entry.length > maximumCharacters) {
      groups.push(current);
      current = "";
    }
    current = current === "" ? entry : `${current}\n${entry}`;
  }
  if (current !== "") {
    groups.push(current);
  }
  return groups;
}
