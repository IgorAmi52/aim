import { setTimeout as sleep } from "node:timers/promises";
import { assertConfigured, configuration } from "./configuration";
import { distillSession, findSessionsAwaitingDistillation, postponeDistillation } from "./distiller";

if (!configuration.AIM_DEMO_MODE) {
  assertConfigured(["ANTHROPIC_API_KEY", "VOYAGE_API_KEY"]);
}

const pollIntervalMilliseconds = 5_000;
const batchSize = 10;

console.log("aim worker started");

while (true) {
  const sessionIds = await findSessionsAwaitingDistillation(batchSize);
  for (const sessionId of sessionIds) {
    try {
      await distillSession(sessionId);
      console.log(`Distilled session ${sessionId}`);
    } catch (error) {
      console.error(`Distilling session ${sessionId} failed`, error);
      await postponeDistillation(sessionId);
    }
  }
  if (sessionIds.length === 0) {
    await sleep(pollIntervalMilliseconds);
  }
}
