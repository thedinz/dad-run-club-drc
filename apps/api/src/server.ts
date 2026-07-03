import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { migrate, normalizeUsername, pool } from "./db.js";
import { fetchInstagramMedia, getInstagramFeed } from "./instagram.js";
import {
  getTokenFromRequest,
  getUserFromToken,
  isAdminToken,
  requireActor,
  requireAdmin,
  requireUser,
  signAdminSession,
  signSession
} from "./auth.js";
import { hashPassword, verifyPassword } from "./security.js";

const mediaRoot = path.resolve(env.mediaStoragePath);
const instagramDemoRoot = fileURLToPath(
  new URL("../assets/instagram-demo/", import.meta.url)
);
const instagramDemoFiles = new Set([
  "pre-run.png",
  "waterfront-run.png",
  "post-run.png"
]);

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/,
    "Username can use letters, numbers, dots, dashes, and underscores"
  );

const memberPasswordSchema = z.string().min(8).max(256);

const registerSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().email(),
  username: usernameSchema,
  password: memberPasswordSchema,
  inviteCode: z.string().trim().min(2)
});

const userLoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

const adminLoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

const userSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().email(),
  username: usernameSchema,
  password: memberPasswordSchema.optional()
});

const attachmentSchema = z.object({
  fileName: z.string().trim().optional().nullable(),
  mimeType: z.string().trim().min(3),
  data: z.string().min(1)
});

const messageSchema = z
  .object({
    body: z.string().max(5000).optional().default(""),
    attachments: z.array(attachmentSchema).max(6).optional().default([])
  })
  .refine(
    (value) => value.body.trim().length > 0 || value.attachments.length > 0,
    "Message text or media is required"
  );

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

const settingsSchema = z.object({
  adminUsername: z.string().trim().min(1).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6).optional(),
  chatRetentionDays: z.number().int().min(30).max(1095).optional()
});

const fastify = Fastify({
  bodyLimit: env.maxUploadBytes * 2,
  trustProxy: true,
  logger: {
    level: env.nodeEnv === "production" ? "info" : "debug"
  }
});

await fastify.register(cors, {
  origin: corsOrigin(),
  credentials: true
});

fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: "Invalid request",
      details: error.issues
    });
  }

  if (
    error instanceof Error &&
    error.message === "Attachment is too large"
  ) {
    return reply.code(400).send({ error: error.message });
  }

  request.log.error(error);
  return reply.code(500).send({ error: "Internal server error" });
});

fastify.get("/health", async () => ({
  ok: true,
  service: "drc-api",
  time: new Date().toISOString()
}));

fastify.post("/auth/register", async (request, reply) => {
  const body = registerSchema.parse(request.body);
  const email = body.email.toLowerCase();
  const username = normalizeUsername(body.username);
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

    const existingUser = await client.query<UserRow>(
      `SELECT id, first_name, last_name, username, email, password_hash, created_at
       FROM users
       WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2)`,
      [email, username]
    );

    if (existingUser.rows[0]) {
      await client.query("ROLLBACK");
      return reply
        .code(409)
        .send({ error: "That email or username is already registered" });
    }

    const userResult = await client.query(
      `INSERT INTO users (id, first_name, last_name, username, email, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, first_name, last_name, username, email, password_hash, created_at`,
      [
        randomUUID(),
        body.firstName,
        body.lastName,
        username,
        email,
        hashPassword(body.password)
      ]
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
      return reply
        .code(409)
        .send({ error: "That email or username is already registered" });
    }

    request.log.error(error);
    return reply.code(500).send({ error: "Could not create account" });
  } finally {
    client.release();
  }
});

fastify.post("/auth/login", async (request, reply) => {
  const body = userLoginSchema.parse(request.body);
  const username = body.username.toLowerCase();

  const result = await pool.query<UserRow>(
    `SELECT id, first_name, last_name, username, email, password_hash, created_at
     FROM users
     WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)`,
    [username]
  );

  if (
    !result.rows[0] ||
    !verifyPassword(body.password, result.rows[0].password_hash)
  ) {
    return reply.code(401).send({ error: "Invalid username or password" });
  }

  const user = userFromRow(result.rows[0]);
  return { token: signSession(user), user };
});

