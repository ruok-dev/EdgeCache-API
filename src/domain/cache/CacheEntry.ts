export interface CacheEntryProps {
  key: string;
  value: unknown;
  ttl: number; // seconds
  createdAt: Date;
  expiresAt: Date;
  hitCount: number;
  tags: string[];
  metadata: Record<string, string>;
}

export class CacheEntry {
  private readonly props: CacheEntryProps;

  private constructor(props: CacheEntryProps) {
    this.props = props;
  }

  static create(
    key: string,
    value: unknown,
    ttl: number,
    tags: string[] = [],
    metadata: Record<string, string> = {},
  ): CacheEntry {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    return new CacheEntry({
      key,
      value,
      ttl,
      createdAt: now,
      expiresAt,
      hitCount: 0,
      tags,
      metadata,
    });
  }

  static restore(props: CacheEntryProps): CacheEntry {
    return new CacheEntry(props);
  }

  get key(): string {
    return this.props.key;
  }

  get value(): unknown {
    return this.props.value;
  }

  get ttl(): number {
    return this.props.ttl;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get hitCount(): number {
    return this.props.hitCount;
  }

  get tags(): string[] {
    return [...this.props.tags];
  }

  get metadata(): Record<string, string> {
    return { ...this.props.metadata };
  }

  isExpired(): boolean {
    return new Date() > this.props.expiresAt;
  }

  remainingTtl(): number {
    const remaining = (this.props.expiresAt.getTime() - Date.now()) / 1000;
    return Math.max(0, Math.floor(remaining));
  }

  registerHit(): CacheEntry {
    return new CacheEntry({
      ...this.props,
      hitCount: this.props.hitCount + 1,
    });
  }

  toJSON(): CacheEntryProps {
    return { ...this.props };
  }
}
