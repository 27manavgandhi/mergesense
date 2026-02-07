import { Octokit } from '@octokit/rest';
import { PRContext } from '../types.js';
import { maybeInjectFault } from '../faults/injector.js';

export async function publishReview(
  octokit: Octokit,
  context: PRContext,
  body: string
): Promise<void> {
  maybeInjectFault('PUBLISH_COMMENT_FAILURE');
  
  await octokit.issues.createComment({
    owner: context.owner,
    repo: context.repo,
    issue_number: context.pull_number,
    body,
  });
}