import { findMatches } from "./client";
import { addPendingMatches, readSessionState } from "./state";

export async function checkForMatches(sessionId: string): Promise<void> {
  const state = readSessionState(sessionId);
  if (!state) {
    return;
  }
  const intentText = state.intentText ?? `Editing ${state.editedFiles.join(", ")}`;
  const { matches } = await findMatches({ session: state.metadata, intentText, editedFiles: state.editedFiles });
  if (matches.length > 0) {
    addPendingMatches(sessionId, matches);
  }
}
