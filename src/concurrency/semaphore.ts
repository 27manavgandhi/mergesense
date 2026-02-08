import { getRedisClient, isRedisHealthy } from '../persistence/redis-client.js';
import { logger } from '../observability/logger.js';
import { maybeInjectFault } from '../faults/injector.js';
import { safeCheckInvariants } from '../invariants/checker.js';
import type { DistributedSemaphore } from '../persistence/types.js';

export class InMemorySemaphore implements DistributedSemaphore {
  private permits: number;
  private maxPermits: number;
  private waiting: Array<() => void> = [];
  private currentInFlight: number = 0;
  private peakInFlight: number = 0;

  constructor(maxPermits: number) {
    if (maxPermits <= 0) {
      throw new Error('Semaphore maxPermits must be > 0');
    }
    this.permits = maxPermits;
    this.maxPermits = maxPermits;
  }

  async tryAcquire(): Promise<boolean> {
    if (this.permits > 0) {
      this.permits--;
      this.currentInFlight++;
      if (this.currentInFlight > this.peakInFlight) {
        this.peakInFlight = this.currentInFlight;
      }
      
      safeCheckInvariants({
        semaphorePermits: this.permits,
        semaphoreInFlight: this.currentInFlight,
        semaphoreMaxPermits: this.maxPermits,
      }, ['SEMAPHORE_PERMITS_NON_NEGATIVE', 'SEMAPHORE_IN_FLIGHT_MATCHES_ACQUIRED']);
      
      return true;
    }
    return false;
  }

  async release(): Promise<void> {
    maybeInjectFault('SEMAPHORE_LEAK_SIMULATION');
    
    this.currentInFlight--;
    
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      this.currentInFlight++;
      if (this.currentInFlight > this.peakInFlight) {
        this.peakInFlight = this.currentInFlight;
      }
      resolve();
    } else {
      this.permits++;
    }
    
    safeCheckInvariants({
      semaphorePermits: this.permits,
      semaphoreInFlight: this.currentInFlight,
      semaphoreMaxPermits: this.maxPermits,
    }, ['SEMAPHORE_PERMITS_NON_NEGATIVE', 'SEMAPHORE_IN_FLIGHT_MATCHES_ACQUIRED']);
  }

  async getInFlight(): Promise<number> {
    return this.currentInFlight;
  }

  getPeak(): number {
    return this.peakInFlight;
  }

  async getAvailable(): Promise<number> {
    return this.permits;
  }

  getWaiting(): number {
    return this.waiting.length;
  }
}

const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = redis.call('GET', key)
if current == false then
  current = 0
else
  current = tonumber(current)
end

if current < max then
  redis.call('INCR', key)
  redis.call('EXPIRE', key, ttl)
  return 1
else
  return 0
end
`;

const RELEASE_SCRIPT = `
local key = KEYS[1]

local current = redis.call('GET', key)
if current == false or tonumber(current) <= 0 then
  return 0
end

redis.call('DECR', key)
return 1
`;

export class RedisSemaphore implements DistributedSemaphore {
  private key: string;
  private maxPermits: number;
  private ttlSeconds: number;
  private peakInFlight: number = 0;

  constructor(key: string, maxPermits: number, ttlSeconds: number = 300) {
    this.key = `sem:${key}`;
    this.maxPermits = maxPermits;
    this.ttlSeconds = ttlSeconds;
  }

  async tryAcquire(): Promise<boolean> {
    const redis = getRedisClient();
    
    if (!redis || !isRedisHealthy()) {
      logger.warn('semaphore_degraded', 'Redis unavailable, cannot enforce distributed concurrency', {
        key: this.key,
      });
      return true;
    }

    try {
      const result = await redis.eval(
        ACQUIRE_SCRIPT,
        1,
        this.key,
        this.maxPermits.toString(),
        this.ttlSeconds.toString()
      ) as number;
      
      if (result === 1) {
        const current = await this.getInFlight();
        if (current > this.peakInFlight) {
          this.peakInFlight = current;
        }
      }
      
      return result === 1;
    } catch (error) {
      logger.error('semaphore_redis_error', 'Redis semaphore operation failed, failing open', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key: this.key,
      });
      return true;
    }
  }

  async release(): Promise<void> {
    maybeInjectFault('SEMAPHORE_LEAK_SIMULATION');
    
    const redis = getRedisClient();
    
    if (!redis || !isRedisHealthy()) {
      return;
    }

    try {
      await redis.eval(RELEASE_SCRIPT, 1, this.key);
    } catch (error) {
      logger.error('semaphore_redis_error', 'Redis semaphore release failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key: this.key,
      });
    }
  }

  async getInFlight(): Promise<number> {
    const redis = getRedisClient();
    
    if (!redis || !isRedisHealthy()) {
      return 0;
    }

    try {
      const current = await redis.get(this.key);
      return current ? parseInt(current, 10) : 0;
    } catch (error) {
      return 0;
    }
  }

  getPeak(): number {
    return this.peakInFlight;
  }

  async getAvailable(): Promise<number> {
    const current = await this.getInFlight();
    return Math.max(0, this.maxPermits - current);
  }

  getWaiting(): number {
    return 0;
  }
}

export type Semaphore = InMemorySemaphore | RedisSemaphore;