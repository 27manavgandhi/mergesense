import { PreCheckResult, RiskSignal } from '../types.js';

export interface RiskAnalysis {
  totalSignals: number;
  highConfidenceSignals: number;
  mediumConfidenceSignals: number;
  lowConfidenceSignals: number;
  criticalCategories: string[];
  safeToSkipAI: boolean;
  requiresManualReview: boolean;
}

export function analyzeRiskSignals(preChecks: PreCheckResult): RiskAnalysis {
  const entries = Object.entries(preChecks) as [string, RiskSignal][];
  
  let totalSignals = 0;
  let highConfidenceSignals = 0;
  let mediumConfidenceSignals = 0;
  let lowConfidenceSignals = 0;
  const criticalCategories: string[] = [];

  for (const [category, signal] of entries) {
    if (signal.detected) {
      totalSignals++;
      
      if (signal.confidence === 'high') {
        highConfidenceSignals++;
        criticalCategories.push(category);
      } else if (signal.confidence === 'medium') {
        mediumConfidenceSignals++;
      } else {
        lowConfidenceSignals++;
      }
    }
  }

  const safeToSkipAI = highConfidenceSignals === 0 && mediumConfidenceSignals === 0;
  const requiresManualReview = highConfidenceSignals > 5;

  return {
    totalSignals,
    highConfidenceSignals,
    mediumConfidenceSignals,
    lowConfidenceSignals,
    criticalCategories,
    safeToSkipAI,
    requiresManualReview,
  };
}

export function formatRiskSummary(preChecks: PreCheckResult, analysis: RiskAnalysis): string {
  const lines: string[] = [];

  lines.push('## Pre-Check Analysis');
  lines.push('');
  lines.push(`**Total Risk Signals**: ${analysis.totalSignals}`);
  lines.push(`**High Confidence**: ${analysis.highConfidenceSignals}`);
  lines.push(`**Medium Confidence**: ${analysis.mediumConfidenceSignals}`);
  lines.push(`**Low Confidence**: ${analysis.lowConfidenceSignals}`);
  lines.push('');

  if (analysis.criticalCategories.length > 0) {
    lines.push('### Critical Categories Detected');
    for (const category of analysis.criticalCategories) {
      const signal = preChecks[category as keyof PreCheckResult];
      lines.push(`**${category}**:`);
      if (signal.locations.length > 0) {
        lines.push(`- Files: ${signal.locations.slice(0, 3).join(', ')}`);
      }
      if (signal.details.length > 0) {
        lines.push(`- Examples: ${signal.details.slice(0, 2).join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
