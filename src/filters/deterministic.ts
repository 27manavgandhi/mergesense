import { DiffFile, FilterResult } from '../types.js';

const IGNORED_PATTERNS = [
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^Gemfile\.lock$/,
  /^Cargo\.lock$/,
  /^poetry\.lock$/,
  /^go\.sum$/,
  /\.min\.js$/,
  /\.min\.css$/,
  /^dist\//,
  /^build\//,
  /^vendor\//,
  /^node_modules\//,
  /\.generated\./,
  /\.pb\.go$/,
  /\.pb\.ts$/,
  /_pb2\.py$/,
];

const IGNORED_EXTENSIONS = [
  '.snap',
  '.lock',
  '.sum',
];

function shouldIgnoreFile(filename: string): boolean {
  if (IGNORED_PATTERNS.some(pattern => pattern.test(filename))) {
    return true;
  }

  if (IGNORED_EXTENSIONS.some(ext => filename.endsWith(ext))) {
    return true;
  }

  return false;
}

export function filterDiff(files: DiffFile[]): FilterResult {
  const filtered = files.filter(f => !shouldIgnoreFile(f.filename));

  if (filtered.length === 0) {
    return {
      passed: false,
      reason: 'All files ignored (lock files, generated code, etc.)',
      filesAnalyzed: 0,
      filesIgnored: files.length,
    };
  }

  const meaningfulChanges = filtered.filter(f => f.patch && f.patch.trim().length > 0);

  if (meaningfulChanges.length === 0) {
    return {
      passed: false,
      reason: 'No meaningful code changes detected',
      filesAnalyzed: 0,
      filesIgnored: files.length,
    };
  }

  return {
    passed: true,
    filesAnalyzed: meaningfulChanges.length,
    filesIgnored: files.length - meaningfulChanges.length,
  };
}
