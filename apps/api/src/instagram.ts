import { env } from "./config.js";
import { pool } from "./db.js";

export type InstagramPost = {
  id: string;
  caption: string;
  imageUrl: string | null;
  permalink: string;
  mediaType: string;
  timestamp: string;
};

type FeedResponse = {
  source: string;
  username: string;
  profileUrl: string;
  note?: string;
  posts: InstagramPost[];
};

export type InstagramSettings = {
  username: string;
  feedMode: "auto" | "demo" | "api" | "public";
  accessToken: string;
  userId: string;
  graphBaseUrl: string;
};

export type InstagramDiagnostics = {
  status: "unknown" | "ok" | "error";
  checkedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  mode: InstagramSettings["feedMode"] | null;
  source: string | null;
  statusCode: number | null;
  error: string | null;
};

type PublicInstagramResponse = {
  data?: {
    user?: {
      username?: string;
      edge_owner_to_timeline_media?: {
        edges?: Array<{
          node?: {
            id?: string;
            shortcode?: string;
            display_url?: string;
            thumbnail_src?: string;
            is_video?: boolean;
            __typename?: string;
            taken_at_timestamp?: number;
            edge_media_to_caption?: {
              edges?: Array<{
                node?: {
                  text?: string;
                };
              }>;
            };
          };
        }>;
      };
    };
  };
};

const INSTAGRAM_WEB_APP_ID = "936619743392459";
const PUBLIC_FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
};
const CACHE_MS = 30 * 60 * 1000;
const ERROR_CACHE_MS = 60 * 60 * 1000;
let cachedFeed: {
  expiresAt: number;
  settingsKey: string;
  value: FeedResponse;
} | null = null;
let diagnostics: InstagramDiagnostics = {
  status: "unknown",
  checkedAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  mode: null,
  source: null,
  statusCode: null,
  error: null
};

export async function getInstagramFeed() {
  const settings = await getInstagramSettings();
  const settingsKey = instagramSettingsKey(settings);

  if (
    cachedFeed &&
    cachedFeed.settingsKey === settingsKey &&
    cachedFeed.expiresAt > Date.now()
  ) {
    return cachedFeed.value;
  }

  try {
    const feed = await loadInstagramFeed(settings);
    recordInstagramSuccess(settings, feed);
    cachedFeed = {
      expiresAt: Date.now() + CACHE_MS,
      settingsKey,
      value: feed
    };
    await savePersistedFeed(settings, feed).catch(() => undefined);

    return feed;
  } catch (error) {
    recordInstagramError(settings, error);
    const unavailableNote = feedUnavailableNote(error);
    const fallback = await loadPersistedFeed(settings, unavailableNote).catch(
      () => null
    );
    const feed =
      fallback ??
      (shouldUseDemoFallback(settings)
        ? mockFeed(settings, unavailableNote)
        : unavailableFeed(settings, unavailableNote));

    cachedFeed = {
      expiresAt: Date.now() + ERROR_CACHE_MS,
      settingsKey,
      value: feed
    };

    return feed;
  }
}

export function clearInstagramFeedCache() {
  cachedFeed = null;
}

export function getInstagramDiagnostics() {
  return diagnostics;
}

async function loadInstagramFeed(settings: InstagramSettings): Promise<FeedResponse> {
  if (settings.feedMode === "demo") {
    return mockFeed(
      settings,
      "Showing demo feed photos for app testing. Switch INSTAGRAM_FEED_MODE back to auto when Instagram API access is ready."
    );
  }

  if (
    settings.feedMode === "api" ||
    (settings.feedMode === "auto" && settings.accessToken && settings.userId)
  ) {
    return getOfficialApiFeed(settings);
  }

  return getPublicProfileFeed(settings);
}

