import { Router } from 'express';
import { CacheController } from '../controllers/CacheController';
import { ProxyController } from '../controllers/ProxyController';
import { HealthController } from '../controllers/HealthController';

export function buildRoutes(
  cacheController: CacheController,
  proxyController: ProxyController,
  healthController: HealthController,
): Router {
  const router = Router();

  // ─── Health & readiness ─────────────────────────────────────────────
  router.get('/health', healthController.health);
  router.get('/health/ready', healthController.ready);
  router.get('/health/live', healthController.live);

  // ─── Cache CRUD ─────────────────────────────────────────────────────
  router.get('/cache/:key', cacheController.get);
  router.put('/cache/:key', cacheController.set);
  router.delete('/cache/:key', cacheController.delete);

  // ─── Cache management ────────────────────────────────────────────────
  router.post('/cache/invalidate', cacheController.invalidate);
  router.delete('/cache', cacheController.flush);
  router.get('/cache', cacheController.keys);

  // ─── Stats ──────────────────────────────────────────────────────────
  router.get('/stats', cacheController.stats);

  // ─── Proxy gateway ──────────────────────────────────────────────────
  router.all('/proxy', proxyController.proxy);

  return router;
}
