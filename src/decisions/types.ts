import { PreCheckResult } from '../types.js';
import type { InvariantViolation } from '../invariants/types.js';
import type { PipelineState } from '../pipeline/state/states.js';

export type DecisionPath = 
  | 'ai_review'
  | 'silent_exit_safe'
  | 'silent_exit_filtered'
  | 'manual_review_warning'
  | 'ai_fallback_error'
  | 'ai_fallback_quality'
  | 'error_diff_extraction'
  | 'error_size_limit';

export interface DecisionRecord {
  reviewId: string;
  timestamp: string;
  pr: {
    owner: string;
    repo: string;
    number: number;
  };
  path: DecisionPath;
  aiInvoked: boolean;
  aiBlocked: boolean;
  aiBlockedReason?: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  preCheckSummary: {
    totalSignals: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    criticalCategories: string[];
  };
  verdict?: 'safe' | 'safe_with_conditions' | 'requires_changes' | 'high_risk';
  commentPosted: boolean;
  processingTimeMs: number;
  instanceMode: 'single-instance' | 'distributed' | 'degraded';
  faultsInjected?: string[];
  invariantViolations?: {
    total: number;
    warn: number;
    error: number;
    fatal: number;
    violations: Array<{
      invariantId: string;
      severity: string;
      description: string;
    }>;
  };
  stateHistory?: {
    transitions: Array<{
      from: string;
      to: string;
      timestamp: string;
    }>;
    finalState: PipelineState;
    totalTransitions: number;
  };
  postconditions?: {
    totalChecked: number;
    passed: boolean;
    violations: {
      total: number;
      warn: number;
      error: number;
      fatal: number;
      details: Array<{
        postconditionId: string;
        severity: string;
        description: string;
        rationale: string;
      }>;
    };
  };
  formallyValid?: boolean;
  contractVersion: string;
  contractHash: string;
  contractValid: boolean;
}

export interface SanitizedDecisionRecord extends Omit<DecisionRecord, 'pr'> {
  pr: {
    repo: string;
    number: number;
  };
}