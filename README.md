# Dad Run Club DRC

First version of Dad Run Club, a monorepo with:

- `apps/mobile`: Expo iPhone app with Feed, Chat, and Calendar tabs.
- `apps/api`: Fastify API with Postgres, invite-code signup, password login, chat, calendar events, and Instagram feed proxy.
- `apps/web`: Next.js landing page at `/` and admin dashboard at `/admin`.

## What is working

- Landing page shows the Dad Run Club logo at `/`.
- Admin dashboard is available at `/admin`.
- Admin login defaults to `admin/admin` on first boot and can be changed in Settings.
- Admin can create invite codes, manage users, manage media, and manage calendar events.
- Users can sign up in the mobile app with first name, last name, username, email, password, and invite code.
- Users sign in with username-or-email plus password; invite codes are only used to create accounts.
- Chat works through the API after login and supports text, emoji, pasted text, images, and GIF attachments.
- Chat/media retention is configurable in admin from 30 to 1095 days.
- Calendar supports one-time, daily, weekly, and monthly events.
- Recurring calendar events can be deleted as one occurrence or as the full series.
- The mobile app has monthly and list calendar views.
- Docker Compose runs Postgres, API, and web.

## Instagram feed

The app uses the public Instagram profile:

`https://www.instagram.com/dadrunclubplymouth/`

The profile image from Instagram is committed as the first logo asset. The API first uses the official Meta/Instagram API when credentials are provided. Without credentials, it uses a cached best-effort read from Instagram's public web profile. If Instagram changes or blocks that public endpoint, the app falls back to local placeholder cards and still links out to the profile.

To force the official API path, add Meta/Instagram API credentials:

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

Default seeded invite code for creating member accounts:

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
mkdir -p ~/drc && cd ~/drc && curl -fsSLO https://raw.githubusercontent.com/thedinz/dad-run-club-drc/main/docker-compose.yml && printf "POSTGRES_PASSWORD=%s\nJWT_SECRET=%s\nADMIN_USERNAME=admin\nADMIN_PASSWORD=admin\nSEED_INVITE_CODE=DRC-FOUNDERS\nCORS_ORIGIN=*\nWEB_PORT=6464\n" "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > .env && docker compose pull && docker compose up -d
```

Or, if you want to write the files manually, put this next to `docker-compose.yml` as `.env`:

```bash
POSTGRES_PASSWORD=replace-me
JWT_SECRET=replace-with-a-long-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
SEED_INVITE_CODE=DRC-FOUNDERS
CORS_ORIGIN=*
WEB_PORT=6464
```

Then run:

```bash
docker compose pull
docker compose up -d
```

Expose only the web service through your reverse proxy. By default the host port is `6464`, so point the proxy at `http://SERVER_IP:6464`. The web container forwards `/api/backend` to the API container internally.

For local builds from source, use `docker-compose.dev.yml`:

```bash
docker compose -f docker-compose.dev.yml up --build
```

## Early decisions still needed

- Get the original high-resolution logo file for App Store quality icons.
- Create Meta/Instagram API credentials for real feed sync.
- Decide whether all members can create calendar events or only admins.
- Add production hosting details for the API, web app, database backups, and push notifications.
