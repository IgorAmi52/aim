import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { database } from "./client";

await database.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
await migrate(database, { migrationsFolder: "./drizzle" });
await database.$client.end();
console.log("Database migrated");
