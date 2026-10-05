// Neon (HTTP) + Drizzle. Created lazily so tests and scripts that never touch the DB don't
// need DATABASE_URL; a missing URL fails loudly at first use.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function db() {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    instance = drizzle(neon(url), { schema });
  }
  return instance;
}
