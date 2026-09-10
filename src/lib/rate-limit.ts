import { rateLimited } from "@/lib/errors";

export interface RateLimiter {
  /** Throws `AppError("RATE_LIMITED")` when the caller is over budget. */
  check(key: string): Promise<void>;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Token-bucket limiter kept in process memory.
 *
 * This is deliberately an interface with a single in-memory implementation:
 * a multi-instance deployment swaps in a Redis/Upstash implementation without
 * touching call sites. See docs/security.md.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  async check(key: string): Promise<void> {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    const elapsedSeconds = (now - bucket.updatedAt) / 1000;
    const tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);

    if (tokens < 1) {
      const waitMs = Math.ceil(((1 - tokens) / this.refillPerSecond) * 1000);
      this.buckets.set(key, { tokens, updatedAt: now });
      throw rateLimited(waitMs);
    }

    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  }

  reset(): void {
    this.buckets.clear();
  }
}

/** 20 agent turns per minute per user, bursting to 10. */
export const agentRateLimiter = new InMemoryRateLimiter(10, 20 / 60);
/** Uploads are heavier: 5 at a time, refilling one every 12 seconds. */
export const uploadRateLimiter = new InMemoryRateLimiter(5, 1 / 12);
