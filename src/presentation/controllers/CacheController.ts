import { Request, Response, NextFunction } from 'express';
import { GetCacheUseCase } from '../../application/useCases/GetCacheUseCase';
import { SetCacheUseCase } from '../../application/useCases/SetCacheUseCase';
import { DeleteCacheUseCase } from '../../application/useCases/DeleteCacheUseCase';
import { ICacheRepository } from '../../domain/cache/ICacheRepository';
import { ApiResponse } from '../../shared/types';
import { logger } from '../../infrastructure/logging/logger';

export class CacheController {
  private readonly getUseCase: GetCacheUseCase;
  private readonly setUseCase: SetCacheUseCase;
  private readonly deleteUseCase: DeleteCacheUseCase;

  constructor(private readonly repository: ICacheRepository) {
    this.getUseCase = new GetCacheUseCase(repository);
    this.setUseCase = new SetCacheUseCase(repository);
    this.deleteUseCase = new DeleteCacheUseCase(repository);
  }

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { key } = req.params;
      const result = await this.getUseCase.execute({ key });

      const response: ApiResponse = {
        success: true,
        data: {
          key: result.entry.key,
          value: result.entry.value,
          ttl: result.entry.ttl,
          remainingTtl: result.remainingTtl,
          tags: result.entry.tags,
          metadata: result.entry.metadata,
          hitCount: result.entry.hitCount,
          createdAt: result.entry.createdAt,
          expiresAt: result.entry.expiresAt,
        },
        meta: {
          requestId: res.locals['requestId'] as string,
          timestamp: new Date().toISOString(),
          latencyMs: res.locals['latencyMs'] as number,
          cached: true,
          cacheAge: result.cacheAge,
        },
      };

      res.set('X-Cache', 'HIT');
      res.set('X-Cache-Age', String(result.cacheAge));
      res.set('X-Cache-TTL', String(result.remainingTtl));
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  };

  set = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { key } = req.params;
      const { value, ttl, tags, metadata, ifNotExists } = req.body as {
        value: unknown;
        ttl?: number;
        tags?: string[];
        metadata?: Record<string, string>;
        ifNotExists?: boolean;
      };

      const result = await this.setUseCase.execute({
        key,
        value,
        ttl,
        tags,
        metadata,
        ifNotExists,
      });

      const response: ApiResponse = {
        success: true,
        data: result,
        meta: {
          requestId: res.locals['requestId'] as string,
          timestamp: new Date().toISOString(),
          latencyMs: res.locals['latencyMs'] as number,
        },
      };

      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { key } = req.params;
      const result = await this.deleteUseCase.execute({ key });

      res.status(200).json({
        success: true,
        data: result,
        meta: {
          requestId: res.locals['requestId'] as string,
          timestamp: new Date().toISOString(),
          latencyMs: res.locals['latencyMs'] as number,
        },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  };

  invalidate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tags, pattern } = req.body as { tags?: string[]; pattern?: string };

      const result = await this.deleteUseCase.execute({ tags, pattern });

      res.status(200).json({
        success: true,
        data: result,
        meta: {
          requestId: res.locals['requestId'] as string,
          timestamp: new Date().toISOString(),
          latencyMs: res.locals['latencyMs'] as number,
        },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  };

  stats = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await this.repository.getStats();
      res.status(200).json({ success: true, data: stats } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  };

  flush = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.repository.flush();
      logger.warn('Cache flushed via API');
      res.status(200).json({ success: true, data: { message: 'Cache flushed' } } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  };

  keys = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { pattern } = req.query as { pattern?: string };
      const keys = await this.repository.keys(pattern);
      res.status(200).json({
        success: true,
        data: { keys, count: keys.length },
      } satisfies ApiResponse);
    } catch (err) {
      next(err);
    }
  };
}
