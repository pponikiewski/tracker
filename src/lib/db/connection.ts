import Database from "@tauri-apps/plugin-sql";
import { SCHEMA_SQL } from "./schema";

const DB_URL = "sqlite:tracker.db";

let cached: Database | null = null;

export async function getDb(): Promise<Database> {
  if (cached) return cached;
  const db = await Database.load(DB_URL);
  await db.execute("PRAGMA foreign_keys = ON");
  await db.execute(SCHEMA_SQL);
  cached = db;
  return db;
}

export async function closeDb(): Promise<void> {
  if (!cached) return;
  await cached.close();
  cached = null;
}
