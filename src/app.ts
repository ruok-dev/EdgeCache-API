import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { config } from './config/env';
import { MemoryCacheRepository } from './infrastructure/cache/MemoryCacheRepository';
import { RedisCacheRepository } from './infrastructure/cache/RedisCacheRepository';
import { LayeredCacheRepository } from './infrastructure/cache/LayeredCacheRepository';
import { Metrics } from './domain/metrics/Metrics';
import { CacheController } from './presentation/controllers/CacheController';
import { ProxyController } from './presentation/controllers/ProxyController';
import { HealthController } from './presentation/controllers/HealthController';
import { ProxyCacheService } from './application/services/ProxyCacheService';
import { buildRoutes } from './presentation/routes';
import {
  requestContext,
  requestLogger,
  errorHandler,
  notFoundHandler,
} from './presentation/middlewares';
import { isRedisConnected } from './infrastructure/redis/connection';

export interface AppDependencies {
  redisRepository?: RedisCacheRepository;
}

export function createApp(deps?: AppDependencies): Application {
  const app = express();

  // ─── Security & parsing ──────────────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: config.CORS_ALLOWED_ORIGINS.length === 1 && config.CORS_ALLOWED_ORIGINS[0] === '*'
        ? '*'
        : config.CORS_ALLOWED_ORIGINS,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      exposedHeaders: ['X-Cache', 'X-Cache-Age', 'X-Cache-TTL', 'X-Request-ID', 'X-Response-Time'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ─── Rate limiting ───────────────────────────────────────────────────
  const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX_REQUESTS,
    skipSuccessfulRequests: config.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
    },
  });

  app.use(limiter);

  // ─── Request context ──────────────────────────────────────────────────
  app.use(requestContext);
  app.use(requestLogger);

  // ─── Dependency wiring ───────────────────────────────────────────────
  const metrics = new Metrics();
  const l1 = new MemoryCacheRepository();
  const repository = deps?.redisRepository
    ? new LayeredCacheRepository(l1, deps.redisRepository, isRedisConnected)
    : l1;

  const proxyService = new ProxyCacheService(repository, metrics);
  const cacheController = new CacheController(repository);
  const proxyController = new ProxyController(proxyService);
  const healthController = new HealthController(repository, metrics);

  // ─── Routes ─────────────────────────────────────────────────────────
  const apiPrefix = `/api/${config.API_VERSION}`;
  app.use(apiPrefix, buildRoutes(cacheController, proxyController, healthController));

  // ─── Error handling ──────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
