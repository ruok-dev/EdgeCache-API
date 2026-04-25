# ⚡ EdgeCache API

> Intelligent distributed cache gateway for APIs — extreme performance through layered caching, resilient fallback, and smart invalidation.

[![CI/CD](https://github.com/YOUR_USER/edgecache-api/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USER/edgecache-api/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20-green)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/Redis-7.2-red)](https://redis.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## Architecture

EdgeCache implements a **two-tier layered cache**:

```
Client Request
      │
      ▼
[ Rate Limiter ] ──── (429) ──▶ Client
      │
      ▼
[ L1: In-Memory LRU Cache ]  ← sub-millisecond reads
      │ miss
      ▼
[ L2: Redis Distributed Cache ] ← shared across instances
      │ miss or Redis down (fallback to L1-only)
      ▼
[ Upstream API ] ──── response cached in L1 + L2
```

**Domain-Driven Design (DDD)** structure:
```
src/
├── domain/           # Entities, value objects, repository interfaces
│   ├── cache/        # CacheEntry, CacheKey, ICacheRepository
│   ├── rateLimit/    # RateLimit entity
│   └── metrics/      # Metrics value object
├── application/      # Use cases & services (business logic)
│   ├── useCases/
│   └── services/     # ProxyCacheService (gateway core)
├── infrastructure/   # Concrete implementations
│   ├── cache/        # MemoryCache, RedisCache, LayeredCache
│   ├── redis/        # Connection management
│   └── logging/      # Pino structured logger
├── presentation/     # HTTP layer
│   ├── controllers/
│   ├── routes/
│   └── middlewares/
└── config/           # Zod-validated environment config
```

---

## Features

- **Layered Cache** — L1 in-memory LRU + L2 Redis, with automatic promotion on L2 hit
- **Resilient Fallback** — if Redis is unavailable, operates in L1-only mode transparently
- **Tag-based Invalidation** — invalidate groups of cache entries by tag in O(|tag|) time
- **Pattern Invalidation** — glob-pattern bulk delete (`user:*`)
- **Proxy Gateway** — forward requests to upstream APIs with automatic caching
- **Rate Limiting** — configurable per-IP sliding window
- **Structured Logging** — Pino JSON logs, pretty-printed in development
- **Health Checks** — `/health`, `/health/ready`, `/health/live` for Kubernetes probes
- **Metrics** — hit rate, p95/p99 latency, RPS
- **Security** — Helmet headers, CORS, allowed-hosts list for upstream proxy

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/YOUR_USER/edgecache-api.git
cd edgecache-api
cp .env.example .env
# Edit .env — set API_SECRET (required, min 32 chars) and REDIS_PASSWORD
```

### 2. Run with Docker Compose (recommended)

```bash
docker-compose up -d                    # production mode
docker-compose --profile dev up -d     # + Redis Commander UI on :8081
```

### 3. Run locally (development)

```bash
npm install
npm run dev
```

---

## API Reference

All endpoints are under `/api/v1`.

### Cache

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/cache/:key` | Get a cached entry |
| `PUT` | `/cache/:key` | Store an entry |
| `DELETE` | `/cache/:key` | Delete an entry |
| `POST` | `/cache/invalidate` | Invalidate by tags or pattern |
| `DELETE` | `/cache` | Flush all entries |
| `GET` | `/cache?pattern=` | List keys |

**Store an entry:**
```bash
curl -X PUT http://localhost:3000/api/v1/cache/my-key \
  -H "Content-Type: application/json" \
  -d '{"value": {"hello": "world"}, "ttl": 300, "tags": ["users"]}'
```

**Invalidate by tag:**
```bash
curl -X POST http://localhost:3000/api/v1/cache/invalidate \
  -H "Content-Type: application/json" \
  -d '{"tags": ["users"]}'
```

### Proxy Gateway

```bash
# GET via proxy with caching
curl "http://localhost:3000/api/v1/proxy?url=https://api.example.com/data&ttl=60"

# Bypass cache
curl "http://localhost:3000/api/v1/proxy?url=https://api.example.com/data&bypassCache=true"
```

### Health & Stats

```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/stats
```

---

## Configuration

All configuration is through environment variables. Copy `.env.example` to `.env`.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `API_SECRET` | *(required)* | Min 32-char secret — used for internal signing |
| `CACHE_DEFAULT_TTL` | `300` | Default TTL in seconds |
| `CACHE_MAX_MEMORY_ENTRIES` | `10000` | Max L1 cache entries before LRU eviction |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PASSWORD` | *(optional)* | Redis auth password |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms |
| `UPSTREAM_ALLOWED_HOSTS` | *(empty = all)* | Comma-separated allowed proxy targets |
| `LOG_LEVEL` | `info` | `fatal\|error\|warn\|info\|debug\|trace` |
| `LOG_FORMAT` | `pretty` | `pretty` (dev) or `json` (production) |

> ⚠️ **Never commit `.env` to version control.** Only `.env.example` (without real values) should be committed.

---

## Development

```bash
npm run dev           # Start with hot reload
npm run test          # Run all tests
npm run test:coverage # Tests with coverage report
npm run lint          # ESLint check
npm run typecheck     # TypeScript type check
npm run build         # Compile to dist/
```

---

## CI/CD

GitHub Actions pipeline (`.github/workflows/ci.yml`):

1. **Code Quality** — TypeScript type check + ESLint
2. **Unit Tests** — domain + infrastructure layer tests
3. **Integration Tests** — API tests with real Redis service
4. **Build** — TypeScript compilation
5. **Docker Build & Push** — multi-arch image to GHCR (main branch only)

**Required GitHub Secrets:**
- `API_SECRET` — used in integration test environment
- `CODECOV_TOKEN` — (optional) for coverage reporting

---

## License

MIT
