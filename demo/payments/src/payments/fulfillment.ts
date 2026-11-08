import { database } from "../database";

export async function fulfillOrder(orderId: string): Promise<void> {
  await fetch(`${process.env.WAREHOUSE_URL}/shipments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  await fetch(`${process.env.MAILER_URL}/order-confirmation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  await database.query("UPDATE orders SET status = 'fulfilled' WHERE id = $1", [orderId]);
}