async function getOfficialApiFeed(
  settings: InstagramSettings
): Promise<FeedResponse> {
  if (!settings.accessToken || !settings.userId) {
    throw new Error("Instagram API credentials are missing");
  }

  const fields =
    "id,caption,media_url,permalink,thumbnail_url,timestamp,media_type";
  const url = new URL(`${settings.graphBaseUrl}/${settings.userId}/media`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", settings.accessToken);
  url.searchParams.set("limit", "12");

  const response = await fetch(url);
  if (!response.ok) {
    throw new InstagramFetchError("Instagram API", response.status);
  }

  const payload = (await response.json()) as {
    data?: Array<Record<string, string>>;
  };

  return {
    source: "instagram-api",
    username: settings.username,
    profileUrl: profileUrl(settings.username),
    posts: (payload.data ?? []).map((post) => ({
      id: post.id,
      caption: post.caption ?? "",
      imageUrl: proxiedInstagramImageUrl(
        post.media_url ?? post.thumbnail_url ?? null
      ),
      permalink:
        post.permalink ?? profileUrl(settings.username),
      mediaType: post.media_type ?? "IMAGE",
      timestamp: post.timestamp ?? new Date().toISOString()
    }))
  };
}

async function getPublicProfileFeed(
  settings: InstagramSettings
): Promise<FeedResponse> {
  const instagramProfileUrl = profileUrl(settings.username);
  const profileResponse = await fetch(instagramProfileUrl, {
    headers: PUBLIC_FETCH_HEADERS
  });

  if (!profileResponse.ok) {
    throw new InstagramFetchError("Instagram profile", profileResponse.status);
  }

  const setCookies = getSetCookies(profileResponse.headers);
  const cookieHeader = cookieHeaderFrom(setCookies);
  const csrfToken = setCookies
    .map((cookie) => cookie.match(/csrftoken=([^;]+)/)?.[1])
    .find(Boolean);

  const infoUrl = new URL(
    "https://www.instagram.com/api/v1/users/web_profile_info/"
  );
  infoUrl.searchParams.set("username", settings.username);

  const infoResponse = await fetch(infoUrl, {
    headers: {
      accept: "application/json",
      "accept-language": "en-US,en;q=0.9",
      referer: instagramProfileUrl,
      "user-agent": PUBLIC_FETCH_HEADERS["user-agent"],
      "x-ig-app-id": INSTAGRAM_WEB_APP_ID,
      "x-requested-with": "XMLHttpRequest",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(csrfToken ? { "x-csrftoken": csrfToken } : {})
    }
  });

  if (!infoResponse.ok) {
    throw new InstagramFetchError(
      "Instagram profile info",
      infoResponse.status
    );
  }

  const payload = (await infoResponse.json()) as PublicInstagramResponse;
  const user = payload.data?.user;
  const edges = user?.edge_owner_to_timeline_media?.edges ?? [];
  const posts = edges.flatMap((edge): InstagramPost[] => {
    const node = edge.node;
    if (!node?.id || !node.shortcode) {
      return [];
    }

    return [
      {
        id: node.id,
        caption: node.edge_media_to_caption?.edges?.[0]?.node?.text ?? "",
        imageUrl: proxiedInstagramImageUrl(
          node.display_url ?? node.thumbnail_src ?? null
        ),
        permalink: `https://www.instagram.com/p/${node.shortcode}/`,
        mediaType: node.is_video ? "VIDEO" : node.__typename ?? "IMAGE",
        timestamp: new Date(
          (node.taken_at_timestamp ?? Date.now() / 1000) * 1000
        ).toISOString()
      }
    ];
  });

  if (posts.length === 0) {
    throw new Error("no public posts returned");
  }

  return {
    source: "instagram-public",
    username: user?.username ?? settings.username,
    profileUrl: instagramProfileUrl,
    posts
  };
}

function getSetCookies(headers: Headers) {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };

  return withGetSetCookie.getSetCookie?.() ?? [];
}

function cookieHeaderFrom(setCookies: string[]) {
  return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function proxiedInstagramImageUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }

  return `/instagram/media?url=${encodeURIComponent(url)}`;
}

async function savePersistedFeed(settings: InstagramSettings, feed: FeedResponse) {
  if (!feed.posts.length || feed.source === "demo") {
    return;
  }

  await pool.query(
    `INSERT INTO instagram_feed_cache (username, payload, fetched_at, updated_at)
     VALUES ($1, $2::jsonb, NOW(), NOW())
     ON CONFLICT (username)
     DO UPDATE SET payload = EXCLUDED.payload,
                   fetched_at = EXCLUDED.fetched_at,
                   updated_at = NOW()`,
    [settings.username, JSON.stringify(feed)]
  );
}

async function loadPersistedFeed(settings: InstagramSettings, note: string) {
  const result = await pool.query<{
    payload: FeedResponse | string;
    fetched_at: Date;
  }>(
    `SELECT payload, fetched_at
     FROM instagram_feed_cache
     WHERE username = $1`,
    [settings.username]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const payload =
    typeof row.payload === "string"
      ? (JSON.parse(row.payload) as FeedResponse)
      : row.payload;

  return {
    ...payload,
    source: `${payload.source}-stale`,
    note: `${note} Showing the last saved feed from ${formatCacheDate(
      row.fetched_at
    )}.`
  };
}

function formatCacheDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York"
  }).format(value);
}

