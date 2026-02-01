import { AIReviewOutput } from './ai-types.js';

export interface QualityCheckResult {
  passed: boolean;
  reason?: string;
}

const BOILERPLATE_PHRASES = [
  'looks good',
  'lgtm',
  'no issues found',
  'code is fine',
  'seems okay',
  'appears correct',
  'looks fine to me',
];

const MIN_ASSESSMENT_LENGTH = 20;
const MIN_TOTAL_ITEMS = 1;

export function validateReviewQuality(review: AIReviewOutput): QualityCheckResult {
  const assessmentLower = review.assessment.toLowerCase();
  
  for (const phrase of BOILERPLATE_PHRASES) {
    if (assessmentLower.includes(phrase)) {
      return {
        passed: false,
        reason: `Boilerplate phrase detected: "${phrase}"`,
      };
    }
  }
  
  if (review.assessment.length < MIN_ASSESSMENT_LENGTH) {
    return {
      passed: false,
      reason: `Assessment too short: ${review.assessment.length} chars (min ${MIN_ASSESSMENT_LENGTH})`,
    };
  }
  
  const totalItems = 
    review.risks.length +
    review.assumptions.length +
    review.tradeoffs.length +
    review.failureModes.length +
    review.recommendations.length;
  
  if (totalItems < MIN_TOTAL_ITEMS) {
    return {
      passed: false,
      reason: `Insufficient detail: ${totalItems} total items (min ${MIN_TOTAL_ITEMS})`,
    };
  }
  
  if (review.verdict === 'safe' && review.risks.length > 0) {
    return {
      passed: false,
      reason: 'Verdict "safe" conflicts with risks identified',
    };
  }
  
  if (review.verdict === 'high_risk' && review.risks.length === 0) {
    return {
      passed: false,
      reason: 'Verdict "high_risk" but no risks identified',
    };
  }
  
  return { passed: true };
}