import express from 'express';
import dotenv from 'dotenv';
import { webhookHandler } from './webhook/handler.js';
import { logger, generateReviewId } from './observability/logger.js';
import { metrics } from './metrics/metrics.js';
import { getPricingModel } from './metrics/cost-model.js';
import { Semaphore } from './concurrency/semaphore.js';
import { CONCURRENCY_LIMITS, getConcurrencyLimits } from './concurrency/limits.js';

dotenv.config();

export const prSemaphore = new Semaphore(CONCURRENCY_LIMITS.MAX_CONCURRENT_PR_PIPELINES);
export const aiSemaphore = new Semaphore(CONCURRENCY_LIMITS.MAX_CONCURRENT_AI_CALLS);

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

app.get('/metrics', (_req, res) => {
  try {
    const snapshot = metrics.snapshot(prSemaphore, aiSemaphore);
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

app.listen(PORT, () => {
  console.log(`MergeSense listening on port ${PORT}`);
  console.log(`Concurrency limits: PR pipelines=${CONCURRENCY_LIMITS.MAX_CONCURRENT_PR_PIPELINES}, AI calls=${CONCURRENCY_LIMITS.MAX_CONCURRENT_AI_CALLS}`);
});