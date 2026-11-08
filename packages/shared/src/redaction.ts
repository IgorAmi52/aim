const secretPatterns: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/g },
  { name: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { name: "stripe-key", pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: "json-web-token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "bearer-token", pattern: /(?<prefix>\bBearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi },
  {
    name: "connection-string-password",
    pattern: /(?<prefix>\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(?<suffix>@)/gi,
  },
  {
    name: "assigned-secret",
    pattern:
      /(?<prefix>\b[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|credential)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?)(?=[^\s"',;()]*\d)[^\s"',;()]{8,}/gi,
  },
];

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const { name, pattern } of secretPatterns) {
    redacted = redacted.replace(pattern, (...replaceArguments: unknown[]) => {
      const lastArgument = replaceArguments.at(-1);
      const groups = typeof lastArgument === "object" && lastArgument !== null ? (lastArgument as Record<string, string | undefined>) : {};
      return `${groups.prefix ?? ""}[REDACTED:${name}]${groups.suffix ?? ""}`;
    });
  }
  return redacted;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactValue(entry)]));
  }
  return value;
}

function redactTranscriptLine(line: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(line)));
  } catch {
    return redactSecrets(line);
  }
}

export function redactTranscript(content: string): string {
  return content
    .split("\n")
    .map((line) => (line === "" ? line : redactTranscriptLine(line)))
    .join("\n");
}
