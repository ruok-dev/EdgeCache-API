import { CacheEntry } from '../../domain/cache/CacheEntry';
import { ICacheRepository } from '../../domain/cache/ICacheRepository';
import { CacheKey } from '../../domain/cache/CacheKey';
import { NotFoundError } from '../../shared/errors/AppError';

export interface GetCacheInput {
  key: string;
}

export interface GetCacheOutput {
  entry: CacheEntry;
  cacheAge: number;
  remainingTtl: number;
}

export class GetCacheUseCase {
  constructor(private readonly repository: ICacheRepository) {}

  async execute(input: GetCacheInput): Promise<GetCacheOutput> {
    const cacheKey = CacheKey.fromRaw(input.key);
    const entry = await this.repository.get(cacheKey.value);

    if (!entry) {
      throw new NotFoundError(`Cache entry '${input.key}'`);
    }

    const cacheAge = Math.floor(
      (Date.now() - entry.createdAt.getTime()) / 1000,
    );

    return {
      entry,
      cacheAge,
      remainingTtl: entry.remainingTtl(),
    };
  }
}
