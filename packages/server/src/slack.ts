import type { SlackContact } from "@aim/shared";
import { eq } from "drizzle-orm";
import { configuration } from "./configuration";
import { database } from "./database/client";
import { people, type PersonRow } from "./database/schema";

const lookupRetryMilliseconds = 24 * 60 * 60_000;
let cachedTeamId: string | undefined;

async function callSlack<Response>(method: string, parameters: Record<string, string> = {}): Promise<Response & { ok: boolean }> {
  const query = new URLSearchParams(parameters).toString();
  const response = await fetch(`https://slack.com/api/${method}?${query}`, {
    headers: { authorization: `Bearer ${configuration.SLACK_BOT_TOKEN}` },
  });
  return (await response.json()) as Response & { ok: boolean };
}

async function teamId(): Promise<string | undefined> {
  if (!cachedTeamId) {
    const response = await callSlack<{ team_id?: string }>("auth.test");
    cachedTeamId = response.team_id;
  }
  return cachedTeamId;
}

async function slackUserId(person: PersonRow): Promise<string | null> {
  if (person.slackUserId) {
    return person.slackUserId;
  }
  const checkedRecently = person.slackCheckedAt && Date.now() - person.slackCheckedAt.getTime() < lookupRetryMilliseconds;
  if (checkedRecently) {
    return null;
  }
  const response = await callSlack<{ user?: { id: string } }>("users.lookupByEmail", { email: person.email });
  const userId = response.ok && response.user ? response.user.id : null;
  await database.update(people).set({ slackUserId: userId, slackCheckedAt: new Date() }).where(eq(people.id, person.id));
  return userId;
}

export async function resolveSlackContact(person: PersonRow): Promise<SlackContact | null> {
  if (!configuration.SLACK_BOT_TOKEN) {
    return null;
  }
  const userId = await slackUserId(person);
  const team = await teamId();
  if (!userId || !team) {
    return null;
  }
  return { userId, deepLink: `slack://user?team=${team}&id=${userId}` };
}
