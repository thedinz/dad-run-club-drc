import { env } from "./config.js";

export type InstagramPost = {
  id: string;
  caption: string;
  imageUrl: string | null;
  permalink: string;
  mediaType: string;
  timestamp: string;
};

export async function getInstagramFeed() {
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
          imageUrl: post.media_url ?? post.thumbnail_url ?? null,
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

  return mockFeed("Instagram API credentials are not configured yet.");
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
