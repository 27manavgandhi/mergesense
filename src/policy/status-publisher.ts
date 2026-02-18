import { POLICY_CONFIG } from './policy-config.js';
import { publishStatusCheck } from '../github/status.js';
import type { MergePolicyResult } from './policy-types.js';
import type { Octokit } from '@octokit/rest';
import { logger } from '../observability/logger.js';

/**
 * Handle policy status check publication based on mode.
 * 
 * Modes:
 * - OFF: No status check published
 * - WARN: Always success, but shows warning in description if violated
 * - ENFORCE: Success if allowed, failure if violated (blocks merge)
 * 
 * @param octokit - Authenticated GitHub client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param sha - Commit SHA
 * @param result - Policy evaluation result
 */
export async function handlePolicyStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
  result: MergePolicyResult
): Promise<void> {
  if (POLICY_CONFIG.mode === 'OFF') {
    logger.info('policy_status_skipped', 'Policy mode OFF, no status check published');
    return;
  }

  if (POLICY_CONFIG.mode === 'WARN') {
    const description = result.violated
      ? `⚠️ Policy warning: ${result.reasons.join('; ')}`
      : '✅ Policy passed';

    await publishStatusCheck(octokit, owner, repo, sha, 'success', description);
    return;
  }

  if (POLICY_CONFIG.mode === 'ENFORCE') {
    const state = result.allowed ? 'success' : 'failure';
    const description = result.allowed
      ? '✅ Policy passed'
      : `❌ Policy violation: ${result.reasons.join('; ')}`;

    await publishStatusCheck(octokit, owner, repo, sha, state, description);

    if (!result.allowed) {
      logger.warn('policy_enforced_block', 'Merge blocked by policy enforcement', {
        owner,
        repo,
        reasons: result.reasons,
      });
    }
  }
}