import { ICacheRepository } from '../../domain/cache/ICacheRepository';
import { CacheKey } from '../../domain/cache/CacheKey';
import { ValidationError } from '../../shared/errors/AppError';

export interface DeleteCacheInput {
  key?: string;
  tags?: string[];
  pattern?: string;
}

export interface DeleteCacheOutput {
  deletedCount: number;
  strategy: 'key' | 'tags' | 'pattern';
}

export class DeleteCacheUseCase {
  constructor(private readonly repository: ICacheRepository) {}

  async execute(input: DeleteCacheInput): Promise<DeleteCacheOutput> {
    this.validate(input);

    if (input.key) {
      const cacheKey = CacheKey.fromRaw(input.key);
      const deleted = await this.repository.delete(cacheKey.value);
      return { deletedCount: deleted ? 1 : 0, strategy: 'key' };
    }

    if (input.tags && input.tags.length > 0) {
      const count = await this.repository.deleteByTags(input.tags);
      return { deletedCount: count, strategy: 'tags' };
    }

    if (input.pattern) {
      const count = await this.repository.deleteByPattern(input.pattern);
      return { deletedCount: count, strategy: 'pattern' };
    }

    throw new ValidationError('Provide key, tags, or pattern for deletion');
  }

  private validate(input: DeleteCacheInput): void {
    const strategies = [input.key, input.tags, input.pattern].filter(Boolean);

    if (strategies.length === 0) {
      throw new ValidationError('At least one of key, tags, or pattern is required');
    }
    if (strategies.length > 1) {
      throw new ValidationError('Only one of key, tags, or pattern can be specified');
    }
    if (input.tags && input.tags.length > 50) {
      throw new ValidationError('Cannot invalidate more than 50 tags at once');
    }
    if (input.pattern && input.pattern.length > 512) {
      throw new ValidationError('Pattern cannot exceed 512 characters');
    }
  }
}
