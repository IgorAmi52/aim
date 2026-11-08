import { readFileSync } from "node:fs";
import { redactTranscript } from "@aim/shared";
import { appendTranscript } from "./client";
import { readSessionState, readUploadOffset, writeUploadOffset } from "./state";

const maximumChunkBytes = 4 * 1024 * 1024;
const maximumRequestsPerRun = 50;
const newline = 0x0a;

function completeLinesEnd(transcript: Buffer, startOffset: number): number {
  const windowEnd = Math.min(transcript.length, startOffset + maximumChunkBytes);
  const lastNewlineInWindow = transcript.lastIndexOf(newline, windowEnd - 1);
  if (lastNewlineInWindow >= startOffset) {
    return lastNewlineInWindow + 1;
  }
  const nextNewline = transcript.indexOf(newline, startOffset);
  return nextNewline === -1 ? startOffset : nextNewline + 1;
}

export async function uploadSession(sessionId: string): Promise<void> {
  const state = readSessionState(sessionId);
  if (!state || state.paused) {
    return;
  }
  const transcript = readFileSync(state.transcriptPath);
  let offset = readUploadOffset(sessionId);

  for (let request = 0; request < maximumRequestsPerRun; request++) {
    const endOffset = completeLinesEnd(transcript, offset);
    if (endOffset <= offset) {
      return;
    }
    const result = await appendTranscript({
      session: state.metadata,
      sourceStartOffset: offset,
      sourceEndOffset: endOffset,
      content: redactTranscript(transcript.subarray(offset, endOffset).toString("utf8")),
    });
    offset = result.status === "accepted" ? result.acceptedEndOffset : result.expectedStartOffset;
    writeUploadOffset(sessionId, offset);
  }
}
