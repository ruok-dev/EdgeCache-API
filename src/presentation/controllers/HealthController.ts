import { Request, Response } from 'express';
import { ICacheRepository } from '../../domain/cache/ICacheRepository';
import { Metrics } from '../../domain/metrics/Metrics';
import { isRedisConnected } from '../../infrastructure/redis/connection';
import { getMemoryUsageMb } from '../../shared/utils';

export class HealthController {
  constructor(
    private readonly repository: ICacheRepository,
    private readonly metrics: Metrics,
  ) {}

  health = async (_req: Request, res: Response): Promise<void> => {
    const redisConnected = isRedisConnected();
    const memoryMb = getMemoryUsageMb();
    const snapshot = this.metrics.snapshot(memoryMb, redisConnected);
    const stats = await this.repository.getStats();

    const status = redisConnected ? 'healthy' : 'degraded';

    res.status(status === 'healthy' ? 200 : 207).json({
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      version: process.env['npm_package_version'] ?? '1.0.0',
      services: {
        redis: {
          status: redisConnected ? 'connected' : 'disconnected',
          note: redisConnected ? undefined : 'Operating in L1-only fallback mode',
        },
        cache: {
          status: 'operational',
          hitRate: `${stats.hitRate}%`,
          totalEntries: stats.totalEntries,
          memoryUsageMb: stats.memoryUsageMb,
        },
      },
      metrics: {
        requestsPerSecond: snapshot.requestsPerSecond,
        avgLatencyMs: snapshot.avgLatencyMs,
        p95LatencyMs: snapshot.p95LatencyMs,
        p99LatencyMs: snapshot.p99LatencyMs,
        cacheHitRate: `${this.metrics.hitRate()}%`,
      },
    });
  };

  ready = (_req: Request, res: Response): void => {
    res.status(200).json({ ready: true });
  };

  live = (_req: Request, res: Response): void => {
    res.status(200).json({ alive: true });
  };
}
