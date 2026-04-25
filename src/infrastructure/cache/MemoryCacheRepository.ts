import { CacheEntry } from '../../domain/cache/CacheEntry';
import {
  ICacheRepository,
  CacheStats,
  SetOptions,
} from '../../domain/cache/ICacheRepository';
import { config } from '../../config/env';
import { logger } from '../logging/logger';
import { getMemoryUsageMb } from '../../shared/utils';

interface LRUNode {
  key: string;
  entry: CacheEntry;
  prev: LRUNode | null;
  next: LRUNode | null;
}

export class MemoryCacheRepository implements ICacheRepository {
  private readonly map = new Map<string, LRUNode>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private head: LRUNode | null = null;
  private tail: LRUNode | null = null;
  private readonly maxEntries: number;
  private readonly defaultTtl: number;

  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
  };

  constructor() {
    this.maxEntries = config.CACHE_MAX_MEMORY_ENTRIES;
    this.defaultTtl = config.CACHE_DEFAULT_TTL;
    this.startEvictionInterval();
  }

  async get(key: string): Promise<CacheEntry | null> {
    try {
      const node = this.map.get(key);

      if (!node) {
        this.stats.misses++;
        return null;
      }

      if (node.entry.isExpired()) {
        this.removeNode(node);
        this.map.delete(key);
        this.stats.misses++;
        return null;
      }

      this.moveToFront(node);
      node.entry = node.entry.registerHit();
      this.stats.hits++;
      return node.entry;
    } catch (error) {
      this.stats.errors++;
      logger.error({ err: error, key }, 'Memory cache get error');
      return null;
    }
  }

  async set(key: string, value: unknown, options?: SetOptions): Promise<void> {
    try {
      const ttl = options?.ttl ?? this.defaultTtl;
      const tags = options?.tags ?? [];
      const metadata = options?.metadata ?? {};

      if (options?.ifNotExists && this.map.has(key)) {
        const node = this.map.get(key)!;
        if (!node.entry.isExpired()) return;
      }

      const entry = CacheEntry.create(key, value, ttl, tags, metadata);
      const existingNode = this.map.get(key);

      if (existingNode) {
        existingNode.entry = entry;
        this.moveToFront(existingNode);
      } else {
        if (this.map.size >= this.maxEntries) {
          this.evictLRU();
        }

        const node: LRUNode = { key, entry, prev: null, next: this.head };
        if (this.head) this.head.prev = node;
        this.head = node;
        if (!this.tail) this.tail = node;
        this.map.set(key, node);
      }

      for (const tag of tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(key);
      }

      this.stats.sets++;
    } catch (error) {
      this.stats.errors++;
      logger.error({ err: error, key }, 'Memory cache set error');
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const node = this.map.get(key);
      if (!node) return false;

      this.removeNode(node);
      this.map.delete(key);
      this.stats.deletes++;
      return true;
    } catch (error) {
      this.stats.errors++;
      logger.error({ err: error, key }, 'Memory cache delete error');
      return false;
    }
  }

  async deleteByTags(tags: string[]): Promise<number> {
    let count = 0;
    for (const tag of tags) {
      const keys = this.tagIndex.get(tag);
      if (!keys) continue;

      for (const key of keys) {
        const deleted = await this.delete(key);
        if (deleted) count++;
      }
      this.tagIndex.delete(tag);
    }
    return count;
  }

  async deleteByPattern(pattern: string): Promise<number> {
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
    let count = 0;

    for (const key of this.map.keys()) {
      if (regex.test(key)) {
        const deleted = await this.delete(key);
        if (deleted) count++;
      }
    }
    return count;
  }

  async exists(key: string): Promise<boolean> {
    const node = this.map.get(key);
    if (!node) return false;
    if (node.entry.isExpired()) {
      await this.delete(key);
      return false;
    }
    return true;
  }

  async getStats(): Promise<CacheStats> {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total === 0 ? 0 : Math.round((this.stats.hits / total) * 10000) / 100,
      totalEntries: this.map.size,
      memoryUsageMb: getMemoryUsageMb(),
    };
  }

  async flush(): Promise<void> {
    this.map.clear();
    this.tagIndex.clear();
    this.head = null;
    this.tail = null;
    logger.info('Memory cache flushed');
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = [...this.map.keys()];
    if (!pattern) return allKeys;
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
    return allKeys.filter((k) => regex.test(k));
  }

  async mget(keys: string[]): Promise<Array<CacheEntry | null>> {
    return Promise.all(keys.map((k) => this.get(k)));
  }

  async mset(
    entries: Array<{ key: string; value: unknown; options?: SetOptions }>,
  ): Promise<void> {
    await Promise.all(entries.map(({ key, value, options }) => this.set(key, value, options)));
  }

  private moveToFront(node: LRUNode): void {
    if (node === this.head) return;
    this.removeNode(node);
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNode(node: LRUNode): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }

  private evictLRU(): void {
    if (!this.tail) return;
    const key = this.tail.key;
    this.removeNode(this.tail);
    this.map.delete(key);
    logger.debug({ key }, 'LRU eviction');
  }

  private startEvictionInterval(): void {
    const interval = setInterval(
      () => {
        let evicted = 0;
        for (const [key, node] of this.map.entries()) {
          if (node.entry.isExpired()) {
            this.removeNode(node);
            this.map.delete(key);
            evicted++;
          }
        }
        if (evicted > 0) {
          logger.debug({ evicted }, 'TTL eviction sweep completed');
        }
      },
      30_000, // every 30 seconds
    );

    interval.unref();
  }
}
