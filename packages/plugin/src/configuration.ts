export type ServerSettings = {
  serverUrl: string;
  token: string;
};

export function readServerSettings(): ServerSettings {
  const serverUrl = process.env.CLAUDE_PLUGIN_OPTION_SERVER_URL || process.env.AIM_SERVER_URL;
  const token = process.env.CLAUDE_PLUGIN_OPTION_TOKEN || process.env.AIM_TOKEN;
  if (!serverUrl || !token) {
    throw new Error("aim is not configured: set the server URL and token in the aim plugin options");
  }
  return { serverUrl, token };
}

export function projectDirectory(): string {
  return process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}
