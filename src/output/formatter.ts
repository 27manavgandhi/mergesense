import { ReviewOutput, FilterResult } from '../types.js';

export function formatReview(review: ReviewOutput, filterResult: FilterResult): string {
  const sections: string[] = [];

  sections.push('## MergeSense Review\n');

  sections.push('### High-Level Assessment');
  sections.push(review.assessment);
  sections.push('');

  if (review.risks.length > 0) {
    sections.push('### Key Engineering Risks');
    review.risks.forEach(risk => sections.push(`- ${risk}`));
    sections.push('');
  }

  if (review.assumptions.length > 0) {
    sections.push('### Assumptions Identified');
    review.assumptions.forEach(assumption => sections.push(`- ${assumption}`));
    sections.push('');
  }

  if (review.tradeoffs.length > 0) {
    sections.push('### Trade-offs Made');
    review.tradeoffs.forEach(tradeoff => sections.push(`- ${tradeoff}`));
    sections.push('');
  }

  if (review.failureModes.length > 0) {
    sections.push('### Failure Modes & Edge Cases');
    review.failureModes.forEach(mode => sections.push(`- ${mode}`));
    sections.push('');
  }

  if (review.recommendations.length > 0) {
    sections.push('### Recommendations');
    review.recommendations.forEach(rec => sections.push(`- ${rec}`));
    sections.push('');
  }

  sections.push('### Final Verdict');
  const verdictMap = {
    'safe': '✅ Safe to merge',
    'safe_with_conditions': '⚠️ Safe with conditions',
    'requires_changes': '❌ Requires changes before merge',
    'high_risk': '🚨 High risk — do not merge',
  };
  sections.push(verdictMap[review.verdict]);
  sections.push('');

  sections.push('---');
  sections.push(`_Analyzed ${filterResult.filesAnalyzed} files, ignored ${filterResult.filesIgnored} generated/lock files_`);

  return sections.join('\n');
}
