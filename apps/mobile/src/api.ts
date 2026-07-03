declare const process: {
  env: {
    EXPO_PUBLIC_API_URL?: string;
  };
};

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

export async function api<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<T>;
}

async function readApiError(response: Response) {
  const fallback = `Request failed with ${response.status}`;
  const text = await response.text();

  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error ?? parsed.message ?? fallback;
  } catch {
    return text;
  }
}
