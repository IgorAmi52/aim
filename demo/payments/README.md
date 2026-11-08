# payments

Payment service for the shop: receives Stripe webhooks, records charges and fulfills orders.

- `src/payments/webhookHandler.ts` — Stripe webhook endpoint
- `src/payments/charges.ts` — charge records
- `src/payments/fulfillment.ts` — warehouse and confirmation email
