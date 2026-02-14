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
import { faultController } from './faults/controller.js';
import { initializeContract, getActiveContract } from './contracts/registry.js';
import { enforceContract } from './contracts/validator.js';
import { ContractMismatchError } from './contracts/types.js';
import type { DistributedSemaphore } from './persistence/types.js';
import { verifyDecisionProof } from './attestation/verifier.js';
import { ProofVerificationError } from './attestation/types.js';
import { getMerkleRoot } from './merkle/merkle-builder.js';
import { generateMerkleProof } from './merkle/merkle-proof.js';
import { verifyMerkleProofRequest } from './merkle/merkle-validator.js';
import { MerkleTreeError } from './merkle/merkle-types.js';
import type { MerkleVerificationRequest } from './merkle/merkle-types.js';

dotenv.config();

// Initialize and validate execution contract FIRST
try {
  initializeContract();
  enforceContract();
  
  const contract = getActiveContract();
  console.log(`✓ Execution contract validated`);
  console.log(`  Version: ${contract.version}`);
  console.log(`  Hash: ${contract.contractHash}`);
  console.log(`  States: ${contract.fsmSchema.stateCount}`);
  console.log(`  Invariants: ${contract.invariantSchema.invariantCount}`);
  console.log(`  Postconditions: ${contract.postconditionSchema.postconditionCount}`);
} catch (error) {
  if (error instanceof ContractMismatchError) {
    console.error('
❌ FATAL: Execution contract mismatch detected');
    console.error('
Contract validation failed. The system cannot start.');
    console.error('
Errors:');
    error.errors.forEach(e => {
      console.error(`  [${e.severity.toUpperCase()}] ${e.code}: ${e.message}`);
      if (e.detail) {
        console.error(`    Detail:`, JSON.stringify(e.detail, null, 2));
      }
    });
    console.error('
Expected hash:', error.expectedHash);
    console.error('Current hash:', error.currentHash);
    console.error('
ACTION REQUIRED:');
    console.error('  1. Review the errors above');
    console.error('  2. If intentional, increment contract version in src/contracts/version.ts');
    console.error('  3. Document the change in CONTRACT_CHANGELOG');
    console.error('  4. If unintentional, revert the breaking changes');
    process.exit(1);
  }
  throw error;
}

faultController.initialize();

if (faultController.isEnabled()) {
  logger.info('faults_initialization', '⚠️  FAULT INJECTION ENABLED - CHAOS SAFETY MODE', {
    config: faultController.getConfig(),
  });
}

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
app.get('/verify/:reviewId', async (req, res) => {
  const { reviewId } = req.params;
  
  try {
    logger.info('proof_verification_request', 'Verifying execution proof', {
      reviewId,
    });
    
    // Find decision in history
    const decisions = await decisionHistory.getRecent(100);
    const decision = decisions.find(d => d.reviewId === reviewId);
    
    if (!decision) {
      return res.status(404).json({
        error: 'Decision not found',
        reviewId,
      });
    }
    
    // Verify proof
    const verificationResult = verifyDecisionProof(decision);
    
    if (!verificationResult.valid) {
      logger.warn('proof_verification_failed', 'Execution proof verification failed', {
        reviewId,
        reason: verificationResult.reason,
      });
      
      return res.status(409).json({
        ...verificationResult,
        error: 'Proof verification failed',
      });
    }
    
    logger.info('proof_verification_success', 'Execution proof verified', {
      reviewId,
    });
    
    return res.status(200).json(verificationResult);
    
  } catch (error) {
    if (error instanceof ProofVerificationError) {
      logger.error('proof_verification_error', 'Proof verification error', {
        reviewId: error.reviewId,
        error: error.message,
      });
      
      return res.status(500).json({
        error: 'Proof verification error',
        reviewId: error.reviewId,
        message: error.message,
      });
    }
    
    logger.error('verify_endpoint_error', 'Unexpected error in verify endpoint', {
      reviewId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    return res.status(500).json({
      error: 'Internal server error',
      reviewId,
    });
  }
});

app.get('/merkle/root', async (_req, res) => {
  try {
    logger.info('merkle_root_request', 'Computing Merkle root');
    
    // Get all decisions
    const decisions = await decisionHistory.getRecent(1000);
    
    if (decisions.length === 0) {
      return res.status(404).json({
        error: 'No decisions available',
        reason: 'Cannot compute Merkle root from empty decision set',
      });
    }
    
    // Extract execution proof hashes in chronological order (oldest first)
    const chronological = [...decisions].reverse();
    const leafHashes = chronological.map(d => d.executionProofHash);
    
    // Compute Merkle root
    const root = getMerkleRoot(leafHashes);
    
    logger.info('merkle_root_computed', 'Merkle root computed', {
      root: root.substring(0, 16) + '...',
      leafCount: leafHashes.length,
    });
    
    return res.status(200).json({
      root,
      leafCount: leafHashes.length,
      algorithm: 'sha256-merkle-v1',
    });
    
  } catch (error) {
    if (error instanceof MerkleTreeError) {
      logger.error('merkle_root_error', 'Merkle root computation error', {
        error: error.message,
      });
      
      return res.status(400).json({
        error: 'Merkle root computation failed',
        message: error.message,
      });
    }
    
    logger.error('merkle_root_endpoint_error', 'Unexpected error in merkle root endpoint', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

app.get('/merkle/proof/:reviewId', async (req, res) => {
  const { reviewId } = req.params;
  
  try {
    logger.info('merkle_proof_request', 'Generating Merkle proof', {
      reviewId,
    });
    
    // Get all decisions
    const decisions = await decisionHistory.getRecent(1000);
    
    if (decisions.length === 0) {
      return res.status(404).json({
        error: 'No decisions available',
        reviewId,
      });
    }
    
    // Find decision index (chronological order)
    const chronological = [...decisions].reverse();
    const index = chronological.findIndex(d => d.reviewId === reviewId);
    
    if (index === -1) {
      return res.status(404).json({
        error: 'Decision not found',
        reviewId,
      });
    }
    
    const decision = chronological[index];
    
    // Extract execution proof hashes
    const leafHashes = chronological.map(d => d.executionProofHash);
    
    // Generate proof
    const proof = generateMerkleProof(leafHashes, index);
    
    // Compute root
    const root = getMerkleRoot(leafHashes);
    
    logger.info('merkle_proof_generated', 'Merkle proof generated', {
      reviewId,
      proofSteps: proof.length,
      root: root.substring(0, 16) + '...',
    });
    
    return res.status(200).json({
      reviewId,
      executionProofHash: decision.executionProofHash,
      proof,
      root,
      algorithm: 'sha256-merkle-v1',
    });
    
  } catch (error) {
    if (error instanceof MerkleTreeError) {
      logger.error('merkle_proof_error', 'Merkle proof generation error', {
        reviewId,
        error: error.message,
      });
      
      return res.status(400).json({
        error: 'Merkle proof generation failed',
        reviewId,
        message: error.message,
      });
    }
    
    logger.error('merkle_proof_endpoint_error', 'Unexpected error in merkle proof endpoint', {
      reviewId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    return res.status(500).json({
      error: 'Internal server error',
      reviewId,
    });
  }
});

app.post('/merkle/verify', async (req, res) => {
  try {
    const request: MerkleVerificationRequest = req.body;
    
    if (!request.leafHash || !request.proof || !request.root) {
      return res.status(400).json({
        error: 'Invalid request',
        reason: 'Missing required fields: leafHash, proof, root',
      });
    }
    
    logger.info('merkle_verify_request', 'Verifying Merkle proof', {
      leafHash: request.leafHash.substring(0, 16) + '...',
      proofSteps: request.proof.length,
      root: request.root.substring(0, 16) + '...',
    });
    
    // Verify proof
    const result = verifyMerkleProofRequest(request);
    
    if (!result.valid) {
      logger.warn('merkle_verify_failed', 'Merkle proof verification failed', {
        reason: result.reason,
      });
      
      return res.status(409).json({
        ...result,
        error: 'Proof verification failed',
      });
    }
    
    logger.info('merkle_verify_success', 'Merkle proof verified successfully');
    
    return res.status(200).json(result);
    
  } catch (error) {
    logger.error('merkle_verify_endpoint_error', 'Unexpected error in merkle verify endpoint', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});
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
      faults: {
        enabled: faultController.isEnabled(),
        config: faultController.isEnabled() ? faultController.getConfig() : null,
      },
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
  const contract = getActiveContract();
  
  console.log(`MergeSense listening on port ${PORT}`);
  console.log(`Mode: ${mode}`);
  console.log(`Contract: ${contract.version} (${contract.contractHash})`);
  console.log(`Concurrency limits: PR pipelines=${CONCURRENCY_LIMITS.MAX_CONCURRENT_PR_PIPELINES}, AI calls=${CONCURRENCY_LIMITS.MAX_CONCURRENT_AI_CALLS}`);
  if (faultController.isEnabled()) {
    console.log('⚠️  FAULT INJECTION ENABLED - CHAOS SAFETY MODE');
  }
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