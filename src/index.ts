import express from 'express';
import dotenv from 'dotenv';
import { webhookHandler } from './webhook/handler.js';
import { logger, generateReviewId } from './observability/logger.js';

dotenv.config();

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

app.listen(PORT, () => {
  console.log(`MergeSense listening on port ${PORT}`);
});