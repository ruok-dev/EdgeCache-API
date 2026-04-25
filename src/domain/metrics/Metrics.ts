export interface MetricSnapshot {
  timestamp: Date;
  cacheHits: number;
  cacheMisses: number;
  cacheErrors: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  requestsPerSecond: number;
  activeConnections: number;
  memoryUsageMb: number;
  redisConnected: boolean;
}

export class Metrics {
  private readonly latencies: number[] = [];
  private hits = 0;
  private misses = 0;
  private errors = 0;
  private requestCount = 0;
  private windowStart = Date.now();

  recordHit(latencyMs: number): void {
    this.hits++;
    this.requestCount++;
    this.latencies.push(latencyMs);
    this.trimLatencies();
  }

  recordMiss(latencyMs: number): void {
    this.misses++;
    this.requestCount++;
    this.latencies.push(latencyMs);
    this.trimLatencies();
  }

  recordError(): void {
    this.errors++;
    this.requestCount++;
  }

  private trimLatencies(): void {
    if (this.latencies.length > 10000) {
      this.latencies.splice(0, this.latencies.length - 10000);
    }
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private avgLatency(): number {
    if (this.latencies.length === 0) return 0;
    const sum = this.latencies.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencies.length);
  }

  snapshot(memoryUsageMb: number, redisConnected: boolean): MetricSnapshot {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const elapsedSeconds = (Date.now() - this.windowStart) / 1000;
    const rps = elapsedSeconds > 0 ? Math.round(this.requestCount / elapsedSeconds) : 0;

    return {
      timestamp: new Date(),
      cacheHits: this.hits,
      cacheMisses: this.misses,
      cacheErrors: this.errors,
      avgLatencyMs: this.avgLatency(),
      p95LatencyMs: this.percentile(sorted, 95),
      p99LatencyMs: this.percentile(sorted, 99),
      requestsPerSecond: rps,
      activeConnections: 0,
      memoryUsageMb,
      redisConnected,
    };
  }

  hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : Math.round((this.hits / total) * 100 * 100) / 100;
  }

  reset(): void {
    this.latencies.length = 0;
    this.hits = 0;
    this.misses = 0;
    this.errors = 0;
    this.requestCount = 0;
    this.windowStart = Date.now();
  }
}