fastify.get("/auth/me", { preHandler: requireUser }, async (request) => ({
  user: request.user
}));

fastify.post("/admin/login", async (request, reply) => {
  const body = adminLoginSchema.parse(request.body);
  const settings = await getAdminSettings();

  if (
    settings.admin_username !== body.username ||
    !verifyPassword(body.password, settings.password_hash)
  ) {
    return reply.code(401).send({ error: "Invalid admin credentials" });
  }

  return {
    token: signAdminSession(settings.admin_username),
    admin: { username: settings.admin_username }
  };
});

fastify.get("/instagram/feed", async () => getInstagramFeed());

fastify.get("/instagram/media", async (request, reply) => {
  const query = request.query as { url?: string };
  if (!query.url) {
    return reply.code(400).send({ error: "Media URL is required" });
  }

  try {
    const media = await fetchInstagramMedia(query.url);
    return reply
      .header("content-type", media.contentType)
      .header("cache-control", "public, max-age=3600")
      .send(media.bytes);
  } catch (error) {
    request.log.warn(error);
    return reply.code(404).send({ error: "Instagram media unavailable" });
  }
});

fastify.get("/instagram/demo/:file", async (request, reply) => {
  const { file } = request.params as { file: string };
  if (!instagramDemoFiles.has(file)) {
    return reply.code(404).send({ error: "Demo image not found" });
  }

  return reply
    .header("content-type", "image/png")
    .header("cache-control", "public, max-age=86400")
    .send(createReadStream(path.join(instagramDemoRoot, file)));
});

fastify.get("/chat/messages", { preHandler: requireUser }, async (request) => {
  const query = request.query as { limit?: string };
  const limit = Math.min(Number(query.limit ?? 50), 100);
  return { messages: await fetchMessages(limit) };
});

fastify.post("/chat/messages", { preHandler: requireUser }, async (request) => {
  const body = messageSchema.parse(request.body);
  const message = await createMessage(
    request.user!.id,
    body.body,
    body.attachments
  );
  io.emit("chat:message", message);
  return { message };
});

fastify.get("/media/:id", async (request, reply) => {
  const token = getTokenFromRequest(request);
  const user = token ? await getUserFromToken(token) : null;
  const admin = token ? isAdminToken(token) : false;

  if (!user && !admin) {
    return reply.code(401).send({ error: "Authentication required" });
  }

  const { id } = request.params as { id: string };
  const result = await pool.query<MediaRow>(
    "SELECT * FROM media_items WHERE id = $1",
    [id]
  );
  const media = result.rows[0];

  if (!media) {
    return reply.code(404).send({ error: "Media not found" });
  }

  reply.header("content-type", media.mime_type);
  reply.header("cache-control", "private, max-age=3600");
  return reply.send(createReadStream(media.storage_path));
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
  const [users, invites, messages, media, events, latestMessages, feed, settings] =
    await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM users"),
      pool.query("SELECT COUNT(*)::int AS count FROM invite_codes WHERE active = TRUE"),
      pool.query("SELECT COUNT(*)::int AS count FROM chat_messages"),
      pool.query("SELECT COUNT(*)::int AS count FROM media_items"),
      pool.query("SELECT COUNT(*)::int AS count FROM calendar_events"),
      fetchMessages(5),
      getInstagramFeed(),
      getAdminSettings()
    ]);

  return {
    counts: {
      users: users.rows[0].count,
      activeInviteCodes: invites.rows[0].count,
      chatMessages: messages.rows[0].count,
      mediaItems: media.rows[0].count,
      calendarEvents: events.rows[0].count
    },
    latestMessages,
    settings: settingsFromRow(settings),
    instagram: {
      source: feed.source,
      username: feed.username,
      profileUrl: feed.profileUrl,
      note: "note" in feed ? feed.note : undefined
    }
  };
});

fastify.get("/admin/settings", { preHandler: requireAdmin }, async () => ({
  settings: settingsFromRow(await getAdminSettings())
}));

