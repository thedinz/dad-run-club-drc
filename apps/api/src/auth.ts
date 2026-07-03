import type { FastifyReply, FastifyRequest } from "fastify";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "./config.js";
import { pool } from "./db.js";

export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
};

export type AdminSession = {
  role: "admin";
  username: string;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    isAdmin?: boolean;
  }
}

const userSessionVersion = 2;

export function signSession(user: AuthUser) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      email: user.email,
      authVersion: userSessionVersion
    },
    env.jwtSecret,
    { expiresIn: "90d" }
  );
}

export function signAdminSession(username: string) {
  return jwt.sign(
    {
      role: "admin",
      username
    },
    env.jwtSecret,
    { expiresIn: "12h" }
  );
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const token = getBearerToken(request);
  if (!token) {
    return reply.code(401).send({ error: "Authentication required" });
  }

  const user = await getUserFromToken(token);
  if (!user) {
    return reply.code(401).send({ error: "Invalid session" });
  }

  request.user = user;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!isAdminRequest(request)) {
    return reply.code(401).send({ error: "Admin login required" });
  }

  request.isAdmin = true;
}

export async function requireActor(request: FastifyRequest, reply: FastifyReply) {
  if (isAdminRequest(request)) {
    request.isAdmin = true;
    return;
  }

  return requireUser(request, reply);
}

export async function getUserFromToken(token: string): Promise<AuthUser | null> {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    if (!payload.sub || typeof payload.sub !== "string") {
      return null;
    }

    if (payload.authVersion !== userSessionVersion) {
      return null;
    }

    const result = await pool.query(
      `SELECT id, first_name, last_name, username, email
       FROM users
       WHERE id = $1`,
      [payload.sub]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      username: row.username,
      email: row.email
    };
  } catch {
    return null;
  }
}

export function getBearerToken(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length);
}

export function getTokenFromRequest(request: FastifyRequest) {
  const bearer = getBearerToken(request);
  if (bearer) {
    return bearer;
  }

  const query = request.query as { token?: string };
  return typeof query.token === "string" ? query.token : null;
}

export function isAdminRequest(request: FastifyRequest) {
  const headerToken = request.headers["x-admin-token"];
  const bearer = getBearerToken(request);
  if (env.adminToken && (headerToken === env.adminToken || bearer === env.adminToken)) {
    return true;
  }

  if (!bearer) {
    return false;
  }

  return isAdminToken(bearer);
}

export function isAdminToken(token: string) {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    return payload.role === "admin";
  } catch {
    return false;
  }
}
