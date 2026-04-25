import { CacheEntry } from '../../domain/cache/CacheEntry';
import {
  ICacheRepository,
  CacheStats,
  SetOptions,
} from '../../domain/cache/ICacheRepository';
import { MemoryCacheRepository } from './MemoryCacheRepository';
import { RedisCacheRepository } from './RedisCacheRepository';
import { logger } from '../logging/logger';

/**
 * LayeredCacheRepository implements a two-tier cache:
 * - L1: In-memory LRU cache (sub-millisecond reads)
 * - L2: Redis distributed cache (shared across instances)
 *
 * Read-through: L1 → L2 → miss
 * Write-through: L1 + L2 simultaneously
 * Fallback: if Redis is unavailable, falls back to L1 only
 */
export class LayeredCacheRepository implements ICacheRepository {
  constructor(
    private readonly l1: MemoryCacheRepository,
    private readonly l2: RedisCacheRepository,
    private readonly redisAvailable: () => boolean,
  ) {}

  async get(key: string): Promise<CacheEntry | null> {
    // L1 hit
    const l1Result = await this.l1.get(key);
    if (l1Result) {
      logger.debug({ key, layer: 'L1' }, 'Cache hit');
      return l1Result;
    }

    // L2 fallback
    if (this.redisAvailable()) {
      try {
        const l2Result = await this.l2.get(key);
        if (l2Result) {
          logger.debug({ key, layer: 'L2' }, 'Cache hit — promoting to L1');
          await this.l1.set(key, l2Result.value, {
            ttl: l2Result.remainingTtl(),
            tags: l2Result.tags,
            metadata: l2Result.metadata,
          });
          return l2Result;
        }
      } catch (error) {
        logger.warn({ err: error, key }, 'Redis get failed — serving from L1 only');
      }
    }

    logger.debug({ key }, 'Cache miss');
    return null;
  }

  async set(key: string, value: unknown, options?: SetOptions): Promise<void> {
    await this.l1.set(key, value, options);

    if (this.redisAvailable()) {
      try {
        await this.l2.set(key, value, options);
      } catch (error) {
        logger.warn({ err: error, key }, 'Redis set failed — stored in L1 only');
      }
    }
  }

  async delete(key: string): Promise<boolean> {
    const l1Result = await this.l1.delete(key);

    if (this.redisAvailable()) {
      try {
        await this.l2.delete(key);
      } catch (error) {
        logger.warn({ err: error, key }, 'Redis delete failed');
      }
    }

    return l1Result;
  }

  async deleteByTags(tags: string[]): Promise<number> {
    const l1Count = await this.l1.deleteByTags(tags);

    if (this.redisAvailable()) {
      try {
        await this.l2.deleteByTags(tags);
      } catch (error) {
        logger.warn({ err: error, tags }, 'Redis deleteByTags failed');
      }
    }

    return l1Count;
  }

  async deleteByPattern(pattern: string): Promise<number> {
    const l1Count = await this.l1.deleteByPattern(pattern);

    if (this.redisAvailable()) {
      try {
        await this.l2.deleteByPattern(pattern);
      } catch (error) {
        logger.warn({ err: error, pattern }, 'Redis deleteByPattern failed');
      }
    }

    return l1Count;
  }

  async exists(key: string): Promise<boolean> {
    const l1Exists = await this.l1.exists(key);
    if (l1Exists) return true;

    if (this.redisAvailable()) {
      try {
        return await this.l2.exists(key);
      } catch (error) {
        logger.warn({ err: error, key }, 'Redis exists check failed');
      }
    }

    return false;
  }

  async getStats(): Promise<CacheStats> {
    const l1Stats = await this.l1.getStats();

    if (this.redisAvailable()) {
      try {
        const l2Stats = await this.l2.getStats();
        return {
          hits: l1Stats.hits + l2Stats.hits,
          misses: l1Stats.misses,
          sets: l1Stats.sets,
          deletes: l1Stats.deletes,
          errors: l1Stats.errors + l2Stats.errors,
          hitRate: l1Stats.hitRate,
          totalEntries: l1Stats.totalEntries + l2Stats.totalEntries,
          memoryUsageMb: l1Stats.memoryUsageMb + l2Stats.memoryUsageMb,
        };
      } catch {
        // fall through to L1 stats only
      }
    }

    return l1Stats;
  }

  async flush(): Promise<void> {
    await this.l1.flush();

    if (this.redisAvailable()) {
      try {
        await this.l2.flush();
      } catch (error) {
        logger.warn({ err: error }, 'Redis flush failed');
      }
    }
  }

  async keys(pattern?: string): Promise<string[]> {
    const l1Keys = await this.l1.keys(pattern);

    if (this.redisAvailable()) {
      try {
        const l2Keys = await this.l2.keys(pattern);
        return [...new Set([...l1Keys, ...l2Keys])];
      } catch {
        // fall through
      }
    }

    return l1Keys;
  }

  async mget(keys: string[]): Promise<Array<CacheEntry | null>> {
    return Promise.all(keys.map((k) => this.get(k)));
  }

  async mset(
    entries: Array<{ key: string; value: unknown; options?: SetOptions }>,
  ): Promise<void> {
    await Promise.all(entries.map(({ key, value, options }) => this.set(key, value, options)));
  }
}
