import { MemoryCacheRepository } from '../../src/infrastructure/cache/MemoryCacheRepository';

// Mock logger before any import that transitively uses it
jest.mock('../../src/infrastructure/logging/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

// Isolate env so tests don't depend on .env file
jest.mock('../../src/config/env', () => ({
  config: {
    CACHE_DEFAULT_TTL: 300,
    CACHE_MAX_MEMORY_ENTRIES: 100,
    CACHE_MAX_MEMORY_MB: 512,
  },
}));

describe('MemoryCacheRepository', () => {
  let repo: MemoryCacheRepository;

  beforeEach(() => {
    repo = new MemoryCacheRepository();
  });

  describe('set & get', () => {
    it('should store and retrieve a value', async () => {
      await repo.set('key1', { data: 'hello' });
      const entry = await repo.get('key1');

      expect(entry).not.toBeNull();
      expect(entry!.value).toEqual({ data: 'hello' });
    });

    it('should return null for a missing key', async () => {
      const entry = await repo.get('nonexistent');
      expect(entry).toBeNull();
    });

    it('should return null for an expired entry', async () => {
      await repo.set('expired', 'value', { ttl: 1 });

      // Manually travel time
      jest.useFakeTimers();
      jest.advanceTimersByTime(2000);

      const entry = await repo.get('expired');
      expect(entry).toBeNull();

      jest.useRealTimers();
    });

    it('should increment hit count on access', async () => {
      await repo.set('hit-test', 'v');

      await repo.get('hit-test');
      await repo.get('hit-test');
      const entry = await repo.get('hit-test');

      expect(entry!.hitCount).toBe(3);
    });
  });

  describe('delete', () => {
    it('should delete an existing key and return true', async () => {
      await repo.set('to-delete', 'v');
      const result = await repo.delete('to-delete');
      expect(result).toBe(true);

      const entry = await repo.get('to-delete');
      expect(entry).toBeNull();
    });

    it('should return false for non-existent key', async () => {
      const result = await repo.delete('ghost');
      expect(result).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true for an existing key', async () => {
      await repo.set('exists-key', 'v');
      expect(await repo.exists('exists-key')).toBe(true);
    });

    it('should return false for a missing key', async () => {
      expect(await repo.exists('missing')).toBe(false);
    });
  });

  describe('deleteByTags', () => {
    it('should delete all entries with a matching tag', async () => {
      await repo.set('a', 1, { tags: ['user', 'cache'] });
      await repo.set('b', 2, { tags: ['user'] });
      await repo.set('c', 3, { tags: ['other'] });

      const count = await repo.deleteByTags(['user']);

      expect(count).toBe(2);
      expect(await repo.get('a')).toBeNull();
      expect(await repo.get('b')).toBeNull();
      expect(await repo.get('c')).not.toBeNull();
    });
  });

  describe('deleteByPattern', () => {
    it('should delete keys matching a glob pattern', async () => {
      await repo.set('user:1', 'a');
      await repo.set('user:2', 'b');
      await repo.set('product:1', 'c');

      const count = await repo.deleteByPattern('user:*');

      expect(count).toBe(2);
      expect(await repo.get('user:1')).toBeNull();
      expect(await repo.get('user:2')).toBeNull();
      expect(await repo.get('product:1')).not.toBeNull();
    });
  });

  describe('mget & mset', () => {
    it('should retrieve multiple keys at once', async () => {
      await repo.set('m1', 'val1');
      await repo.set('m2', 'val2');

      const results = await repo.mget(['m1', 'm2', 'missing']);

      expect(results[0]?.value).toBe('val1');
      expect(results[1]?.value).toBe('val2');
      expect(results[2]).toBeNull();
    });

    it('should set multiple entries at once', async () => {
      await repo.mset([
        { key: 'bulk1', value: 'a' },
        { key: 'bulk2', value: 'b' },
      ]);

      expect((await repo.get('bulk1'))?.value).toBe('a');
      expect((await repo.get('bulk2'))?.value).toBe('b');
    });
  });

  describe('getStats', () => {
    it('should compute hit rate correctly', async () => {
      await repo.set('stat-key', 'v');
      await repo.get('stat-key'); // HIT
      await repo.get('nonexistent'); // MISS

      const stats = await repo.getStats();

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(50);
    });
  });

  describe('flush', () => {
    it('should clear all entries', async () => {
      await repo.set('f1', 'v');
      await repo.set('f2', 'v');
      await repo.flush();

      const keys = await repo.keys();
      expect(keys).toHaveLength(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict the least recently used entry when at capacity', async () => {
      // capacity is 100 per mock config
      for (let i = 0; i < 100; i++) {
        await repo.set(`key-${i}`, `val-${i}`);
      }

      // Access key-0 to make it recently used
      await repo.get('key-0');

      // Add one more to trigger eviction of LRU (key-1 was least recently used)
      await repo.set('overflow-key', 'new');

      // key-0 should still be present (recently accessed)
      expect(await repo.get('key-0')).not.toBeNull();
    });
  });
});
