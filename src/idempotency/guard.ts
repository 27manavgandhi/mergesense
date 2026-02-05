import { IdempotencyResult, IdempotencyEntry } from './types.js';
import type { IdempotencyStore } from '../persistence/types.js';
import { getRedisClient, isRedisHealthy } from '../persistence/redis-client.js';
import { logger } from '../observability/logger.js';

const MAX_ENTRIES = 1000;
const TTL_MS = 3600000;
const TTL_SECONDS = 3600;

class InMemoryIdempotencyGuard implements IdempotencyStore {
  private entries: Map<string, IdempotencyEntry> = new Map();
  private insertionOrder: string[] = [];

  async checkAndMark(key: string): Promise<{ status: 'new' | 'duplicate_recent'; firstSeenAt?: Date }> {
    this.evictExpired();

    const existing = this.entries.get(key);
    
    if (existing) {
      existing.lastSeenAt = new Date();
      existing.count++;
      
      return {
        status: 'duplicate_recent',
        firstSeenAt: existing.firstSeenAt,
      };
    }

    if (this.entries.size >= MAX_ENTRIES) {
      this.evictOldest();
    }

    const entry: IdempotencyEntry = {
      key,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      count: 1,
    };

    this.entries.set(key, entry);
    this.insertionOrder.push(key);

    return { status: 'new' };
  }

  private evictExpired(): void {
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.lastSeenAt.getTime() > TTL_MS) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      this.entries.delete(key);
      const index = this.insertionOrder.indexOf(key);
      if (index !== -1) {
        this.insertionOrder.splice(index, 1);
      }
    }
  }

  private evictOldest(): void {
    if (this.insertionOrder.length === 0) return;

    const oldestKey = this.insertionOrder.shift()!;
    this.entries.delete(oldestKey);
  }

  getStats(): { size: number; maxSize: number; ttlMs: number; type: 'redis' | 'memory' } {
    return {
      size: this.entries.size,
      maxSize: MAX_ENTRIES,
      ttlMs: TTL_MS,
      type: 'memory',
    };
  }
}

class RedisIdempotencyGuard implements IdempotencyStore {
  private peak: number = 0;

  async checkAndMark(key: string): Promise<{ status: 'new' | 'duplicate_recent'; firstSeenAt?: Date }> {
    const redis = getRedisClient();
    
    if (!redis || !isRedisHealthy()) {
      logger.warn('idempotency_degraded', 'Redis unavailable, cannot enforce distributed idempotency', {
        key,
      });
      return { status: 'new' };
    }

    try {
      const redisKey = `idem:${key}`;
      const result = await redis.set(redisKey, '1', 'EX', TTL_SECONDS, 'NX');
      
      if (result === null) {
        const ttl = await redis.ttl(redisKey);
        const firstSeenAt = new Date(Date.now() - ((TTL_SECONDS - ttl) * 1000));
        
        return {
          status: 'duplicate_recent',
          firstSeenAt,
        };
      }
      
      return { status: 'new' };
    } catch (error) {
      logger.error('idempotency_redis_error', 'Redis operation failed, failing open', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
      });
      return { status: 'new' };
    }
  }

  getStats(): { size: number; maxSize: number; ttlMs: number; type: 'redis' | 'memory' } {
    return {
      size: 0,
      maxSize: 0,
      ttlMs: TTL_MS,
      type: 'redis',
    };
  }
}

export function createIdempotencyGuard(): IdempotencyStore {
  if (getRedisClient() && isRedisHealthy()) {
    logger.info('idempotency_initialization', 'Using Redis-backed idempotency guard');
    return new RedisIdempotencyGuard();
  } else {
    logger.info('idempotency_initialization', 'Using in-memory idempotency guard');
    return new InMemoryIdempotencyGuard();
  }
}

export const idempotencyGuard = createIdempotencyGuard();