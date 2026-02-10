# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY drizzle.config.ts ./

RUN npm ci

COPY src ./src

RUN npm run build

# Runtime stage
FROM node:22-alpine

RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

RUN apk add --no-cache curl

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle
COPY drizzle.config.ts ./

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3850

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3850/api/v1/health || exit 1

CMD ["sh", "-c", "npm run db:migrate && node dist/index.js"]
