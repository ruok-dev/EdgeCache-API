import { ICacheRepository, SetOptions } from '../../domain/cache/ICacheRepository';
import { CacheKey } from '../../domain/cache/CacheKey';
import { ValidationError } from '../../shared/errors/AppError';
import { config } from '../../config/env';

export interface SetCacheInput {
  key: string;
  value: unknown;
  ttl?: number;
  tags?: string[];
  metadata?: Record<string, string>;
  ifNotExists?: boolean;
}

export interface SetCacheOutput {
  key: string;
  ttl: number;
  expiresAt: Date;
}

export class SetCacheUseCase {
  constructor(private readonly repository: ICacheRepository) {}

  async execute(input: SetCacheInput): Promise<SetCacheOutput> {
    this.validate(input);

    const cacheKey = CacheKey.fromRaw(input.key);
    const ttl = input.ttl ?? config.CACHE_DEFAULT_TTL;

    const options: SetOptions = {
      ttl,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      ifNotExists: input.ifNotExists,
    };

    await this.repository.set(cacheKey.value, input.value, options);

    const expiresAt = new Date(Date.now() + ttl * 1000);

    return {
      key: cacheKey.value,
      ttl,
      expiresAt,
    };
  }

  private validate(input: SetCacheInput): void {
    if (!input.key || input.key.trim().length === 0) {
      throw new ValidationError('Cache key is required');
    }
    if (input.key.length > 512) {
      throw new ValidationError('Cache key cannot exceed 512 characters');
    }
    if (input.ttl !== undefined && (input.ttl <= 0 || !Number.isInteger(input.ttl))) {
      throw new ValidationError('TTL must be a positive integer (seconds)');
    }
    if (input.ttl !== undefined && input.ttl > 86400 * 7) {
      throw new ValidationError('TTL cannot exceed 7 days (604800 seconds)');
    }
    if (input.value === undefined) {
      throw new ValidationError('Cache value is required');
    }
  }
}
