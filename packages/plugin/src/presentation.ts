import type { Match } from "@aim/shared";

export const toolNames = {
  search: "mcp__plugin_aim_aim__search",
  getSessionContext: "mcp__plugin_aim_aim__get_session_context",
  reportMatchAction: "mcp__plugin_aim_aim__report_match_action",
};

export const peerAgentType = "aim:peer";

function relativeTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) {
    return "at an unknown time";
  }
  const minutes = Math.round((Date.now() - new Date(isoTimestamp).getTime()) / 60_000);
  if (minutes < 60) {
    return `${Math.max(minutes, 1)} minutes ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} hours ago`;
  }
  return `${Math.round(hours / 24)} days ago`;
}

function describeMatch(match: Match, index: number): string {
  const { session, owner } = match;
  const status = session.isActive ? "working on it right now" : `last active ${relativeTime(session.lastActivityAt)}`;
  const facts = [
    `type: ${match.type}`,
    `outcome: ${session.outcome ?? "unknown"}`,
    status,
    session.branch ? `branch ${session.branch}` : undefined,
    session.pullRequestUrls.length > 0 ? `pull requests: ${session.pullRequestUrls.join(", ")}` : undefined,
  ].filter(Boolean);
  return `Match ${index + 1}: ${owner.displayName} (${owner.email}) — "${session.title ?? "untitled session"}"
  ${facts.join("; ")}
  Why it matters: ${match.reason}
  Their intent: ${session.intent ?? "not summarized yet"}
  matchId: ${match.matchId}
  sessionId: ${session.sessionId}
  Slack: ${owner.slack ? `available, DM link ${owner.slack.deepLink}` : "not available"}`;
}

export function formatMatchesForClaude(matches: Match[]): string {
  return `aim (the team's work-awareness plugin) found work by other developers that overlaps with this session. Before continuing, show it to the developer.

${matches.map(describeMatch).join("\n\n")}

Call AskUserQuestion once, with one question per match (header "aim"). In each question name the person and say in one sentence what they did and why it matters. Offer these options:
- "Ask <first name>'s session agent": talk to an agent that knows their session.
- "Message <first name> on Slack" when Slack is available, otherwise "Draft a message to <first name>".
- "Show details": summarize their work here.
- "Ignore": continue without it.

Then, for each answer:
1. Call ${toolNames.reportMatchAction} with the matchId and the action (peer_agent, slack, details or ignored).
2. peer_agent: launch the ${peerAgentType} subagent with the sessionId, the owner's name, what the developer is working on, and the developer's question (ask for one if it is not obvious from the task). Relay its answer, including any proposed agreement.
3. slack: call ${toolNames.getSessionContext} for the sessionId, then draft a short message from the developer to the owner: what the developer is working on, the overlap, and one concrete question. Show the draft and the Slack DM link. Never send anything yourself.
4. details: call ${toolNames.getSessionContext} for the sessionId and summarize the intent, approach, decisions and outcome.
5. ignored: say nothing more about it.

Afterwards, continue with what the developer asked for.`;
}
