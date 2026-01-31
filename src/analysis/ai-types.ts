import { PreCheckResult, RiskSignal } from '../types.js';

export interface AIReviewInput {
  fileCount: number;
  totalChanges: number;
  riskSignals: PreCheckResult;
  criticalCategories: string[];
  highConfidenceCount: number;
  mediumConfidenceCount: number;
}

export interface AIReviewOutput {
  assessment: string;
  risks: string[];
  assumptions: string[];
  tradeoffs: string[];
  failureModes: string[];
  recommendations: string[];
  verdict: 'safe' | 'safe_with_conditions' | 'requires_changes' | 'high_risk';
}

export interface ClaudeAPIResponse {
  content: Array<{
    type: string;
    text?: string;
  }>;
  stop_reason: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AIValidationError {
  field: string;
  reason: string;
}

export class AIResponseValidationError extends Error {
  constructor(public errors: AIValidationError[]) {
    super(`AI response validation failed: ${errors.map(e => e.field).join(', ')}`);
    this.name = 'AIResponseValidationError';
  }
}