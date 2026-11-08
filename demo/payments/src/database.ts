import { Pool } from "pg";

export const database = new Pool({ connectionString: process.env.DATABASE_URL });
