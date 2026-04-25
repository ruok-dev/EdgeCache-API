import { CacheKey } from '../../src/domain/cache/CacheKey';

describe('CacheKey', () => {
  describe('fromParts', () => {
    it('should join parts with colon separator', () => {
      const key = CacheKey.fromParts('users', '123', 'profile');
      expect(key.value).toBe('users:123:profile');
    });

    it('should normalize to lowercase', () => {
      const key = CacheKey.fromParts('USERS', 'ABC');
      expect(key.value).toBe('users:abc');
    });

    it('should replace special characters with underscores', () => {
      const key = CacheKey.fromParts('hello world', 'foo/bar');
      expect(key.value).toBe('hello_world:foo_bar');
    });
  });

  describe('fromRequest', () => {
    it('should build key from method and URL', () => {
      const key = CacheKey.fromRequest('GET', '/api/users');
      expect(key.value).toBe('GET:/api/users');
    });

    it('should include body hash when body is provided', () => {
      const key = CacheKey.fromRequest('POST', '/api/search', { q: 'hello' });
      expect(key.value).toMatch(/^POST:\/api\/search:[a-f0-9]{12}$/);
    });

    it('should produce different keys for different bodies', () => {
      const key1 = CacheKey.fromRequest('POST', '/search', { q: 'hello' });
      const key2 = CacheKey.fromRequest('POST', '/search', { q: 'world' });
      expect(key1.value).not.toBe(key2.value);
    });

    it('should normalize trailing slashes from URLs', () => {
      const key = CacheKey.fromRequest('GET', '/api/users/');
      expect(key.value).toBe('GET:/api/users');
    });
  });

  describe('fromRaw', () => {
    it('should create a key from a raw string', () => {
      const key = CacheKey.fromRaw('my:custom:key');
      expect(key.value).toBe('my:custom:key');
    });

    it('should throw for empty key', () => {
      expect(() => CacheKey.fromRaw('')).toThrow('Cache key cannot be empty');
    });

    it('should throw for keys exceeding 512 characters', () => {
      const longKey = 'a'.repeat(513);
      expect(() => CacheKey.fromRaw(longKey)).toThrow('Cache key cannot exceed 512 characters');
    });
  });

  describe('withPrefix / withSuffix', () => {
    it('should prepend a prefix', () => {
      const key = CacheKey.fromRaw('my-key').withPrefix('ns');
      expect(key.value).toBe('ns:my-key');
    });

    it('should append a suffix', () => {
      const key = CacheKey.fromRaw('my-key').withSuffix('v2');
      expect(key.value).toBe('my-key:v2');
    });
  });

  describe('equals', () => {
    it('should return true for identical keys', () => {
      const a = CacheKey.fromRaw('same');
      const b = CacheKey.fromRaw('same');
      expect(a.equals(b)).toBe(true);
    });

    it('should return false for different keys', () => {
      const a = CacheKey.fromRaw('key-a');
      const b = CacheKey.fromRaw('key-b');
      expect(a.equals(b)).toBe(false);
    });
  });
});
