import { drizzle } from "drizzle-orm/node-postgres";
import { configuration } from "../configuration";
import * as schema from "./schema";

export const database = drizzle(configuration.DATABASE_URL, { schema });
