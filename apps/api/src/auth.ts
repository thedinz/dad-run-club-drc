import type { FastifyReply, FastifyRequest } from "fastify";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "./config.js";
import { pool } from "./db.js";

export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    isAdmin?: boolean;
  }
}

export function signSession(user: AuthUser) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email
    },
    env.jwtSecret,
    { expiresIn: "90d" }
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
    return reply.code(401).send({ error: "Admin token required" });
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

    const result = await pool.query(
      `SELECT id, first_name, last_name, email FROM users WHERE id = $1`,
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

function isAdminRequest(request: FastifyRequest) {
  const headerToken = request.headers["x-admin-token"];
  const bearer = getBearerToken(request);
  return headerToken === env.adminToken || bearer === env.adminToken;
}
