import { CacheEntry } from './CacheEntry';

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
  hitRate: number;
  totalEntries: number;
  memoryUsageMb: number;
}

export interface SetOptions {
  ttl?: number;
  tags?: string[];
  metadata?: Record<string, string>;
  ifNotExists?: boolean;
}

export interface ICacheRepository {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, value: unknown, options?: SetOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteByTags(tags: string[]): Promise<number>;
  deleteByPattern(pattern: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  getStats(): Promise<CacheStats>;
  flush(): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
  mget(keys: string[]): Promise<Array<CacheEntry | null>>;
  mset(entries: Array<{ key: string; value: unknown; options?: SetOptions }>): Promise<void>;
}
