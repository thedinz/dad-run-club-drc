import "dotenv/config";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://drc:drc@localhost:5432/drc",
  jwtSecret:
    process.env.JWT_SECRET ?? "local-dev-jwt-secret-change-before-launch",
  adminToken: process.env.ADMIN_TOKEN ?? "local-admin-token-change-me",
  seedInviteCode: process.env.SEED_INVITE_CODE ?? "DRC-FOUNDERS",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  instagramUsername: process.env.INSTAGRAM_USERNAME ?? "dadrunclubplymouth",
  instagramAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN ?? "",
  instagramUserId: process.env.INSTAGRAM_USER_ID ?? "",
  instagramGraphBaseUrl:
    process.env.INSTAGRAM_GRAPH_BASE_URL ??
    "https://graph.facebook.com/v20.0"
};

export function corsOrigin() {
  if (env.corsOrigin === "*") {
    return true;
  }

  return env.corsOrigin.split(",").map((origin) => origin.trim());
}
