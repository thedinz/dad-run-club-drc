FROM node:20-bookworm-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --filter @drc/api... --frozen-lockfile=false

COPY apps/api apps/api
RUN pnpm --filter @drc/api build

EXPOSE 4000
CMD ["pnpm", "--filter", "@drc/api", "start"]
