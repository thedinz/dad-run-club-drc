# Dad Run Club DRC

First version of Dad Run Club, a monorepo with:

- `apps/mobile`: Expo iPhone app with Feed, Chat, and Calendar tabs.
- `apps/api`: Fastify API with Postgres, invite-code signup, chat, calendar events, and Instagram feed proxy.
- `apps/web`: Next.js landing page at `/` and admin dashboard at `/admin`.

## What is working

- Landing page shows the Dad Run Club logo at `/`.
- Admin dashboard is available at `/admin`.
- Admin can create invite codes and manage calendar events.
- Users can sign up in the mobile app with first name, last name, email, and invite code.
- Chat works over Socket.IO after signup.
- Calendar supports one-time, daily, weekly, and monthly events.
- Recurring calendar events can be deleted as one occurrence or as the full series.
- The mobile app has monthly and list calendar views.
- Docker Compose runs Postgres, API, and web.

## Instagram feed

The app uses the public Instagram profile:

`https://www.instagram.com/dadrunclubplymouth/`

The profile image from Instagram is committed as the first logo asset. Instagram does not provide a reliable unauthenticated API for public feed scraping, so the API starts in mock mode. To switch to real posts, add Meta/Instagram API credentials:

```bash
INSTAGRAM_ACCESS_TOKEN=...
INSTAGRAM_USER_ID=...
INSTAGRAM_GRAPH_BASE_URL=https://graph.facebook.com/v20.0
```

Then restart the API. The mobile app and admin dashboard already call `/instagram/feed`.

## Local setup

Install dependencies:

```bash
pnpm install
```

Run the Docker stack:

```bash
pnpm docker:up
```

Services:

- Web: `http://localhost:3000`
- Admin: `http://localhost:3000/admin`
- API: `http://localhost:4000`
- Postgres: `localhost:5432`

Default local admin token:

```bash
local-admin-token-change-me
```

Default seeded invite code:

```bash
DRC-FOUNDERS
```

## iPhone preview and testing

This project uses Expo.

Preview on a real iPhone:

1. Install Expo Go from the App Store.
2. Run:

```bash
pnpm mobile
```

3. Scan the QR code.
4. If using a physical phone, set `EXPO_PUBLIC_API_URL` to your Mac's LAN address instead of `localhost`, for example:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.25:4000 pnpm mobile
```

Preview in Apple's iPhone simulator:

1. Install full Xcode from the Mac App Store.
2. Open Xcode once so it installs simulator components.
3. Run:

```bash
pnpm mobile:ios
```

Right now this Mac only has Xcode Command Line Tools, so `xcodebuild` and `simctl` cannot run the iPhone simulator yet.

## Development commands

```bash
pnpm dev:api
pnpm dev:web
pnpm mobile
pnpm typecheck
pnpm build
```

## Docker image deployment path

The Compose file includes image names:

- `ghcr.io/thedinz/dad-run-club-drc-api`
- `ghcr.io/thedinz/dad-run-club-drc-web`

The GitHub Actions workflow builds and pushes those images on pushes to `main`. A server can later run a Compose file that references those GHCR images directly.

## Early decisions still needed

- Decide how production auth should work after signup: password, magic link, or Apple/Google sign-in.
- Get the original high-resolution logo file for App Store quality icons.
- Create Meta/Instagram API credentials for real feed sync.
- Decide whether all members can create calendar events or only admins.
- Add production hosting details for the API, web app, database backups, and push notifications.
