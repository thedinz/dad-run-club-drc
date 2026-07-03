import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { env } from "./config.js";
import { hashPassword } from "./security.js";

export const pool = new Pool({
  connectionString: env.databaseUrl
});

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      chat_message_id TEXT REFERENCES chat_messages(id) ON DELETE CASCADE,
      original_name TEXT,
      mime_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_settings (
      id TEXT PRIMARY KEY CHECK (id = 'default'),
      admin_username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      chat_retention_days INTEGER NOT NULL DEFAULT 365,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
  `);

  await ensureUserCredentials();

  await pool.query(`
    ALTER TABLE users ALTER COLUMN username SET NOT NULL;
    ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx
      ON users (LOWER(username));
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
      ON users (LOWER(email));
  `);

  const adminSettings = await pool.query(
    "SELECT id FROM admin_settings WHERE id = 'default'"
  );

  if (adminSettings.rowCount === 0) {
    await pool.query(
      `INSERT INTO admin_settings
        (id, admin_username, password_hash, chat_retention_days)
       VALUES ('default', $1, $2, 365)`,
      [env.adminUsername, hashPassword(env.adminPassword)]
    );
  }

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

async function ensureUserCredentials() {
  const users = await pool.query<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    username: string | null;
    password_hash: string | null;
  }>(
    `SELECT id, first_name, last_name, email, username, password_hash
     FROM users
     ORDER BY created_at ASC`
  );

  const usedUsernames = new Set<string>();

  for (const user of users.rows) {
    const existingUsername = user.username
      ? normalizeUsername(user.username)
      : "";
    const username =
      existingUsername && !usedUsernames.has(existingUsername)
        ? existingUsername
        : uniqueUsername(
            normalizeUsername(
              user.email.split("@")[0] ||
                `${user.first_name}.${user.last_name}` ||
                "member"
            ),
            usedUsernames
          );

    usedUsernames.add(username);

    await pool.query(
      `UPDATE users
       SET username = $2,
           password_hash = COALESCE(password_hash, $3)
       WHERE id = $1`,
      [user.id, username, hashPassword(randomUUID())]
    );
  }
}

export function normalizeUsername(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 32) || "member"
  );
}

function uniqueUsername(base: string, usedUsernames: Set<string>) {
  let candidate = base;
  let suffix = 2;

  while (usedUsernames.has(candidate)) {
    const ending = `-${suffix}`;
    candidate = `${base.slice(0, 32 - ending.length)}${ending}`;
    suffix += 1;
  }

  return candidate;
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
