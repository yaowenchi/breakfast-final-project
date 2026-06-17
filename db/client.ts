import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for PostgreSQL store. Set DATABASE_URL or switch STORE_DRIVER=json.",
  );
}

const sql = postgres(databaseUrl, {
  ssl: "require",
  max: 5,
});

export const db = drizzle(sql, { schema });
