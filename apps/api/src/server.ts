import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { Server as SocketIOServer } from "socket.io";
import { z } from "zod";
import {
  buildRecurrenceRule,
  type EventRow,
  expandEvents,
  type ExceptionRow,
  type RecurrenceFrequency
} from "./calendar.js";
import { corsOrigin, env } from "./config.js";
import { migrate, pool } from "./db.js";
import { getInstagramFeed } from "./instagram.js";
import {
  getUserFromToken,
  requireActor,
  requireAdmin,
  requireUser,
  signSession
} from "./auth.js";

const registerSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().email(),
  inviteCode: z.string().trim().min(2)
});

const messageSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

const eventSchema = z.object({
  title: z.string().trim().min(2),
  description: z.string().trim().optional().nullable(),
  location: z.string().trim().optional().nullable(),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  allDay: z.boolean().optional().default(false),
  recurrenceFrequency: z
    .enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"])
    .optional()
    .default("NONE"),
  recurrenceUntil: z.string().optional().nullable(),
  color: z.string().trim().optional().default("#1f8a70")
});

const inviteSchema = z.object({
  code: z.string().trim().min(2),
  label: z.string().trim().optional().nullable(),
  maxUses: z.number().int().positive().optional().nullable(),
  expiresAt: z.string().optional().nullable()
});

const fastify = Fastify({
  logger: {
    level: env.nodeEnv === "production" ? "info" : "debug"
  }
});

await fastify.register(cors, {
  origin: corsOrigin(),
  credentials: true
});

fastify.get("/health", async () => ({
  ok: true,
  service: "drc-api",
  time: new Date().toISOString()
}));

fastify.post("/auth/register", async (request, reply) => {
  const body = registerSchema.parse(request.body);
  const email = body.email.toLowerCase();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const invite = await client.query(
      `SELECT * FROM invite_codes
       WHERE UPPER(code) = UPPER($1)
       FOR UPDATE`,
      [body.inviteCode]
    );

    const inviteRow = invite.rows[0];
    if (!inviteRow || !inviteRow.active) {
      await client.query("ROLLBACK");
      return reply.code(400).send({ error: "Invite code is not valid" });
    }

    if (inviteRow.expires_at && new Date(inviteRow.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return reply.code(400).send({ error: "Invite code has expired" });
    }

    if (
      inviteRow.max_uses !== null &&
      Number(inviteRow.uses) >= Number(inviteRow.max_uses)
    ) {
      await client.query("ROLLBACK");
      return reply.code(400).send({ error: "Invite code has reached its limit" });
    }

    const userId = randomUUID();
    const userResult = await client.query(
      `INSERT INTO users (id, first_name, last_name, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, first_name, last_name, email`,
      [userId, body.firstName, body.lastName, email]
    );

    await client.query(
      "UPDATE invite_codes SET uses = uses + 1 WHERE id = $1",
      [inviteRow.id]
    );

    await client.query("COMMIT");
    const user = userFromRow(userResult.rows[0]);
    return reply.send({ token: signSession(user), user });
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      return reply.code(409).send({ error: "That email is already registered" });
    }

    request.log.error(error);
    return reply.code(500).send({ error: "Could not create account" });
  } finally {
    client.release();
  }
});

fastify.get("/auth/me", { preHandler: requireUser }, async (request) => ({
  user: request.user
}));

fastify.get("/instagram/feed", async () => getInstagramFeed());

