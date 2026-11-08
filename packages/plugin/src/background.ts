import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export type BackgroundCommand = "upload" | "match" | "import";

export function runInBackground(command: BackgroundCommand, commandArguments: string[]): void {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), command, ...commandArguments], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}
