import { Request, Response } from 'express';
import crypto from 'crypto';
import { processPullRequest } from '../pipeline/orchestrator.js';

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-hub-signature-256'] as string;
  const event = req.headers['x-github-event'] as string;

  if (!signature) {
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error('GITHUB_WEBHOOK_SECRET not configured');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  const payload = JSON.stringify(req.body);
  if (!verifySignature(payload, signature, secret)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  if (event !== 'pull_request') {
    res.status(200).json({ message: 'Event ignored' });
    return;
  }

  const action = req.body.action;
  if (action !== 'opened' && action !== 'synchronize') {
    res.status(200).json({ message: 'Action ignored' });
    return;
  }

  const installationId = req.body.installation?.id;
  if (!installationId) {
    console.error('Missing installation ID in payload');
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

  res.status(200).json({ message: 'Processing' });

  processPullRequest(context).catch(err => {
    console.error('Pipeline error:', err);
  });
}
