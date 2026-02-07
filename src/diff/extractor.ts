import { Octokit } from '@octokit/rest';
import { PRContext, DiffFile } from '../types.js';
import { maybeInjectFault } from '../faults/injector.js';

const MAX_FILES = 50;
const MAX_CHANGES = 5000;

export async function extractDiff(octokit: Octokit, context: PRContext): Promise<DiffFile[]> {
  maybeInjectFault('DIFF_EXTRACTION_FAIL');

  const { data: files } = await octokit.pulls.listFiles({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.pull_number,
    per_page: 100,
  });

  if (files.length > MAX_FILES) {
    throw new Error(`PR exceeds maximum file limit: ${files.length} > ${MAX_FILES}`);
  }

  const totalChanges = files.reduce((sum, file) => sum + file.changes, 0);
  if (totalChanges > MAX_CHANGES) {
    throw new Error(`PR exceeds maximum changes limit: ${totalChanges} > ${MAX_CHANGES}`);
  }

  return files.map(file => ({
    filename: file.filename,
    status: file.status as 'added' | 'removed' | 'modified' | 'renamed',
    changes: file.changes,
    patch: file.patch || '',
  }));
}