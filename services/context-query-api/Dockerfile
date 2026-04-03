FROM node:20-alpine AS base

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY infra ./infra

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3002

CMD ["node", "--import", "tsx", "services/context-query-api/src/index.ts"]
