import { Octokit } from '@octokit/rest';
import { PRContext } from '../types.js';

export async function publishReview(
  octokit: Octokit,
  context: PRContext,
  body: string
): Promise<void> {
  await octokit.issues.createComment({
    owner: context.owner,
    repo: context.repo,
    issue_number: context.pull_number,
    body,
  });
}