fastify.get("/chat/messages", { preHandler: requireUser }, async (request) => {
  const query = request.query as { limit?: string };
  const limit = Math.min(Number(query.limit ?? 50), 100);
  const messages = await pool.query(
    `SELECT chat_messages.id, chat_messages.body, chat_messages.created_at,
            users.id AS user_id, users.first_name, users.last_name
     FROM chat_messages
     JOIN users ON users.id = chat_messages.user_id
     ORDER BY chat_messages.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return {
    messages: messages.rows.reverse().map(messageFromRow)
  };
});

fastify.post("/chat/messages", { preHandler: requireUser }, async (request) => {
  const body = messageSchema.parse(request.body);
  const message = await createMessage(request.user!.id, body.body);
  io.emit("chat:message", message);
  return { message };
});

fastify.get("/events", async (request) => {
  const query = request.query as { from?: string; to?: string };
  const from = query.from ? new Date(query.from) : startOfMonth(new Date());
  const to = query.to ? new Date(query.to) : endOfMonth(from);

  const eventRows = await pool.query<EventRow>(
    `SELECT * FROM calendar_events
     WHERE recurrence_rule IS NOT NULL OR (start_at <= $2 AND end_at >= $1)
     ORDER BY start_at ASC`,
    [from, to]
  );

  const eventIds = eventRows.rows.map((event) => event.id);
  const exceptionRows =
    eventIds.length > 0
      ? await pool.query<ExceptionRow>(
          `SELECT * FROM event_exceptions WHERE event_id = ANY($1::text[])`,
          [eventIds]
        )
      : { rows: [] };

  return {
    events: expandEvents(eventRows.rows, exceptionRows.rows, from, to).sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    )
  };
});

fastify.post("/events", { preHandler: requireActor }, async (request) => {
  const body = parseEventPayload(request.body);
  const result = await pool.query<EventRow>(
    `INSERT INTO calendar_events
      (id, title, description, location, start_at, end_at, all_day,
       recurrence_rule, color, created_by_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      randomUUID(),
      body.title,
      body.description,
      body.location,
      body.startAt,
      body.endAt,
      body.allDay,
      body.recurrenceRule,
      body.color,
      request.user?.id ?? null
    ]
  );

  return { event: result.rows[0] };
});

