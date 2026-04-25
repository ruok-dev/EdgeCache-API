import crypto from 'crypto';

export class CacheKey {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  static fromParts(...parts: string[]): CacheKey {
    const key = parts
      .map((p) => p.toLowerCase().replace(/[^a-z0-9._-]/g, '_'))
      .join(':');
    return new CacheKey(key);
  }

  static fromRequest(method: string, url: string, body?: unknown): CacheKey {
    const normalizedUrl = url.toLowerCase().replace(/\/+$/, '');
    const base = `${method.toUpperCase()}:${normalizedUrl}`;

    if (body && Object.keys(body as object).length > 0) {
      const hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(body))
        .digest('hex')
        .slice(0, 12);
      return new CacheKey(`${base}:${hash}`);
    }

    return new CacheKey(base);
  }

  static fromRaw(key: string): CacheKey {
    if (!key || key.trim().length === 0) {
      throw new Error('Cache key cannot be empty');
    }
    if (key.length > 512) {
      throw new Error('Cache key cannot exceed 512 characters');
    }
    return new CacheKey(key.trim());
  }

  get value(): string {
    return this._value;
  }

  withPrefix(prefix: string): CacheKey {
    return new CacheKey(`${prefix}:${this._value}`);
  }

  withSuffix(suffix: string): CacheKey {
    return new CacheKey(`${this._value}:${suffix}`);
  }

  toString(): string {
    return this._value;
  }

  equals(other: CacheKey): boolean {
    return this._value === other._value;
  }
}
