import request from 'supertest';
import { createApp } from '../../src/app';
import { Application } from 'express';

jest.mock('../../src/config/env', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    API_VERSION: 'v1',
    CACHE_DEFAULT_TTL: 300,
    CACHE_MAX_MEMORY_ENTRIES: 1000,
    CACHE_MAX_MEMORY_MB: 256,
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX_REQUESTS: 1000,
    RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS: false,
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_DB: 0,
    REDIS_KEY_PREFIX: 'test:',
    REDIS_MAX_RETRIES: 1,
    REDIS_RETRY_DELAY_MS: 100,
    REDIS_CONNECT_TIMEOUT_MS: 1000,
    REDIS_COMMAND_TIMEOUT_MS: 1000,
    LOG_LEVEL: 'silent',
    LOG_FORMAT: 'json',
    LOG_INCLUDE_TRACE: false,
    UPSTREAM_ALLOWED_HOSTS: [],
    UPSTREAM_TIMEOUT_MS: 5000,
    UPSTREAM_MAX_REDIRECTS: 5,
    API_SECRET: 'test_secret_that_is_at_least_32_chars_long',
    CORS_ALLOWED_ORIGINS: ['*'],
    METRICS_ENABLED: true,
    METRICS_ENDPOINT: '/metrics',
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
}));

jest.mock('../../src/infrastructure/logging/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
  createChildLogger: jest.fn(),
}));

jest.mock('../../src/infrastructure/redis/connection', () => ({
  isRedisConnected: jest.fn().mockReturnValue(false),
  getRedisClient: jest.fn().mockRejectedValue(new Error('Redis not available in tests')),
  closeRedisConnection: jest.fn().mockResolvedValue(undefined),
}));

describe('Cache API Integration Tests', () => {
  let app: Application;
  const BASE = '/api/v1';

  beforeAll(() => {
    app = createApp();
  });

  describe('Health endpoints', () => {
    it('GET /health should return health status', async () => {
      const res = await request(app).get(`${BASE}/health`);
      expect(res.status).toBeLessThan(300);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('services');
    });

    it('GET /health/ready should return 200', async () => {
      const res = await request(app).get(`${BASE}/health/ready`);
      expect(res.status).toBe(200);
      expect(res.body.ready).toBe(true);
    });

    it('GET /health/live should return 200', async () => {
      const res = await request(app).get(`${BASE}/health/live`);
      expect(res.status).toBe(200);
      expect(res.body.alive).toBe(true);
    });
  });

  describe('Cache CRUD', () => {
    const testKey = encodeURIComponent('integration:test:key');

    afterEach(async () => {
      await request(app).delete(`${BASE}/cache/${testKey}`);
    });

    it('PUT /cache/:key should store a value', async () => {
      const res = await request(app)
        .put(`${BASE}/cache/${testKey}`)
        .send({ value: { hello: 'world' }, ttl: 60 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toBeDefined();
    });

    it('GET /cache/:key should retrieve a stored value', async () => {
      await request(app)
        .put(`${BASE}/cache/${testKey}`)
        .send({ value: { hello: 'world' }, ttl: 60 });

      const res = await request(app).get(`${BASE}/cache/${testKey}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.value).toEqual({ hello: 'world' });
      expect(res.headers['x-cache']).toBe('HIT');
    });

    it('GET /cache/:key should return 404 for missing key', async () => {
      const res = await request(app).get(`${BASE}/cache/nonexistent-key-xyz`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('DELETE /cache/:key should remove a stored value', async () => {
      await request(app)
        .put(`${BASE}/cache/${testKey}`)
        .send({ value: 'to delete', ttl: 60 });

      const delRes = await request(app).delete(`${BASE}/cache/${testKey}`);
      expect(delRes.status).toBe(200);

      const getRes = await request(app).get(`${BASE}/cache/${testKey}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('Cache with tags', () => {
    it('should store entry with tags and invalidate by tag', async () => {
      await request(app)
        .put(`${BASE}/cache/tagged:1`)
        .send({ value: 'v1', ttl: 60, tags: ['group-a'] });

      await request(app)
        .put(`${BASE}/cache/tagged:2`)
        .send({ value: 'v2', ttl: 60, tags: ['group-a'] });

      await request(app)
        .put(`${BASE}/cache/tagged:3`)
        .send({ value: 'v3', ttl: 60, tags: ['group-b'] });

      const invalidateRes = await request(app)
        .post(`${BASE}/cache/invalidate`)
        .send({ tags: ['group-a'] });

      expect(invalidateRes.status).toBe(200);
      expect(invalidateRes.body.data.deletedCount).toBeGreaterThanOrEqual(2);

      // group-b should remain
      const res = await request(app).get(`${BASE}/cache/tagged:3`);
      expect(res.status).toBe(200);
    });
  });

  describe('Cache stats', () => {
    it('GET /stats should return cache statistics', async () => {
      const res = await request(app).get(`${BASE}/stats`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('hits');
      expect(res.body.data).toHaveProperty('misses');
      expect(res.body.data).toHaveProperty('hitRate');
    });
  });

  describe('Validation', () => {
    it('should return 400 for invalid TTL', async () => {
      const res = await request(app)
        .put(`${BASE}/cache/valid-key`)
        .send({ value: 'test', ttl: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing value', async () => {
      const res = await request(app)
        .put(`${BASE}/cache/valid-key`)
        .send({ ttl: 60 });

      expect(res.status).toBe(400);
    });
  });

  describe('Response headers', () => {
    it('should include X-Request-ID header', async () => {
      const res = await request(app).get(`${BASE}/health/live`);
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('should include security headers from Helmet', async () => {
      const res = await request(app).get(`${BASE}/health/live`);
      expect(res.headers['x-content-type-options']).toBeDefined();
    });
  });
});
