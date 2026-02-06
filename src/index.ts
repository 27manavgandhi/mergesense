import express from 'express';
import dotenv from 'dotenv';
import { webhookHandler } from './webhook/handler.js';
import { logger, generateReviewId } from './observability/logger.js';
import { metrics } from './metrics/metrics.js';
import { getPricingModel } from './metrics/cost-model.js';
import { InMemorySemaphore, RedisSemaphore } from './concurrency/semaphore.js';
import { CONCURRENCY_LIMITS, getConcurrencyLimits } from './concurrency/limits.js';
import { initializeRedis, getRedisClient, shutdownRedis, isRedisHealthy } from './persistence/redis-client.js';
import { idempotencyGuard } from './idempotency/guard.js';
import { createDecisionHistory, sanitizeDecision } from './decisions/history.js';
import type { DistributedSemaphore } from './persistence/types.js';

dotenv.config();

initializeRedis(process.env.REDIS_URL);

const redisEnabled = !!process.env.REDIS_URL;
const redis = getRedisClient();

export let prSemaphore: DistributedSemaphore;
export let aiSemaphore: DistributedSemaphore;
export const decisionHistory = createDecisionHistory(redisEnabled);

if (redis) {
  prSemaphore = new RedisSemaphore('pr', CONCURRENCY_LIMITS.MAX_CONCURRENT_PR_PIPELINES);
  aiSemaphore = new RedisSemaphore('ai', CONCURRENCY_LIMITS.MAX_CONCURRENT_AI_CALLS);
  logger.info('semaphore_initialization', 'Using Redis-backed semaphores');
} else {
  prSemaphore = new InMemorySemaphore(CONCURRENCY_LIMITS.MAX_CONCURRENT_PR_PIPELINES);
  aiSemaphore = new InMemorySemaphore(CONCURRENCY_LIMITS.MAX_CONCURRENT_AI_CALLS);
  logger.info('semaphore_initialization', 'Using in-memory semaphores');
}

export function instanceMode(): 'single-instance' | 'distributed' | 'degraded' {
  if (!redisEnabled) return 'single-instance';
  return isRedisHealthy() ? 'distributed' : 'degraded';
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.post('/webhook', async (req, res, next) => {
  const reviewId = generateReviewId();
  
  logger.setContext({
    reviewId,
    owner: req.body?.repository?.owner?.login,
    repo: req.body?.repository?.name,
    pullNumber: req.body?.pull_request?.number,
  });
  
  try {
    await webhookHandler(req, res, reviewId);
  } catch (error) {
    logger.error('webhook_error', 'Unhandled webhook error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    next(error);
  } finally {
    logger.clearContext();
  }
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/metrics', async (_req, res) => {
  try {
    const snapshot = await metrics.snapshot(prSemaphore, aiSemaphore, idempotencyGuard, redisEnabled);
    const pricing = getPricingModel();
    const limits = getConcurrencyLimits();
    
    res.status(200).json({
      ...snapshot,
      pricing,
      limits,
    });
  } catch (error) {
    logger.error('metrics_error', 'Failed to generate metrics snapshot', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

app.get('/decisions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const actualLimit = Math.min(Math.max(1, limit), 100);
    
    const decisions = await decisionHistory.getRecent(actualLimit);
    const sanitized = decisions.map(sanitizeDecision);
    const stats = await decisionHistory.getStats();
    
    res.status(200).json({
      decisions: sanitized,
      meta: {
        count: sanitized.length,
        limit: actualLimit,
        total: stats.count,
        maxSize: stats.maxSize,
        storageType: stats.type,
      },
    });
  } catch (error) {
    logger.error('decisions_error', 'Failed to retrieve decision history', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ error: 'Failed to retrieve decisions' });
  }
});

const server = app.listen(PORT, () => {
  const mode = redis ? 'distributed (Redis)' : 'single-instance (in-memory)';
  console.log(`MergeSense listening on port ${PORT}`);
  console.log(`Mode: ${mode}`);
  console.log(`Concurrency limits: PR pipelines=${CONCURRENCY_LIMITS.MAX_CONCURRENT_PR_PIPELINES}, AI calls=${CONCURRENCY_LIMITS.MAX_CONCURRENT_AI_CALLS}`);
});

process.on('SIGTERM', async () => {
  logger.info('shutdown', 'SIGTERM received, graceful shutdown');
  server.close(async () => {
    await shutdownRedis();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('shutdown', 'SIGINT received, graceful shutdown');
  server.close(async () => {
    await shutdownRedis();
    process.exit(0);
  });
});