fastify.put("/admin/settings", { preHandler: requireAdmin }, async (request, reply) => {
  const body = settingsSchema.parse(request.body);
  const current = await getAdminSettings();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.adminUsername) {
    values.push(body.adminUsername);
    updates.push(`admin_username = $${values.length}`);
  }

  if (body.chatRetentionDays) {
    values.push(body.chatRetentionDays);
    updates.push(`chat_retention_days = $${values.length}`);
  }

  if (body.newPassword) {
    if (
      !body.currentPassword ||
      !verifyPassword(body.currentPassword, current.password_hash)
    ) {
      return reply.code(400).send({ error: "Current password is required" });
    }

    values.push(hashPassword(body.newPassword));
    updates.push(`password_hash = $${values.length}`);
  }

  if (updates.length === 0) {
    return { settings: settingsFromRow(current) };
  }

  values.push("default");
  const result = await pool.query<AdminSettingsRow>(
    `UPDATE admin_settings
     SET ${updates.join(", ")}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );

  return { settings: settingsFromRow(result.rows[0]) };
});

fastify.post(
  "/admin/maintenance/prune-chat",
  { preHandler: requireAdmin },
  async () => pruneExpiredChat()
);

fastify.get("/admin/users", { preHandler: requireAdmin }, async () => {
  const result = await pool.query<UserRow>(
    `SELECT users.*,
            COUNT(DISTINCT chat_messages.id)::int AS message_count,
            COUNT(DISTINCT media_items.id)::int AS media_count
     FROM users
     LEFT JOIN chat_messages ON chat_messages.user_id = users.id
     LEFT JOIN media_items ON media_items.user_id = users.id
     GROUP BY users.id
     ORDER BY users.created_at DESC`
  );

  return { users: result.rows.map(userFromRow) };
});

fastify.post("/admin/users", { preHandler: requireAdmin }, async (request, reply) => {
  const body = userSchema.parse(request.body);
  if (!body.password) {
    return reply.code(400).send({ error: "Password is required" });
  }

  try {
    const result = await pool.query<UserRow>(
      `INSERT INTO users
        (id, first_name, last_name, username, email, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        randomUUID(),
        body.firstName,
        body.lastName,
        normalizeUsername(body.username),
        body.email.toLowerCase(),
        hashPassword(body.password)
      ]
    );

    return { user: userFromRow(result.rows[0]) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return reply
        .code(409)
        .send({ error: "That email or username is already registered" });
    }
    throw error;
  }
});

fastify.put(
  "/admin/users/:id",
  { preHandler: requireAdmin },
  async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = userSchema.parse(request.body);
    const values: unknown[] = [
      id,
      body.firstName,
      body.lastName,
      normalizeUsername(body.username),
      body.email.toLowerCase()
    ];

    if (body.password) {
      values.push(hashPassword(body.password));
    }

    try {
      const result = await pool.query<UserRow>(
        `UPDATE users
         SET first_name = $2,
             last_name = $3,
             username = $4,
             email = $5${body.password ? `, password_hash = $6` : ""}
         WHERE id = $1
         RETURNING *`,
        values
      );

      if (result.rowCount === 0) {
        return reply.code(404).send({ error: "User not found" });
      }

      return { user: userFromRow(result.rows[0]) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply
          .code(409)
          .send({ error: "That email or username is already registered" });
      }

      throw error;
    }
  }
);

fastify.delete(
  "/admin/users/:id",
  { preHandler: requireAdmin },
  async (request, reply) => {
    const { id } = request.params as { id: string };
    const files = await pool.query<{ storage_path: string }>(
      `SELECT media_items.storage_path
       FROM media_items
       LEFT JOIN chat_messages ON chat_messages.id = media_items.chat_message_id
       WHERE media_items.user_id = $1 OR chat_messages.user_id = $1`,
      [id]
    );

    await Promise.all(files.rows.map((file) => safeUnlink(file.storage_path)));
    const result = await pool.query("DELETE FROM users WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: "User not found" });
    }

    return { ok: true };
  }
);

fastify.get("/admin/invite-codes", { preHandler: requireAdmin }, async () => {
  const result = await pool.query<InviteRow>(
    `SELECT * FROM invite_codes ORDER BY created_at DESC`
  );

  return {
    inviteCodes: result.rows.map(inviteFromRow)
  };
});

