# Monorepo-aware image for the Socket.IO server.
# Build from the repository root:
#   docker build -f apps/realtime/Dockerfile -t uttt-realtime .

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/realtime/package.json apps/realtime/
COPY packages/contracts/package.json packages/contracts/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/rating/package.json packages/rating/
COPY packages/db/package.json packages/db/
RUN npm ci --workspace=@uttt/realtime --include-workspace-root

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/realtime apps/realtime
COPY packages/contracts packages/contracts
COPY packages/game-engine packages/game-engine
COPY packages/rating packages/rating
COPY packages/db packages/db
RUN npm run build -w @uttt/contracts \
                 -w @uttt/game-engine \
                 -w @uttt/rating \
                 -w @uttt/db \
                 -w @uttt/realtime

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/realtime ./apps/realtime
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/packages/game-engine ./packages/game-engine
COPY --from=build /app/packages/rating ./packages/rating
COPY --from=build /app/packages/db ./packages/db
EXPOSE 3001
CMD ["node", "apps/realtime/dist/index.js"]
