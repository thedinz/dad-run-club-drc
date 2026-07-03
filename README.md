# Dad Run Club DRC

First version of Dad Run Club, a monorepo with:

- `apps/mobile`: Expo iPhone app with Feed, Chat, and Calendar tabs.
- `apps/api`: Fastify API with Postgres, invite-code signup, chat, calendar events, and Instagram feed proxy.
- `apps/web`: Next.js landing page at `/` and admin dashboard at `/admin`.

## What is working

- Landing page shows the Dad Run Club logo at `/`.
- Admin dashboard is available at `/admin`.
- Admin login defaults to `admin/admin` on first boot and can be changed in Settings.
- Admin can create invite codes, manage users, manage media, and manage calendar events.
- Users can sign up in the mobile app with first name, last name, email, and invite code.
- Chat works over Socket.IO after signup and supports text, emoji, pasted text, images, and GIF attachments.
- Chat/media retention is configurable in admin from 30 to 1095 days.
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

## Backend and proxy model

The web app proxies `/api/backend/*` to the API. In Docker, only the web app needs to be public; the API can stay private on the Compose network.

For a future public deployment, point your external reverse proxy at the web container. The mobile app can talk to the same public FQDN by setting:

```bash
EXPO_PUBLIC_API_URL=https://your-drc-domain.example/api/backend
```

You do not need the final FQDN to keep building locally.

## Local setup

Install dependencies:

```bash
pnpm install
```

Run the local source-build Docker stack:

```bash
pnpm docker:up
```

Services:

- Web: `http://localhost:3000`
- Admin: `http://localhost:3000/admin`
- API: `http://localhost:4000`
- Postgres: `localhost:5432`

Default first-run admin login:

```bash
admin/admin
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

The root `docker-compose.yml` is the image-based server Compose file. It uses:

- `ghcr.io/thedinz/dad-run-club-drc-api`
- `ghcr.io/thedinz/dad-run-club-drc-web`

The GitHub Actions workflow builds and pushes those images on pushes to `main`.
The repository and container packages are public, so the server does not need a GitHub or GHCR login to pull them.

One-liner for a new dev server:

```bash
mkdir -p ~/drc && cd ~/drc && curl -fsSLO https://raw.githubusercontent.com/thedinz/dad-run-club-drc/main/docker-compose.yml && printf "POSTGRES_PASSWORD=%s\nJWT_SECRET=%s\nADMIN_USERNAME=admin\nADMIN_PASSWORD=admin\nSEED_INVITE_CODE=DRC-FOUNDERS\nCORS_ORIGIN=*\n" "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > .env && docker compose pull && docker compose up -d
```

Or, if you want to write the files manually, put this next to `docker-compose.yml` as `.env`:

```bash
POSTGRES_PASSWORD=replace-me
JWT_SECRET=replace-with-a-long-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
SEED_INVITE_CODE=DRC-FOUNDERS
CORS_ORIGIN=*
```

Then run:

```bash
docker compose pull
docker compose up -d
```

Expose only the web service through your reverse proxy. The web container forwards `/api/backend` to the API container internally.

For local builds from source, use `docker-compose.dev.yml`:

```bash
docker compose -f docker-compose.dev.yml up --build
```

## Early decisions still needed

- Decide how production auth should work after signup: password, magic link, or Apple/Google sign-in.
- Get the original high-resolution logo file for App Store quality icons.
- Create Meta/Instagram API credentials for real feed sync.
- Decide whether all members can create calendar events or only admins.
- Add production hosting details for the API, web app, database backups, and push notifications.
