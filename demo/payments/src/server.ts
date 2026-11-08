import express from "express";
import { handleStripeWebhook } from "./payments/webhookHandler";

const application = express();

application.post("/webhooks/stripe", express.raw({ type: "application/json" }), handleStripeWebhook);

application.listen(Number(process.env.PORT ?? 3000));
