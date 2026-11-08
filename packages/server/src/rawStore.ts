import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { configuration } from "./configuration";

function rawTranscriptPath(sessionId: string): string {
  return path.join(configuration.AIM_RAW_STORE_PATH, `${sessionId}.jsonl`);
}

export async function appendRawTranscript(sessionId: string, content: string): Promise<void> {
  await mkdir(configuration.AIM_RAW_STORE_PATH, { recursive: true });
  await appendFile(rawTranscriptPath(sessionId), content);
}

export async function rawTranscriptSize(sessionId: string): Promise<number> {
  try {
    return (await stat(rawTranscriptPath(sessionId))).size;
  } catch {
    return 0;
  }
}

export async function readRawTranscript(sessionId: string, startOffset = 0): Promise<{ content: string; endOffset: number }> {
  let buffer: Buffer;
  try {
    buffer = await readFile(rawTranscriptPath(sessionId));
  } catch {
    return { content: "", endOffset: 0 };
  }
  return { content: buffer.subarray(startOffset).toString("utf8"), endOffset: buffer.length };
}
