import { env } from "./config.js";

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
const INSTAGRAM_PROFILE_URL = `https://www.instagram.com/${env.instagramUsername}/`;
const PUBLIC_FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
};
const CACHE_MS = 5 * 60 * 1000;
let cachedFeed: { expiresAt: number; value: FeedResponse } | null = null;

export async function getInstagramFeed() {
  if (cachedFeed && cachedFeed.expiresAt > Date.now()) {
    return cachedFeed.value;
  }

  const feed = await loadInstagramFeed();
  cachedFeed = {
    expiresAt: Date.now() + CACHE_MS,
    value: feed
  };

  return feed;
}

async function loadInstagramFeed(): Promise<FeedResponse> {
  if (env.instagramAccessToken && env.instagramUserId) {
    try {
      const fields =
        "id,caption,media_url,permalink,thumbnail_url,timestamp,media_type";
      const url = new URL(
        `${env.instagramGraphBaseUrl}/${env.instagramUserId}/media`
      );
      url.searchParams.set("fields", fields);
      url.searchParams.set("access_token", env.instagramAccessToken);
      url.searchParams.set("limit", "12");

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Instagram API returned ${response.status}`);
      }

      const payload = (await response.json()) as {
        data?: Array<Record<string, string>>;
      };

      return {
        source: "instagram-api",
        username: env.instagramUsername,
        profileUrl: `https://www.instagram.com/${env.instagramUsername}/`,
        posts: (payload.data ?? []).map((post) => ({
          id: post.id,
          caption: post.caption ?? "",
          imageUrl: proxiedInstagramImageUrl(
            post.media_url ?? post.thumbnail_url ?? null
          ),
          permalink:
            post.permalink ?? `https://www.instagram.com/${env.instagramUsername}/`,
          mediaType: post.media_type ?? "IMAGE",
          timestamp: post.timestamp ?? new Date().toISOString()
        }))
      };
    } catch (error) {
      return mockFeed(`Instagram API is configured but failed: ${String(error)}`);
    }
  }

  try {
    return await getPublicProfileFeed();
  } catch (error) {
    return mockFeed(
      `Instagram public feed is temporarily unavailable: ${String(error)}`
    );
  }
}

async function getPublicProfileFeed(): Promise<FeedResponse> {
  const profileResponse = await fetch(INSTAGRAM_PROFILE_URL, {
    headers: PUBLIC_FETCH_HEADERS
  });

  if (!profileResponse.ok) {
    throw new Error(`profile returned ${profileResponse.status}`);
  }

  const setCookies = getSetCookies(profileResponse.headers);
  const cookieHeader = cookieHeaderFrom(setCookies);
  const csrfToken = setCookies
    .map((cookie) => cookie.match(/csrftoken=([^;]+)/)?.[1])
    .find(Boolean);

  const infoUrl = new URL(
    "https://www.instagram.com/api/v1/users/web_profile_info/"
  );
  infoUrl.searchParams.set("username", env.instagramUsername);

  const infoResponse = await fetch(infoUrl, {
    headers: {
      accept: "application/json",
      "accept-language": "en-US,en;q=0.9",
      referer: INSTAGRAM_PROFILE_URL,
      "user-agent": PUBLIC_FETCH_HEADERS["user-agent"],
      "x-ig-app-id": INSTAGRAM_WEB_APP_ID,
      "x-requested-with": "XMLHttpRequest",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(csrfToken ? { "x-csrftoken": csrfToken } : {})
    }
  });

  if (!infoResponse.ok) {
    throw new Error(`profile info returned ${infoResponse.status}`);
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
    username: user?.username ?? env.instagramUsername,
    profileUrl: INSTAGRAM_PROFILE_URL,
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

export async function fetchInstagramMedia(url: string) {
  if (!isAllowedInstagramMediaUrl(url)) {
    throw new Error("Unsupported Instagram media URL");
  }

  const response = await fetch(url, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: INSTAGRAM_PROFILE_URL,
      "user-agent": PUBLIC_FETCH_HEADERS["user-agent"]
    }
  });

  if (!response.ok) {
    throw new Error(`Instagram media returned ${response.status}`);
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

function mockFeed(note: string) {
  const now = new Date();

  const posts: InstagramPost[] = [
    {
      id: "mock-saturday",
      caption:
        "Saturday mornings at 8am. Meet at Vela Juice Bar and bring whatever pace you have that day.",
      imageUrl: null,
      permalink: `https://www.instagram.com/${env.instagramUsername}/`,
      mediaType: "IMAGE",
      timestamp: now.toISOString()
    },
    {
      id: "mock-common-dad",
      caption:
        "Dad Run Club Plymouth is getting the crew together for easy miles, coffee, and community.",
      imageUrl: null,
      permalink: `https://www.instagram.com/${env.instagramUsername}/`,
      mediaType: "IMAGE",
      timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: "mock-welcome",
      caption:
        "New runners, stroller runners, and comeback runners are welcome. The group starts together and nobody has to prove anything.",
      imageUrl: null,
      permalink: `https://www.instagram.com/${env.instagramUsername}/`,
      mediaType: "IMAGE",
      timestamp: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
    }
  ];

  return {
    source: "mock",
    username: env.instagramUsername,
    profileUrl: `https://www.instagram.com/${env.instagramUsername}/`,
    note,
    posts
  };
}
