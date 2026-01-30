import { Octokit } from '@octokit/rest';
import { PRContext, DiffFile } from '../types.js';

const MAX_FILES = 50;
const MAX_TOTAL_CHANGES = 5000;

export async function extractDiff(octokit: Octokit, context: PRContext): Promise<DiffFile[]> {
  const { data: files } = await octokit.pulls.listFiles({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.pull_number,
    per_page: 100,
  });

  if (files.length > MAX_FILES) {
    throw new Error(`PR too large: ${files.length} files (max ${MAX_FILES})`);
  }

  const totalChanges = files.reduce((sum, f) => sum + f.changes, 0);
  if (totalChanges > MAX_TOTAL_CHANGES) {
    throw new Error(`PR too large: ${totalChanges} changes (max ${MAX_TOTAL_CHANGES})`);
  }

  return files.map(f => ({
    filename: f.filename,
    status: f.status as DiffFile['status'],
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    patch: f.patch,
  }));
}
