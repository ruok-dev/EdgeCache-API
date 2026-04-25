import { Request, Response, NextFunction } from 'express';
import { ProxyCacheService } from '../../application/services/ProxyCacheService';
import { ApiResponse } from '../../shared/types';

export class ProxyController {
  constructor(private readonly proxyService: ProxyCacheService) {}

  proxy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { url, ttl, tags, bypassCache } = req.query as {
        url?: string;
        ttl?: string;
        tags?: string;
        bypassCache?: string;
      };

      const { headers, body } = req;

      const result = await this.proxyService.proxy({
        method: req.method,
        targetUrl: url ?? '',
        headers: headers as Record<string, string>,
        body: Object.keys(body as object).length > 0 ? body : undefined,
        cacheTtl: ttl ? parseInt(ttl) : undefined,
        cacheTags: tags ? tags.split(',').filter(Boolean) : undefined,
        bypassCache: bypassCache === 'true',
      });

      res.set('X-Cache', result.cached ? 'HIT' : 'MISS');
      res.set('X-Response-Time', `${result.latencyMs}ms`);

      if (result.cached && result.cacheAge !== undefined) {
        res.set('X-Cache-Age', String(result.cacheAge));
      }

      const response: ApiResponse = {
        success: true,
        data: result.body,
        meta: {
          requestId: res.locals['requestId'] as string,
          timestamp: new Date().toISOString(),
          latencyMs: result.latencyMs,
          cached: result.cached,
          cacheAge: result.cacheAge,
        },
      };

      res.status(result.statusCode).json(response);
    } catch (err) {
      next(err);
    }
  };
}