fastify.post("/admin/invite-codes", { preHandler: requireAdmin }, async (request) => {
  const body = inviteSchema.parse(request.body);
  const result = await pool.query<InviteRow>(
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
    const result = await pool.query<InviteRow>(
      "UPDATE invite_codes SET active = FALSE WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: "Invite code not found" });
    }

    return { inviteCode: inviteFromRow(result.rows[0]) };
  }
);

fastify.get("/admin/media", { preHandler: requireAdmin }, async () => ({
  media: await fetchMediaItems(100)
}));

fastify.delete(
  "/admin/media/:id",
  { preHandler: requireAdmin },
  async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await pool.query<MediaRow>(
      "DELETE FROM media_items WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: "Media not found" });
    }

    await safeUnlink(result.rows[0].storage_path);
    return { ok: true };
  }
);

const io = new SocketIOServer(fastify.server, {
  maxHttpBufferSize: env.maxUploadBytes * 2,
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
    const message = await createMessage(
      socket.data.user.id,
      body.body,
      body.attachments
    );
    io.emit("chat:message", message);
  });
});

await migrate();
await mkdir(mediaRoot, { recursive: true });
await pruneExpiredChat();
setInterval(() => {
  void pruneExpiredChat().catch((error) => fastify.log.error(error));
}, 24 * 60 * 60 * 1000).unref();
await fastify.listen({ port: env.port, host: "0.0.0.0" });

async function fetchMessages(limit: number) {
  const messages = await pool.query(
    `SELECT chat_messages.id, chat_messages.body, chat_messages.created_at,
            users.id AS user_id, users.first_name, users.last_name,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', media_items.id,
                  'originalName', media_items.original_name,
                  'mimeType', media_items.mime_type,
                  'sizeBytes', media_items.size_bytes,
                  'url', '/media/' || media_items.id,
                  'createdAt', media_items.created_at
                )
              ) FILTER (WHERE media_items.id IS NOT NULL),
              '[]'
            ) AS media
     FROM chat_messages
     JOIN users ON users.id = chat_messages.user_id
     LEFT JOIN media_items ON media_items.chat_message_id = chat_messages.id
     GROUP BY chat_messages.id, users.id
     ORDER BY chat_messages.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return messages.rows.reverse().map(messageFromRow);
}

async function createMessage(
  userId: string,
  body: string,
  attachments: z.infer<typeof attachmentSchema>[] = []
) {
  const client = await pool.connect();
  const writtenFiles: string[] = [];

  try {
    await client.query("BEGIN");
    const messageId = randomUUID();
    const messageResult = await client.query(
      `INSERT INTO chat_messages (id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [messageId, userId, body]
    );

    const media: NonNullable<MessageRow["media"]> = [];
    for (const attachment of attachments) {
      const stored = await persistAttachment(attachment);
      writtenFiles.push(stored.storagePath);
      await client.query(
        `INSERT INTO media_items
          (id, user_id, chat_message_id, original_name, mime_type, size_bytes, storage_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          stored.id,
          userId,
          messageId,
          stored.originalName,
          stored.mimeType,
          stored.sizeBytes,
          stored.storagePath
        ]
      );
      media.push({
        id: stored.id,
        originalName: stored.originalName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        url: `/media/${stored.id}`,
        createdAt: new Date().toISOString()
      });
    }

    const user = await client.query(
      "SELECT id, first_name, last_name FROM users WHERE id = $1",
      [userId]
    );

    await client.query("COMMIT");

    return messageFromRow({
      ...messageResult.rows[0],
      user_id: user.rows[0].id,
      first_name: user.rows[0].first_name,
      last_name: user.rows[0].last_name,
      media
    });
  } catch (error) {
    await client.query("ROLLBACK");
    await Promise.all(writtenFiles.map(safeUnlink));
    throw error;
  } finally {
    client.release();
  }
}

async function persistAttachment(attachment: z.infer<typeof attachmentSchema>) {
  const id = randomUUID();
  const base64 = attachment.data.includes(",")
    ? attachment.data.slice(attachment.data.indexOf(",") + 1)
    : attachment.data;
  const buffer = Buffer.from(base64, "base64");

  if (buffer.length > env.maxUploadBytes) {
    throw new Error("Attachment is too large");
  }

  const mimeType = attachment.mimeType;
  const extension = extensionForMime(mimeType, attachment.fileName ?? "");
  const storagePath = path.join(mediaRoot, `${id}${extension}`);
  await mkdir(mediaRoot, { recursive: true });
  await writeFile(storagePath, buffer);

  return {
    id,
    originalName: attachment.fileName?.slice(0, 180) ?? null,
    mimeType,
    sizeBytes: buffer.length,
    storagePath
  };
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

async function getAdminSettings() {
  const result = await pool.query<AdminSettingsRow>(
    "SELECT * FROM admin_settings WHERE id = 'default'"
  );
  return result.rows[0];
}

async function pruneExpiredChat() {
  const settings = await getAdminSettings();
  const cutoff = new Date(
    Date.now() - settings.chat_retention_days * 24 * 60 * 60 * 1000
  );
  const files = await pool.query<{ storage_path: string }>(
    `SELECT media_items.storage_path
     FROM media_items
     JOIN chat_messages ON chat_messages.id = media_items.chat_message_id
     WHERE chat_messages.created_at < $1`,
    [cutoff]
  );

  await Promise.all(files.rows.map((file) => safeUnlink(file.storage_path)));
  const deleted = await pool.query(
    "DELETE FROM chat_messages WHERE created_at < $1",
    [cutoff]
  );

  return {
    ok: true,
    retentionDays: settings.chat_retention_days,
    deletedMessages: deleted.rowCount ?? 0,
    deletedMediaFiles: files.rowCount ?? 0
  };
}

async function fetchMediaItems(limit: number) {
  const result = await pool.query(
    `SELECT media_items.*,
            users.first_name,
            users.last_name,
            chat_messages.body AS message_body
     FROM media_items
     LEFT JOIN users ON users.id = media_items.user_id
     LEFT JOIN chat_messages ON chat_messages.id = media_items.chat_message_id
     ORDER BY media_items.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map(mediaFromRow);
}

async function safeUnlink(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }

    throw error;
  }
}

function userFromRow(row: UserRow) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username,
    email: row.email,
    passwordSet: Boolean(row.password_hash),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    messageCount:
      row.message_count === undefined ? undefined : Number(row.message_count),
    mediaCount: row.media_count === undefined ? undefined : Number(row.media_count)
  };
}

