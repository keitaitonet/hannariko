# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@12.4.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm check && pnpm build

# Mastra generates a standalone package, but does not copy pnpm patch settings.
RUN cp pnpm-workspace.yaml .mastra/output/ && cp -r patches .mastra/output/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm --dir .mastra/output install --prod --no-frozen-lockfile

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/.mastra/output ./
RUN mkdir /data && chown node:node /data
USER node
CMD ["node", "index.mjs"]