fastify.put("/events/:id", { preHandler: requireActor }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = parseEventPayload(request.body);
  const result = await pool.query<EventRow>(
    `UPDATE calendar_events
     SET title = $2,
         description = $3,
         location = $4,
         start_at = $5,
         end_at = $6,
         all_day = $7,
         recurrence_rule = $8,
         color = $9,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      body.title,
      body.description,
      body.location,
      body.startAt,
      body.endAt,
      body.allDay,
      body.recurrenceRule,
      body.color
    ]
  );

  if (result.rowCount === 0) {
    return reply.code(404).send({ error: "Event not found" });
  }

  return { event: result.rows[0] };
});

fastify.delete(
  "/events/:id",
  { preHandler: requireActor },
  async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as {
      scope?: "single" | "series";
      occurrenceStartAt?: string;
    };

    if (query.scope === "single" && query.occurrenceStartAt) {
      await pool.query(
        `INSERT INTO event_exceptions
          (id, event_id, occurrence_start_at, action)
         VALUES ($1, $2, $3, 'CANCELLED')
         ON CONFLICT (event_id, occurrence_start_at)
         DO UPDATE SET action = 'CANCELLED'`,
        [randomUUID(), id, new Date(query.occurrenceStartAt)]
      );

      return { ok: true, scope: "single" };
    }

    const result = await pool.query("DELETE FROM calendar_events WHERE id = $1", [
      id
    ]);

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: "Event not found" });
    }

    return { ok: true, scope: "series" };
  }
);

fastify.get("/admin/summary", { preHandler: requireAdmin }, async () => {
  const [users, invites, messages, events, latestMessages, feed] =
    await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM users"),
      pool.query("SELECT COUNT(*)::int AS count FROM invite_codes WHERE active = TRUE"),
      pool.query("SELECT COUNT(*)::int AS count FROM chat_messages"),
      pool.query("SELECT COUNT(*)::int AS count FROM calendar_events"),
      pool.query(
        `SELECT chat_messages.id, chat_messages.body, chat_messages.created_at,
                users.id AS user_id, users.first_name, users.last_name
         FROM chat_messages
         JOIN users ON users.id = chat_messages.user_id
         ORDER BY chat_messages.created_at DESC
         LIMIT 5`
      ),
      getInstagramFeed()
    ]);

  return {
    counts: {
      users: users.rows[0].count,
      activeInviteCodes: invites.rows[0].count,
      chatMessages: messages.rows[0].count,
      calendarEvents: events.rows[0].count
    },
    latestMessages: latestMessages.rows.map(messageFromRow),
    instagram: {
      source: feed.source,
      username: feed.username,
      profileUrl: feed.profileUrl,
      note: "note" in feed ? feed.note : undefined
    }
  };
});

fastify.get("/admin/invite-codes", { preHandler: requireAdmin }, async () => {
  const result = await pool.query(
    `SELECT * FROM invite_codes ORDER BY created_at DESC`
  );

  return {
    inviteCodes: result.rows.map(inviteFromRow)
  };
});

fastify.post("/admin/invite-codes", { preHandler: requireAdmin }, async (request) => {
  const body = inviteSchema.parse(request.body);
  const result = await pool.query(
    `INSERT INTO invite_codes (id, code, label, max_uses, expires_at)
     VALUES ($1, UPPER($2), $3, $4, $5)
     RETURNING *`,
    [
      randomUUID(),
      body.code,
      body.label ?? null,
      body.maxUses ?? null,
      body.expiresAt ? new Date(body.expiresAt) : null
    ]
  );

  return { inviteCode: inviteFromRow(result.rows[0]) };
});

fastify.delete(
  "/admin/invite-codes/:id",
  { preHandler: requireAdmin },
  async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(
      "UPDATE invite_codes SET active = FALSE WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: "Invite code not found" });
    }

    return { inviteCode: inviteFromRow(result.rows[0]) };
  }
);

const io = new SocketIOServer(fastify.server, {
  cors: {
    origin: corsOrigin(),
    credentials: true
  }
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (typeof token !== "string") {
    return next(new Error("Authentication required"));
  }

  const user = await getUserFromToken(token);
  if (!user) {
    return next(new Error("Invalid session"));
  }

  socket.data.user = user;
  return next();
});

io.on("connection", (socket) => {
  socket.on("chat:send", async (payload: unknown) => {
    const body = messageSchema.parse(payload);
    const message = await createMessage(socket.data.user.id, body.body);
    io.emit("chat:message", message);
  });
});

await migrate();
await fastify.listen({ port: env.port, host: "0.0.0.0" });

async function createMessage(userId: string, body: string) {
  const result = await pool.query(
    `INSERT INTO chat_messages (id, user_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, body, created_at`,
    [randomUUID(), userId, body]
  );

  const user = await pool.query(
    "SELECT id, first_name, last_name FROM users WHERE id = $1",
    [userId]
  );

  return messageFromRow({
    ...result.rows[0],
    user_id: user.rows[0].id,
    first_name: user.rows[0].first_name,
    last_name: user.rows[0].last_name
  });
}

function parseEventPayload(payload: unknown) {
  const body = eventSchema.parse(payload);
  const startAt = new Date(body.startAt);
  const endAt = new Date(body.endAt);

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new Error("Invalid event date");
  }

  if (endAt <= startAt) {
    throw new Error("Event end time must be after start time");
  }

  return {
    ...body,
    startAt,
    endAt,
    recurrenceRule: buildRecurrenceRule(
      startAt,
      body.recurrenceFrequency as RecurrenceFrequency,
      body.recurrenceUntil ? new Date(body.recurrenceUntil) : null
    )
  };
}

function userFromRow(row: Record<string, string>) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email
  };
}

function messageFromRow(row: Record<string, string | Date>) {
  return {
    id: String(row.id),
    body: String(row.body),
    createdAt: new Date(row.created_at).toISOString(),
    user: {
      id: String(row.user_id),
      firstName: String(row.first_name),
      lastName: String(row.last_name)
    }
  };
}

type InviteRow = {
  id: string;
  code: string;
  label: string | null;
  max_uses: number | null;
  uses: number;
  active: boolean;
  expires_at: Date | null;
  created_at: Date;
};

function inviteFromRow(row: InviteRow) {
  return {
    id: String(row.id),
    code: String(row.code),
    label: row.label ? String(row.label) : null,
    maxUses: row.max_uses === null ? null : Number(row.max_uses),
    uses: Number(row.uses),
    active: Boolean(row.active),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
