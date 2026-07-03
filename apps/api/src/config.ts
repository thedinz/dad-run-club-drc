import "dotenv/config";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://drc:drc@localhost:5432/drc",
  jwtSecret:
    process.env.JWT_SECRET ?? "local-dev-jwt-secret-change-before-launch",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin",
  adminToken: process.env.ADMIN_TOKEN ?? "",
  seedInviteCode: process.env.SEED_INVITE_CODE ?? "DRC-FOUNDERS",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  mediaStoragePath: process.env.MEDIA_STORAGE_PATH ?? "./storage/media",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
  instagramUsername: process.env.INSTAGRAM_USERNAME ?? "dadrunclubplymouth",
  instagramFeedMode: process.env.INSTAGRAM_FEED_MODE ?? "auto",
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
