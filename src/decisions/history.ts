import { DecisionRecord, SanitizedDecisionRecord } from './types.js';
import { getRedisClient, isRedisHealthy } from '../persistence/redis-client.js';
import { logger } from '../observability/logger.js';
import { maybeInjectFault } from '../faults/injector.js';
import { FaultInjectionError } from '../faults/types.js';

const MAX_IN_MEMORY_DECISIONS = 100;
const MAX_REDIS_DECISIONS = 500;
const REDIS_KEY = 'decisions:history';

class InMemoryDecisionHistory {
  private decisions: DecisionRecord[] = [];

  append(decision: DecisionRecord): void {
    maybeInjectFault('DECISION_WRITE_FAILURE');
    
    this.decisions.push(decision);
    
    if (this.decisions.length > MAX_IN_MEMORY_DECISIONS) {
      this.decisions.shift();
    }
  }

  getRecent(limit: number = 50): DecisionRecord[] {
    const actualLimit = Math.min(limit, this.decisions.length);
    return this.decisions.slice(-actualLimit).reverse();
  }

  getStats(): { count: number; maxSize: number; type: 'memory' } {
    return {
      count: this.decisions.length,
      maxSize: MAX_IN_MEMORY_DECISIONS,
      type: 'memory',
    };
  }
}

class RedisDecisionHistory {
  async append(decision: DecisionRecord): Promise<void> {
    maybeInjectFault('DECISION_WRITE_FAILURE');
    
    const redis = getRedisClient();
    
    if (!redis || !isRedisHealthy()) {
      logger.warn('decision_history_degraded', 'Redis unavailable, decision not persisted', {
        reviewId: decision.reviewId,
      });
      return;
    }

    try {
      const serialized = JSON.stringify(decision);
      await redis.lpush(REDIS_KEY, serialized);
      await redis.ltrim(REDIS_KEY, 0, MAX_REDIS_DECISIONS - 1);
    } catch (error) {
      logger.error('decision_history_error', 'Failed to append decision to Redis', {
        error: error instanceof Error ? error.message : 'Unknown error',
        reviewId: decision.reviewId,
      });
    }
  }

  async getRecent(limit: number = 50): Promise<DecisionRecord[]> {
    const redis = getRedisClient();
    
    if (!redis || !isRedisHealthy()) {
      return [];
    }

    try {
      const actualLimit = Math.min(limit, MAX_REDIS_DECISIONS);
      const serialized = await redis.lrange(REDIS_KEY, 0, actualLimit - 1);
      return serialized.map(s => JSON.parse(s) as DecisionRecord);
    } catch (error) {
      logger.error('decision_history_error', 'Failed to retrieve decisions from Redis', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  async getStats(): Promise<{ count: number; maxSize: number; type: 'redis' }> {
    const redis = getRedisClient();
    
    if (!redis || !isRedisHealthy()) {
      return { count: 0, maxSize: MAX_REDIS_DECISIONS, type: 'redis' };
    }

    try {
      const count = await redis.llen(REDIS_KEY);
      return {
        count,
        maxSize: MAX_REDIS_DECISIONS,
        type: 'redis',
      };
    } catch (error) {
      return { count: 0, maxSize: MAX_REDIS_DECISIONS, type: 'redis' };
    }
  }
}

class HybridDecisionHistory {
  private inMemory: InMemoryDecisionHistory;
  private redis: RedisDecisionHistory;
  private useRedis: boolean;

  constructor(useRedis: boolean) {
    this.inMemory = new InMemoryDecisionHistory();
    this.redis = new RedisDecisionHistory();
    this.useRedis = useRedis;
  }

  async append(decision: DecisionRecord): Promise<void> {
    try {
      this.inMemory.append(decision);
      
      if (this.useRedis) {
        await this.redis.append(decision);
      }
    } catch (error) {
      if (error instanceof FaultInjectionError) {
        logger.warn('fault_handling', 'Handling injected fault in decision history', {
          faultCode: error.faultCode,
        });
        throw error;
      }
      
      logger.error('decision_history_append_error', 'Failed to append decision', {
        error: error instanceof Error ? error.message : 'Unknown error',
        reviewId: decision.reviewId,
      });
    }
  }

  async getRecent(limit: number = 50): Promise<DecisionRecord[]> {
    if (this.useRedis && isRedisHealthy()) {
      return await this.redis.getRecent(limit);
    }
    return this.inMemory.getRecent(limit);
  }

  async getStats(): Promise<{ count: number; maxSize: number; type: 'memory' | 'redis' }> {
    if (this.useRedis && isRedisHealthy()) {
      return await this.redis.getStats();
    }
    return this.inMemory.getStats();
  }
}

export function createDecisionHistory(useRedis: boolean): HybridDecisionHistory {
  return new HybridDecisionHistory(useRedis);
}

export function sanitizeDecision(decision: DecisionRecord): SanitizedDecisionRecord {
  const { pr, ...rest } = decision;
  return {
    ...rest,
    pr: {
      repo: `${pr.owner}/${pr.repo}`,
      number: pr.number,
    },
  };
}