import { CacheEntry } from '../../src/domain/cache/CacheEntry';

describe('CacheEntry', () => {
  describe('create', () => {
    it('should create a valid cache entry', () => {
      const entry = CacheEntry.create('test-key', { foo: 'bar' }, 300);

      expect(entry.key).toBe('test-key');
      expect(entry.value).toEqual({ foo: 'bar' });
      expect(entry.ttl).toBe(300);
      expect(entry.hitCount).toBe(0);
      expect(entry.tags).toEqual([]);
    });

    it('should set correct expiry based on TTL', () => {
      const before = new Date();
      const entry = CacheEntry.create('k', 'v', 60);
      const after = new Date();

      const minExpiry = new Date(before.getTime() + 60 * 1000);
      const maxExpiry = new Date(after.getTime() + 60 * 1000);

      expect(entry.expiresAt >= minExpiry).toBe(true);
      expect(entry.expiresAt <= maxExpiry).toBe(true);
    });

    it('should attach tags and metadata', () => {
      const tags = ['user', 'api'];
      const metadata = { region: 'us-east-1' };
      const entry = CacheEntry.create('k', 'v', 60, tags, metadata);

      expect(entry.tags).toEqual(tags);
      expect(entry.metadata).toEqual(metadata);
    });
  });

  describe('isExpired', () => {
    it('should return false for a fresh entry', () => {
      const entry = CacheEntry.create('k', 'v', 300);
      expect(entry.isExpired()).toBe(false);
    });

    it('should return true for an already-expired entry', () => {
      const entry = CacheEntry.restore({
        key: 'k',
        value: 'v',
        ttl: 1,
        createdAt: new Date(Date.now() - 10000),
        expiresAt: new Date(Date.now() - 1000),
        hitCount: 0,
        tags: [],
        metadata: {},
      });

      expect(entry.isExpired()).toBe(true);
    });
  });

  describe('remainingTtl', () => {
    it('should return a positive number for a live entry', () => {
      const entry = CacheEntry.create('k', 'v', 300);
      expect(entry.remainingTtl()).toBeGreaterThan(0);
      expect(entry.remainingTtl()).toBeLessThanOrEqual(300);
    });

    it('should return 0 for an expired entry', () => {
      const entry = CacheEntry.restore({
        key: 'k',
        value: 'v',
        ttl: 1,
        createdAt: new Date(Date.now() - 10000),
        expiresAt: new Date(Date.now() - 1000),
        hitCount: 0,
        tags: [],
        metadata: {},
      });

      expect(entry.remainingTtl()).toBe(0);
    });
  });

  describe('registerHit', () => {
    it('should return a new entry with incremented hitCount', () => {
      const entry = CacheEntry.create('k', 'v', 300);
      const hit1 = entry.registerHit();
      const hit2 = hit1.registerHit();

      expect(entry.hitCount).toBe(0);
      expect(hit1.hitCount).toBe(1);
      expect(hit2.hitCount).toBe(2);
    });

    it('should be immutable — original is unchanged', () => {
      const entry = CacheEntry.create('k', 'v', 300);
      entry.registerHit();
      expect(entry.hitCount).toBe(0);
    });
  });

  describe('tags immutability', () => {
    it('should return a copy of tags array', () => {
      const tags = ['a', 'b'];
      const entry = CacheEntry.create('k', 'v', 300, tags);
      const returnedTags = entry.tags;
      returnedTags.push('c');
      expect(entry.tags).toHaveLength(2);
    });
  });
});