function messageFromRow(row: MessageRow) {
  const media = Array.isArray(row.media) ? row.media : [];
  return {
    id: String(row.id),
    body: String(row.body ?? ""),
    createdAt: new Date(row.created_at).toISOString(),
    user: {
      id: String(row.user_id),
      firstName: String(row.first_name),
      lastName: String(row.last_name)
    },
    media
  };
}

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

function mediaFromRow(
  row: MediaRow & {
    first_name?: string | null;
    last_name?: string | null;
    message_body?: string | null;
  }
) {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    url: `/media/${row.id}`,
    createdAt: new Date(row.created_at).toISOString(),
    user:
      row.first_name || row.last_name
        ? {
            firstName: String(row.first_name ?? ""),
            lastName: String(row.last_name ?? "")
          }
        : null,
    messageBody: row.message_body ? String(row.message_body) : null
  };
}

function settingsFromRow(row: AdminSettingsRow) {
  return {
    adminUsername: row.admin_username,
    chatRetentionDays: row.chat_retention_days,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function extensionForMime(mimeType: string, fileName: string) {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName && fromName.length <= 10) {
    return fromName;
  }

  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "application/pdf": ".pdf",
    "text/plain": ".txt"
  };

  return map[mimeType] ?? ".bin";
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

type UserRow = {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  password_hash: string;
  created_at?: Date;
  message_count?: number;
  media_count?: number;
};

type MessageRow = {
  id: string;
  body: string;
  created_at: Date;
  user_id: string;
  first_name: string;
  last_name: string;
  media?: Array<{
    id: string;
    originalName: string | null;
    mimeType: string;
    sizeBytes: number;
    url: string;
    createdAt: string;
  }>;
};

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

type MediaRow = {
  id: string;
  user_id: string | null;
  chat_message_id: string | null;
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: Date;
};

type AdminSettingsRow = {
  id: string;
  admin_username: string;
  password_hash: string;
  chat_retention_days: number;
  updated_at: Date;
};
