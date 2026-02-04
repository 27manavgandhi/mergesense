import { Request, Response } from 'express';
import crypto from 'crypto';
import { processPullRequest } from '../pipeline/orchestrator.js';
import { logger } from '../observability/logger.js';

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

function extractIdempotencyKey(body: any): string {
  const deliveryId = body.hook_id || 'unknown';
  const repoFullName = body.repository?.full_name || 'unknown';
  const prNumber = body.pull_request?.number || 0;
  const action = body.action || 'unknown';
  const headSha = body.pull_request?.head?.sha || 'unknown';
  
  return `${deliveryId}:${repoFullName}:${prNumber}:${action}:${headSha}`;
}

export async function webhookHandler(req: Request, res: Response, reviewId: string): Promise<void> {
  const signature = req.headers['x-hub-signature-256'] as string;
  const event = req.headers['x-github-event'] as string;
  const deliveryId = req.headers['x-github-delivery'] as string;

  if (!signature) {
    logger.warn('webhook_validation', 'Missing signature header');
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('webhook_validation', 'GITHUB_WEBHOOK_SECRET not configured');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  const payload = JSON.stringify(req.body);
  if (!verifySignature(payload, signature, secret)) {
    logger.warn('webhook_validation', 'Invalid signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  if (event !== 'pull_request') {
    logger.info('webhook_filtering', 'Non-PR event ignored', { event });
    res.status(200).json({ message: 'Event ignored' });
    return;
  }

  const action = req.body.action;
  if (action !== 'opened' && action !== 'synchronize') {
    logger.info('webhook_filtering', 'PR action ignored', { action });
    res.status(200).json({ message: 'Action ignored' });
    return;
  }

  const installationId = req.body.installation?.id;
  if (!installationId) {
    logger.error('webhook_validation', 'Missing installation ID in payload');
    res.status(400).json({ error: 'Missing installation ID' });
    return;
  }

  const pr = req.body.pull_request;
  const context = {
    owner: req.body.repository.owner.login,
    repo: req.body.repository.name,
    pull_number: pr.number,
    installation_id: installationId
  };

  const idempotencyKey = extractIdempotencyKey(req.body);

  logger.info('webhook_received', 'Webhook accepted', {
    deliveryId,
    idempotencyKey,
    action,
  });

  res.status(200).json({ message: 'Processing', reviewId, idempotencyKey });

  processPullRequest(context, reviewId, idempotencyKey).catch(err => {
    logger.error('pipeline_fatal', 'Unhandled pipeline error', {
      error: err instanceof Error ? err.message : 'Unknown error',
      stack: err instanceof Error ? err.stack : undefined,
    });
  });
}