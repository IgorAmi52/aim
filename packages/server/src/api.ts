import { serve } from "@hono/node-server";
import { assertConfigured, configuration } from "./configuration";

assertConfigured(configuration.AIM_DEMO_MODE ? ["AIM_TOKEN"] : ["AIM_TOKEN", "ANTHROPIC_API_KEY", "VOYAGE_API_KEY"]);

const { application } = await import("./application");

serve({ fetch: application.fetch, port: configuration.PORT }, (address) => {
  console.log(`aim api listening on http://localhost:${address.port}`);
});
