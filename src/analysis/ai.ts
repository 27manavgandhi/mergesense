import { DiffFile, PreCheckResult, ReviewOutput, RiskSignal } from '../types.js';

function extractRisksFromSignal(category: string, signal: RiskSignal): string[] {
  if (!signal.detected) return [];

  const risks: string[] = [];
  const prefix = signal.confidence === 'high' ? '🔴' : signal.confidence === 'medium' ? '🟡' : '🟢';

  const categoryDescriptions: Record<string, string> = {
    publicAPI: 'Public API changes detected - breaking changes possible',
    stateMutation: 'State mutation patterns detected - race conditions possible',
    authentication: 'Authentication logic modified - security review required',
    persistence: 'Database operations detected - migration safety unclear',
    concurrency: 'Concurrency primitives detected - deadlock/race risk',
    errorHandling: 'Error handling gaps detected - silent failures possible',
    networking: 'Network operations added - timeout/retry logic unclear',
    dependencies: 'New dependencies added - supply chain risk',
    criticalPath: 'Critical path modified - failure impact high',
    securityBoundaries: 'Security boundaries modified - validation unclear',
  };

  const description = categoryDescriptions[category] || `${category} changes detected`;
  risks.push(`${prefix} ${description}`);

  if (signal.locations.length > 0) {
    risks.push(`   Files: ${signal.locations.slice(0, 3).join(', ')}`);
  }

  return risks;
}

function extractAssumptions(preChecks: PreCheckResult): string[] {
  const assumptions: string[] = [];

  if (preChecks.publicAPI.detected) {
    assumptions.push('API consumers can handle contract changes');
  }

  if (preChecks.authentication.detected) {
    assumptions.push('Authentication changes are backward compatible');
  }

  if (preChecks.persistence.detected) {
    assumptions.push('Database schema changes have migration path');
  }

  if (preChecks.concurrency.detected) {
    assumptions.push('Concurrent operations are properly synchronized');
  }

  if (preChecks.networking.detected) {
    assumptions.push('Network failures are handled gracefully');
  }

  if (preChecks.errorHandling.detected && preChecks.errorHandling.confidence === 'high') {
    assumptions.push('Empty catch blocks are intentional');
  }

  return assumptions;
}

function determineVerdict(preChecks: PreCheckResult): ReviewOutput['verdict'] {
  const entries = Object.entries(preChecks) as [string, RiskSignal][];
  
  const highRiskCount = entries.filter(([_, s]) => s.detected && s.confidence === 'high').length;
  const mediumRiskCount = entries.filter(([_, s]) => s.detected && s.confidence === 'medium').length;

  if (highRiskCount >= 3) {
    return 'high_risk';
  }

  if (highRiskCount >= 1 || mediumRiskCount >= 3) {
    return 'requires_changes';
  }

  if (mediumRiskCount >= 1) {
    return 'safe_with_conditions';
  }

  return 'safe';
}

export async function generateReview(
  files: DiffFile[],
  preChecks: PreCheckResult
): Promise<ReviewOutput> {
  const risks: string[] = [];
  const entries = Object.entries(preChecks) as [string, RiskSignal][];

  for (const [category, signal] of entries) {
    risks.push(...extractRisksFromSignal(category, signal));
  }

  const assumptions = extractAssumptions(preChecks);
  const verdict = determineVerdict(preChecks);

  const totalDetected = entries.filter(([_, s]) => s.detected).length;

  return {
    assessment: `Analyzed ${files.length} files, detected ${totalDetected} risk categories`,
    risks,
    assumptions,
    tradeoffs: [],
    failureModes: [],
    recommendations: risks.length > 0 ? ['Manual security review recommended'] : [],
    verdict,
  };
}
