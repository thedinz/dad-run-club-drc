FROM node:20-bookworm-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @drc/web... --frozen-lockfile=false

COPY apps/web apps/web
RUN pnpm --filter @drc/web build

EXPOSE 3000
CMD ["pnpm", "--filter", "@drc/web", "start"]
