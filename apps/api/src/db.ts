import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { env } from "./config.js";

export const pool = new Pool({
  connectionString: env.databaseUrl
});

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT,
      max_uses INTEGER,
      uses INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      all_day BOOLEAN NOT NULL DEFAULT FALSE,
      recurrence_rule TEXT,
      color TEXT NOT NULL DEFAULT '#1f8a70',
      created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS event_exceptions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      occurrence_start_at TIMESTAMPTZ NOT NULL,
      action TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_id, occurrence_start_at)
    );
  `);

  const invite = await pool.query(
    "SELECT id FROM invite_codes WHERE UPPER(code) = UPPER($1)",
    [env.seedInviteCode]
  );

  if (invite.rowCount === 0) {
    await pool.query(
      `INSERT INTO invite_codes (id, code, label, max_uses)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), env.seedInviteCode, "Founding members", null]
    );
  }

  const eventCount = await pool.query("SELECT COUNT(*)::int AS count FROM calendar_events");
  if (eventCount.rows[0]?.count === 0) {
    const nextSaturday = getNextSaturdayAtEight();
    const end = new Date(nextSaturday.getTime() + 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO calendar_events
        (id, title, description, location, start_at, end_at, recurrence_rule, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        "Saturday Morning Run",
        "Weekly meetup for DRC Plymouth.",
        "Vela Juice Bar",
        nextSaturday,
        end,
        `DTSTART:${toRRuleDate(nextSaturday)}\nRRULE:FREQ=WEEKLY;INTERVAL=1`,
        "#1f8a70"
      ]
    );
  }
}

function getNextSaturdayAtEight() {
  const date = new Date();
  const daysUntilSaturday = (6 - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilSaturday);
  date.setHours(8, 0, 0, 0);
  return date;
}

function toRRuleDate(date: Date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
