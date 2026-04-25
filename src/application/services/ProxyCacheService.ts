import https from 'https';
import http from 'http';
import { URL } from 'url';
import { ICacheRepository } from '../../domain/cache/ICacheRepository';
import { CacheKey } from '../../domain/cache/CacheKey';
import { Metrics } from '../../domain/metrics/Metrics';
import { config } from '../../config/env';
import { logger } from '../../infrastructure/logging/logger';
import { UpstreamError, ValidationError } from '../../shared/errors/AppError';

export interface ProxyRequest {
  method: string;
  targetUrl: string;
  headers?: Record<string, string>;
  body?: unknown;
  cacheTtl?: number;
  cacheTags?: string[];
  bypassCache?: boolean;
}

export interface ProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  cached: boolean;
  cacheAge?: number;
  latencyMs: number;
}

const CACHEABLE_METHODS = new Set(['GET', 'HEAD']);
const CACHEABLE_STATUS_CODES = new Set([200, 203, 204, 206, 300, 301, 304, 307, 308, 404, 410]);

export class ProxyCacheService {
  constructor(
    private readonly repository: ICacheRepository,
    private readonly metrics: Metrics,
  ) {}

  async proxy(request: ProxyRequest): Promise<ProxyResponse> {
    const start = Date.now();

    this.validateTarget(request.targetUrl);

    const isCacheable =
      CACHEABLE_METHODS.has(request.method.toUpperCase()) && !request.bypassCache;

    if (isCacheable) {
      const cacheKey = CacheKey.fromRequest(request.method, request.targetUrl, request.body);
      const cached = await this.repository.get(cacheKey.value);

      if (cached) {
        const latencyMs = Date.now() - start;
        this.metrics.recordHit(latencyMs);

        logger.debug({ url: request.targetUrl, key: cacheKey.value }, 'Proxy cache hit');

        return {
          statusCode: (cached.metadata['statusCode'] as unknown as number) ?? 200,
          headers: cached.metadata,
          body: cached.value,
          cached: true,
          cacheAge: Math.floor((Date.now() - cached.createdAt.getTime()) / 1000),
          latencyMs,
        };
      }
    }

    // Cache miss — fetch from upstream
    const upstream = await this.fetchUpstream(request);
    const latencyMs = Date.now() - start;

    if (
      isCacheable &&
      CACHEABLE_STATUS_CODES.has(upstream.statusCode)
    ) {
      const cacheKey = CacheKey.fromRequest(request.method, request.targetUrl, request.body);
      const ttl = request.cacheTtl ?? config.CACHE_DEFAULT_TTL;

      await this.repository.set(cacheKey.value, upstream.body, {
        ttl,
        tags: request.cacheTags ?? [],
        metadata: {
          statusCode: String(upstream.statusCode),
          contentType: upstream.headers['content-type'] ?? 'application/json',
        },
      });

      this.metrics.recordMiss(latencyMs);
    }

    return {
      ...upstream,
      cached: false,
      latencyMs,
    };
  }

  private validateTarget(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ValidationError(`Invalid target URL: ${url}`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ValidationError('Only HTTP and HTTPS protocols are allowed');
    }

    if (config.UPSTREAM_ALLOWED_HOSTS.length > 0) {
      const hostname = parsed.hostname;
      const allowed = config.UPSTREAM_ALLOWED_HOSTS.some(
        (h) => hostname === h || hostname.endsWith(`.${h}`),
      );

      if (!allowed) {
        throw new ValidationError(`Host '${hostname}' is not in the allowed upstream list`);
      }
    }
  }

  private fetchUpstream(request: ProxyRequest): Promise<{
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
  }> {
    return new Promise((resolve, reject) => {
      const url = new URL(request.targetUrl);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const bodyStr =
        request.body && typeof request.body === 'object'
          ? JSON.stringify(request.body)
          : undefined;

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'EdgeCache-API/1.0',
          ...(bodyStr && { 'Content-Length': Buffer.byteLength(bodyStr) }),
          ...request.headers,
        },
        timeout: config.UPSTREAM_TIMEOUT_MS,
      };

      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          let body: unknown;

          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }

          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v) headers[k] = Array.isArray(v) ? v.join(', ') : v;
          }

          resolve({ statusCode: res.statusCode ?? 200, headers, body });
        });

        res.on('error', reject);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new UpstreamError(`Upstream request timed out after ${config.UPSTREAM_TIMEOUT_MS}ms`));
      });

      req.on('error', (err) => {
        reject(new UpstreamError(`Upstream request failed: ${err.message}`));
      });

      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }
}
