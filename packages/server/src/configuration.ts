import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().default("postgres://aim:aim@localhost:5432/aim"),
  AIM_DEMO_MODE: z.stringbool().default(false),
  PORT: z.coerce.number().int().default(4100),
  AIM_TOKEN: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  AIM_RAW_STORE_PATH: z.string().default("./data/raw"),
  AIM_DISTILL_MODEL: z.string().default("claude-haiku-4-5"),
  AIM_JUDGE_MODEL: z.string().default("claude-haiku-4-5"),
  AIM_EMBEDDING_MODEL: z.string().default("voyage-4-lite"),
  AIM_RERANK_MODEL: z.string().default("rerank-3-lite"),
  AIM_ACTIVE_SESSION_MINUTES: z.coerce.number().default(30),
  AIM_MATCH_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.7),
  AIM_MINIMUM_SIMILARITY: z.coerce.number().default(0.4),
  AIM_DISTILL_DEBOUNCE_SECONDS: z.coerce.number().default(120),
  AIM_DISTILL_MAXIMUM_WAIT_SECONDS: z.coerce.number().default(900),
});

export type Configuration = z.infer<typeof environmentSchema>;

export const configuration = environmentSchema.parse(process.env);

export function assertConfigured(keys: Array<keyof Configuration>): void {
  const missingKeys = keys.filter((key) => !configuration[key]);
  if (missingKeys.length > 0) {
    throw new Error(`Missing required environment variables: ${missingKeys.join(", ")}`);
  }
}

export function activeSessionCutoff(): Date {
  return new Date(Date.now() - configuration.AIM_ACTIVE_SESSION_MINUTES * 60_000);
}