export async function fetchInstagramMedia(url: string) {
  if (!isAllowedInstagramMediaUrl(url)) {
    throw new Error("Unsupported Instagram media URL");
  }

  const settings = await getInstagramSettings();
  const response = await fetch(url, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: profileUrl(settings.username),
      "user-agent": PUBLIC_FETCH_HEADERS["user-agent"]
    }
  });

  if (!response.ok) {
    throw new InstagramFetchError("Instagram media", response.status);
  }

  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Unsupported Instagram media type: ${contentType}`);
  }

  return {
    contentType,
    bytes: Buffer.from(await response.arrayBuffer())
  };
}

function isAllowedInstagramMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname.endsWith(".cdninstagram.com") ||
        url.hostname.endsWith(".fbcdn.net"))
    );
  } catch {
    return false;
  }
}

export async function getInstagramSettings(): Promise<InstagramSettings> {
  const result = await pool.query<{
    instagram_username: string | null;
    instagram_feed_mode: string | null;
    instagram_access_token: string | null;
    instagram_user_id: string | null;
    instagram_graph_base_url: string | null;
  }>(
    `SELECT instagram_username,
            instagram_feed_mode,
            instagram_access_token,
            instagram_user_id,
            instagram_graph_base_url
     FROM admin_settings
     WHERE id = 'default'`
  );

  const row = result.rows[0];
  const feedMode = normalizedFeedMode(
    row?.instagram_feed_mode ?? env.instagramFeedMode
  );

  return {
    username: normalizeInstagramUsername(
      row?.instagram_username ?? env.instagramUsername
    ),
    feedMode,
    accessToken: row?.instagram_access_token ?? env.instagramAccessToken,
    userId: row?.instagram_user_id ?? env.instagramUserId,
    graphBaseUrl:
      row?.instagram_graph_base_url ??
      env.instagramGraphBaseUrl ??
      "https://graph.facebook.com/v20.0"
  };
}

function instagramSettingsKey(settings: InstagramSettings) {
  return [
    settings.username,
    settings.feedMode,
    settings.userId,
    settings.graphBaseUrl,
    settings.accessToken ? "token-set" : "token-empty"
  ].join("|");
}

export function normalizeInstagramUsername(value: string) {
  return value.trim().replace(/^@/, "").replace(/\/+$/, "") || env.instagramUsername;
}

function normalizedFeedMode(value: string): InstagramSettings["feedMode"] {
  return value === "demo" || value === "api" || value === "public"
    ? value
    : "auto";
}

function profileUrl(username: string) {
  return `https://www.instagram.com/${username}/`;
}

function shouldUseDemoFallback(settings: InstagramSettings) {
  return settings.feedMode === "auto";
}

class InstagramFetchError extends Error {
  constructor(
    public target: string,
    public statusCode: number
  ) {
    super(`${target} returned HTTP ${statusCode}`);
  }
}

function feedUnavailableNote(error: unknown) {
  const { statusCode } = instagramErrorInfo(error);

  if (statusCode === 429) {
    return "Instagram returned HTTP 429 for the public feed, which means this server is being rate-limited. Tap the profile button to open the live feed on Instagram.";
  }

  if (statusCode === 404) {
    return "Instagram returned HTTP 404 for this profile. Check the Instagram username in admin settings.";
  }

  if (statusCode === 401 || statusCode === 403) {
    return "Instagram rejected the configured API credentials. Check the access token and user ID in admin settings.";
  }

  if (statusCode) {
    return `Instagram returned HTTP ${statusCode} while loading the feed. Check admin diagnostics for the exact source.`;
  }

  return "Instagram feed could not be loaded. Check admin diagnostics for the exact error.";
}

function recordInstagramSuccess(
  settings: InstagramSettings,
  feed: FeedResponse
) {
  const now = new Date().toISOString();
  diagnostics = {
    ...diagnostics,
    status: "ok",
    checkedAt: now,
    lastSuccessAt: now,
    mode: settings.feedMode,
    source: feed.source,
    statusCode: null,
    error: null
  };
}

function recordInstagramError(settings: InstagramSettings, error: unknown) {
  const now = new Date().toISOString();
  const info = instagramErrorInfo(error);
  diagnostics = {
    ...diagnostics,
    status: "error",
    checkedAt: now,
    lastErrorAt: now,
    mode: settings.feedMode,
    statusCode: info.statusCode,
    error: info.message
  };
}

function instagramErrorInfo(error: unknown) {
  if (error instanceof InstagramFetchError) {
    return {
      statusCode: error.statusCode,
      message: error.message
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/(?:HTTP|returned)\s+(\d{3})/i);

  return {
    statusCode: statusMatch ? Number(statusMatch[1]) : null,
    message
  };
}

function mockFeed(settings: InstagramSettings, note: string) {
  const now = new Date();

  const posts: InstagramPost[] = [
    {
      id: "demo-pre-run",
      caption:
        "Saturday mornings at 8am. Meet at Vela Juice Bar and bring whatever pace you have that day.",
      imageUrl: "/instagram/demo/pre-run.png",
      permalink: profileUrl(settings.username),
      mediaType: "IMAGE",
      timestamp: now.toISOString()
    },
    {
      id: "demo-waterfront-run",
      caption:
        "Easy miles, stroller miles, comeback miles. The point is showing up together.",
      imageUrl: "/instagram/demo/waterfront-run.png",
      permalink: profileUrl(settings.username),
      mediaType: "IMAGE",
      timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: "demo-post-run",
      caption:
        "Post-run smoothies, coffee, and a few minutes where nobody is asking you to find their shoes.",
      imageUrl: "/instagram/demo/post-run.png",
      permalink: profileUrl(settings.username),
      mediaType: "IMAGE",
      timestamp: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
    }
  ];

  return {
    source: "demo",
    username: settings.username,
    profileUrl: profileUrl(settings.username),
    note,
    posts
  };
}

function unavailableFeed(settings: InstagramSettings, note: string): FeedResponse {
  return {
    source: "instagram-unavailable",
    username: settings.username,
    profileUrl: profileUrl(settings.username),
    note,
    posts: []
  };
}
