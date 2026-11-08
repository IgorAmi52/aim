import type { Request, Response } from "express";
import Stripe from "stripe";
import { createCharge } from "./charges";
import { fulfillOrder } from "./fulfillment";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function handleStripeWebhook(request: Request, response: Response) {
  const signature = request.headers["stripe-signature"] as string;
  const event = stripe.webhooks.constructEvent(request.body, signature, process.env.STRIPE_WEBHOOK_SECRET!);

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const charge = await createCharge(paymentIntent);
    await fulfillOrder(charge.orderId);
  }

  response.sendStatus(200);
}
