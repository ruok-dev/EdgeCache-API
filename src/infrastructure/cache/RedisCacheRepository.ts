import Redis from 'ioredis';
import { CacheEntry, CacheEntryProps } from '../../domain/cache/CacheEntry';
import {
  ICacheRepository,
  CacheStats,
  SetOptions,
} from '../../domain/cache/ICacheRepository';
import { config } from '../../config/env';
import { logger } from '../logging/logger';
import { safeJsonParse, chunk } from '../../shared/utils';

const STATS_KEY = '__edgecache:stats';
const TAGS_PREFIX = '__edgecache:tags:';

export class RedisCacheRepository implements ICacheRepository {
  private readonly client: Redis;
  private readonly defaultTtl: number;

  constructor(client: Redis) {
    this.client = client;
    this.defaultTtl = config.CACHE_DEFAULT_TTL;
  }

  async get(key: string): Promise<CacheEntry | null> {
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;

      const props = safeJsonParse<CacheEntryProps>(raw);
      if (!props) return null;

      const entry = CacheEntry.restore({
        ...props,
        createdAt: new Date(props.createdAt),
        expiresAt: new Date(props.expiresAt),
      });

      if (entry.isExpired()) {
        await this.client.del(key);
        return null;
      }

      const updated = entry.registerHit();
      await this.client.set(
        key,
        JSON.stringify(updated.toJSON()),
        'KEEPTTL',
      );

      return updated;
    } catch (error) {
      logger.error({ err: error, key }, 'Redis get error');
      return null;
    }
  }

  async set(key: string, value: unknown, options?: SetOptions): Promise<void> {
    try {
      const ttl = options?.ttl ?? this.defaultTtl;
      const tags = options?.tags ?? [];
      const metadata = options?.metadata ?? {};

      const entry = CacheEntry.create(key, value, ttl, tags, metadata);
      const serialized = JSON.stringify(entry.toJSON());

      const pipeline = this.client.pipeline();

      if (options?.ifNotExists) {
        pipeline.set(key, serialized, 'EX', ttl, 'NX');
      } else {
        pipeline.set(key, serialized, 'EX', ttl);
      }

      for (const tag of tags) {
        pipeline.sadd(`${TAGS_PREFIX}${tag}`, key);
        pipeline.expire(`${TAGS_PREFIX}${tag}`, ttl + 60);
      }

      await pipeline.exec();
    } catch (error) {
      logger.error({ err: error, key }, 'Redis set error');
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const result = await this.client.del(key);
      return result > 0;
    } catch (error) {
      logger.error({ err: error, key }, 'Redis delete error');
      return false;
    }
  }

  async deleteByTags(tags: string[]): Promise<number> {
    let count = 0;
    try {
      for (const tag of tags) {
        const tagKey = `${TAGS_PREFIX}${tag}`;
        const keys = await this.client.smembers(tagKey);

        for (const batch of chunk(keys, 100)) {
          if (batch.length > 0) {
            const deleted = await this.client.del(...batch);
            count += deleted;
          }
        }

        await this.client.del(tagKey);
      }
    } catch (error) {
      logger.error({ err: error, tags }, 'Redis deleteByTags error');
    }
    return count;
  }

  async deleteByPattern(pattern: string): Promise<number> {
    let count = 0;
    let cursor = '0';

    try {
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          const deleted = await this.client.del(...keys);
          count += deleted;
        }
      } while (cursor !== '0');
    } catch (error) {
      logger.error({ err: error, pattern }, 'Redis deleteByPattern error');
    }

    return count;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result > 0;
    } catch (error) {
      logger.error({ err: error, key }, 'Redis exists error');
      return false;
    }
  }

  async getStats(): Promise<CacheStats> {
    try {
      const info = await this.client.info('stats');
      const raw = await this.client.get(STATS_KEY);
      const stored = raw ? safeJsonParse<Partial<CacheStats>>(raw) : null;

      const memInfo = await this.client.info('memory');
      const memMatch = memInfo.match(/used_memory:(\d+)/);
      const memoryUsageMb = memMatch
        ? Math.round((parseInt(memMatch[1]) / 1024 / 1024) * 100) / 100
        : 0;

      const dbsizeResult = await this.client.dbsize();

      const keyspaceHits = this.extractInfoValue(info, 'keyspace_hits');
      const keyspaceMisses = this.extractInfoValue(info, 'keyspace_misses');
      const total = keyspaceHits + keyspaceMisses;

      return {
        hits: stored?.hits ?? keyspaceHits,
        misses: stored?.misses ?? keyspaceMisses,
        sets: stored?.sets ?? 0,
        deletes: stored?.deletes ?? 0,
        errors: stored?.errors ?? 0,
        hitRate: total === 0 ? 0 : Math.round((keyspaceHits / total) * 10000) / 100,
        totalEntries: dbsizeResult,
        memoryUsageMb,
      };
    } catch (error) {
      logger.error({ err: error }, 'Redis getStats error');
      return {
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        errors: 0,
        hitRate: 0,
        totalEntries: 0,
        memoryUsageMb: 0,
      };
    }
  }

  async flush(): Promise<void> {
    await this.client.flushdb();
    logger.info('Redis cache flushed');
  }

  async keys(pattern?: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    const matchPattern = pattern ?? '*';

    do {
      const [nextCursor, batch] = await this.client.scan(
        cursor,
        'MATCH',
        matchPattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }

  async mget(cacheKeys: string[]): Promise<Array<CacheEntry | null>> {
    try {
      const raws = await this.client.mget(...cacheKeys);
      return raws.map((raw) => {
        if (!raw) return null;
        const props = safeJsonParse<CacheEntryProps>(raw);
        if (!props) return null;
        return CacheEntry.restore({
          ...props,
          createdAt: new Date(props.createdAt),
          expiresAt: new Date(props.expiresAt),
        });
      });
    } catch (error) {
      logger.error({ err: error }, 'Redis mget error');
      return cacheKeys.map(() => null);
    }
  }

  async mset(
    entries: Array<{ key: string; value: unknown; options?: SetOptions }>,
  ): Promise<void> {
    const pipeline = this.client.pipeline();

    for (const { key, value, options } of entries) {
      const ttl = options?.ttl ?? this.defaultTtl;
      const tags = options?.tags ?? [];
      const metadata = options?.metadata ?? {};
      const entry = CacheEntry.create(key, value, ttl, tags, metadata);
      pipeline.set(key, JSON.stringify(entry.toJSON()), 'EX', ttl);

      for (const tag of tags) {
        pipeline.sadd(`${TAGS_PREFIX}${tag}`, key);
      }
    }

    await pipeline.exec();
  }

  private extractInfoValue(info: string, key: string): number {
    const match = info.match(new RegExp(`${key}:(\\d+)`));
    return match ? parseInt(match[1]) : 0;
  }
}
