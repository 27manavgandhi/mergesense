import type { DiffFile, PreCheckResult } from '../../types.js';
import type { PRContextSummary } from './chunk-types.js';

/**
 * Aggregate PR-level context metadata.
 * 
 * Extracts:
 * - Modified modules
 * - New dependencies
 * - Critical path touches
 * - Security-sensitive files
 * - API surface changes
 * - State mutation detection
 */
export function aggregatePRContext(
  files: DiffFile[],
  preChecks: PreCheckResult
): PRContextSummary {
  const modifiedModules = new Set<string>();
  const securitySensitiveFiles: string[] = [];
  let newDependencies: string[] = [];
  let criticalPathsTouched = false;
  let apiSurfaceChanged = false;
  let stateMutationDetected = false;

  for (const file of files) {
    const filePath = file.filename.toLowerCase();

    // Extract module name
    const parts = file.filename.split('/');
    if (parts.length > 1) {
      modifiedModules.add(parts[0]);
    }

    // Security-sensitive files
    if (filePath.includes('auth') || 
        filePath.includes('security') || 
        filePath.includes('crypto') ||
        filePath.includes('password')) {
      securitySensitiveFiles.push(file.filename);
    }

    // Critical paths
    if (filePath.includes('index.ts') || 
        filePath.includes('main.ts') || 
        filePath.includes('server.ts') ||
        filePath.includes('orchestrator')) {
      criticalPathsTouched = true;
    }

    // API surface
    if (filePath.includes('api') || 
        filePath.includes('endpoint') || 
        filePath.includes('route') ||
        filePath.includes('handler')) {
      apiSurfaceChanged = true;
    }

    // package.json changes
    if (filePath === 'package.json' && file.patch) {
      const addedLines = file.patch.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
      newDependencies = addedLines
        .filter(l => l.includes('"'))
        .map(l => l.match(/"([^"]+)":/)?.[1])
        .filter((dep): dep is string => !!dep);
    }
  }

  // State mutation detection from pre-checks
  stateMutationDetected = 
    preChecks.persistence.length > 0 ||
    preChecks.stateMutation.length > 0;

  return {
    modifiedModules: Array.from(modifiedModules),
    newDependencies,
    criticalPathsTouched,
    securitySensitiveFiles,
    apiSurfaceChanged,
    stateMutationDetected,
  };
}