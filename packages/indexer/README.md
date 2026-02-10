# ATP Indexer

A real-time indexer for the Agent Trust Protocol (ATP) on Hedera Consensus Service (HCS). Ingests HCS messages via gRPC streaming with REST backfill, stores them in PostgreSQL, and serves structured data through a REST API.

## Features

- **Real-time gRPC streaming** via `@hashgraph/sdk` `TopicMessageQuery` — sub-second latency
- **REST backfill** from Hedera mirror node for historical catch-up
- **Automatic reconnection** with exponential backoff on subscriber disconnects
- **Runtime topic management** — add/remove topics via API without restart
- **Typed event processing** — classifies and stores ATP event types:
  - `AGENT_INITIALIZATION` / `agent_created` → Agent registry
  - `OPENCLAW_ACTION` → Agent action audit trail
  - `AGENT_TRANSACTION` → On-chain transaction log
  - `rental_initiated` / `rental_completed` → Rental lifecycle
  - `agent_comms` → Agent-to-agent communication
- **Swagger/OpenAPI docs** at `/docs`
- **Consistent pagination** on all list endpoints
- **Health check** with per-topic sync status
- **Structured logging** via Pino
- **Graceful shutdown** (SIGTERM/SIGINT)
- **Multi-stage Docker build** with health check

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22 + TypeScript |
| API | Fastify |
| Database | PostgreSQL 16 + Drizzle ORM |
| HCS Ingestion | `@hashgraph/sdk` (gRPC) + mirror node REST (backfill) |
| Validation | Zod |
| Testing | Vitest |
| Logging | Pino |
| Docs | `@fastify/swagger` + `@fastify/swagger-ui` |

## Quick Start

### Prerequisites
- Node.js 22+
- PostgreSQL 16+
- npm

### Docker Compose (recommended)

```bash
docker compose up -d
```

This starts PostgreSQL and the indexer with default config. The indexer listens on port 3850.

### Manual Setup

```bash
# Install dependencies
npm ci

# Set environment variables (copy and edit)
cp .env.example .env

# Push database schema
npx drizzle-kit push

# Build and start
npm run build
npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | (required) | PostgreSQL connection string |
| `PORT` | `3850` | HTTP server port |
| `NETWORK` | `mainnet` | Hedera network (`mainnet` or `testnet`) |
| `MIRROR_NODE_URL` | `https://mainnet.mirrornode.hedera.com` | Mirror node REST API base URL |
| `SEED_TOPICS` | (optional) | Comma-separated topic IDs to subscribe on startup |
| `POLL_INTERVAL_MS` | `5000` | Backfill poll interval (ms) |
| `LOG_LEVEL` | `info` | Pino log level |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check with sync status |
| `GET` | `/api/v1/stats` | Aggregate statistics |
| `GET` | `/api/v1/agents` | List indexed agents |
| `GET` | `/api/v1/agents/:id` | Get agent by ID |
| `GET` | `/api/v1/agents/:id/attestations` | Agent attestation history |
| `GET` | `/api/v1/agents/:id/rentals` | Agent rental history |
| `GET` | `/api/v1/events` | List agent events (filterable) |
| `GET` | `/api/v1/comms` | List agent communications |
| `GET` | `/api/v1/topics` | List tracked topics |
| `POST` | `/api/v1/topics` | Add topic at runtime |
| `DELETE` | `/api/v1/topics/:id` | Remove topic |
| `GET` | `/api/v1/topics/:id/messages` | Raw HCS messages for topic |
| `GET` | `/docs` | Swagger UI |

All list endpoints support `?limit=` and `?offset=` pagination.

## Architecture

```
┌─────────────────────────────────┐
│         Hedera Mainnet          │
│  ┌───────────┐  ┌────────────┐  │
│  │ HCS Topic │  │ HCS Topic  │  │
│  │ 0.0.XXX   │  │ 0.0.YYY    │  │
│  └─────┬─────┘  └─────┬──────┘  │
└────────┼───────────────┼─────────┘
         │ gRPC stream   │ gRPC stream
         ▼               ▼
┌─────────────────────────────────┐
│       Ingestion Manager         │
│  ┌──────────┐  ┌─────────────┐  │
│  │Subscriber│  │  Backfill   │  │
│  │ (gRPC)   │  │  (REST)     │  │
│  └────┬─────┘  └──────┬──────┘  │
│       └───────┬────────┘        │
│               ▼                 │
│        Message Parser           │
│     (classify + validate)       │
└───────────────┬─────────────────┘
                ▼
┌─────────────────────────────────┐
│        PostgreSQL 16            │
│  hcs_messages │ agents          │
│  agent_events │ agent_comms     │
│  rentals      │ sync_cursors    │
└───────────────┬─────────────────┘
                ▼
┌─────────────────────────────────┐
│        Fastify REST API         │
│  /api/v1/agents                 │
│  /api/v1/events                 │
│  /api/v1/topics/:id/messages    │
│  /docs (Swagger)                │
└─────────────────────────────────┘
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage
```

54 tests across unit and integration suites.

## Database Schema

Managed by Drizzle ORM. Key tables:

- **hcs_messages** — Raw HCS messages (base64 + decoded JSON)
- **agents** — Discovered agent registry
- **agent_events** — Typed events (actions, transactions)
- **rentals** — Rental lifecycle tracking
- **agent_comms** — Agent-to-agent messages
- **sync_cursors** — Per-topic ingestion progress

## Why gRPC over REST Polling?

1. **Real-time delivery** — Messages arrive as they're confirmed on Hedera (~3-5s finality)
2. **No wasted requests** — REST polling hammers the mirror node even when no new messages exist
3. **Official Hedera recommendation** — SDK's `TopicMessageQuery` is the intended consumption path
4. **Free** — gRPC has no request-based rate limits (5 concurrent subscriptions max)
5. **Simpler resumption** — SDK handles reconnection; we just track the last consensus timestamp
6. **Rate-limit friendly** — REST mirror node caps at 100 req/s; gRPC avoids that entirely

REST is retained as a fallback for historical backfill when the subscriber starts with a gap.

## License

Apache 2.0 — see [LICENSE](../../LICENSE)
