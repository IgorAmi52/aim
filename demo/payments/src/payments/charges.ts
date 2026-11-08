import type Stripe from "stripe";
import { database } from "../database";

export type Charge = {
  id: string;
  orderId: string;
};

export async function createCharge(paymentIntent: Stripe.PaymentIntent): Promise<Charge> {
  const { rows } = await database.query<Charge>(
    `INSERT INTO charges (order_id, payment_intent_id, amount, currency)
     VALUES ($1, $2, $3, $4)
     RETURNING id, order_id AS "orderId"`,
    [paymentIntent.metadata.orderId, paymentIntent.id, paymentIntent.amount, paymentIntent.currency],
  );
  return rows[0];
}
