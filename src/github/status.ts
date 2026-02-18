import type { Octokit } from '@octokit/rest';
import { logger } from '../observability/logger.js';

/**
 * Publish GitHub commit status check.
 * 
 * Used for merge policy enforcement.
 * When state='failure', GitHub blocks merge (if configured as required check).
 * 
 * No retry logic - relies on upstream error handling.
 * 
 * @param octokit - Authenticated GitHub client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param sha - Commit SHA
 * @param state - Status state (success or failure)
 * @param description - Status description
 */
export async function publishStatusCheck(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
  state: 'success' | 'failure',
  description: string
): Promise<void> {
  logger.info('status_check_publish', 'Publishing GitHub status check', {
    owner,
    repo,
    sha: sha.substring(0, 7),
    state,
    description,
  });

  await octokit.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    context: 'MergeSense Policy',
    description: description.substring(0, 140), // GitHub limit
  });

  logger.info('status_check_published', 'GitHub status check published successfully', {
    owner,
    repo,
    state,
  });
}