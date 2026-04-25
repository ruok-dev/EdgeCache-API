export interface RateLimitWindow {
  identifier: string;
  requests: number;
  windowStart: Date;
  windowMs: number;
  maxRequests: number;
}

export class RateLimit {
  private readonly props: RateLimitWindow;

  private constructor(props: RateLimitWindow) {
    this.props = props;
  }

  static create(
    identifier: string,
    windowMs: number,
    maxRequests: number,
  ): RateLimit {
    return new RateLimit({
      identifier,
      requests: 0,
      windowStart: new Date(),
      windowMs,
      maxRequests,
    });
  }

  static restore(props: RateLimitWindow): RateLimit {
    return new RateLimit(props);
  }

  get identifier(): string {
    return this.props.identifier;
  }

  get requests(): number {
    return this.props.requests;
  }

  get maxRequests(): number {
    return this.props.maxRequests;
  }

  get windowMs(): number {
    return this.props.windowMs;
  }

  get windowStart(): Date {
    return this.props.windowStart;
  }

  isWindowExpired(): boolean {
    return Date.now() > this.props.windowStart.getTime() + this.props.windowMs;
  }

  isLimitExceeded(): boolean {
    if (this.isWindowExpired()) return false;
    return this.props.requests >= this.props.maxRequests;
  }

  remainingRequests(): number {
    if (this.isWindowExpired()) return this.props.maxRequests;
    return Math.max(0, this.props.maxRequests - this.props.requests);
  }

  resetAt(): Date {
    return new Date(this.props.windowStart.getTime() + this.props.windowMs);
  }

  increment(): RateLimit {
    const props = this.isWindowExpired()
      ? { ...this.props, requests: 1, windowStart: new Date() }
      : { ...this.props, requests: this.props.requests + 1 };

    return new RateLimit(props);
  }

  toJSON(): RateLimitWindow {
    return { ...this.props };
  }
}
