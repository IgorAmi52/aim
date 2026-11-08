import { checkForMatches } from "./matcher";
import { handleHook, type HookInput } from "./hooks";
import { importHistory } from "./history";
import { startMcpServer } from "./mcpServer";
import { log } from "./state";
import { uploadSession } from "./uploader";

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runHook(): Promise<void> {
  const input = JSON.parse(await readStandardInput()) as HookInput;
  const output = handleHook(input);
  if (output) {
    process.stdout.write(JSON.stringify(output));
  }
}

const [command, ...commandArguments] = process.argv.slice(2);

try {
  if (command === "hook") {
    await runHook();
  } else if (command === "upload") {
    await uploadSession(commandArguments[0]);
  } else if (command === "match") {
    await checkForMatches(commandArguments[0]);
  } else if (command === "import") {
    await importHistory(commandArguments[0], Number(commandArguments[1]));
  } else if (command === "mcp") {
    await startMcpServer();
  } else {
    throw new Error(`Unknown aim command: ${command}`);
  }
} catch (error) {
  log(`aim ${command} failed`, error);
}
