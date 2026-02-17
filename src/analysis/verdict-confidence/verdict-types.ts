export type UncertaintyLevel = 'LOW' | 'MODERATE' | 'HIGH';

export interface VerdictConfidence {
  verdict: 'safe' | 'safe_with_conditions' | 'requires_changes' | 'high_risk';
  confidence: number;                // 0-1
  uncertainty: UncertaintyLevel;
  manualReviewRecommended: boolean;
  alignmentWithRiskScore: 'aligned' | 'misaligned';
}