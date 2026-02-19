/**
 * Rate limit metrics tracking.
 * 
 * Lightweight counters for observability.
 * No external dependencies.
 */
export class RateLimitMetrics {
  private totalRequests = 0;
  private rateLimitedRequests = 0;

  incrementRequests(): void {
    this.totalRequests++;
  }

  incrementRateLimited(): void {
    this.rateLimitedRequests++;
  }

  getMetrics(): {
    totalRequests: number;
    rateLimitedRequests: number;
    rateLimitRate: number;
  } {
    return {
      totalRequests: this.totalRequests,
      rateLimitedRequests: this.rateLimitedRequests,
      rateLimitRate: this.totalRequests > 0
        ? this.rateLimitedRequests / this.totalRequests
        : 0,
    };
  }

  reset(): void {
    this.totalRequests = 0;
    this.rateLimitedRequests = 0;
  }
}

export const rateLimitMetrics = new RateLimitMetrics();