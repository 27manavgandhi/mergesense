import type { PipelineState } from '../pipeline/state/states.js';
import type { DecisionPath } from '../decisions/types.js';

export type PostconditionSeverity = 'warn' | 'error' | 'fatal';

export type PostconditionID =
  | 'SUCCESS_REQUIRES_COMMENT'
  | 'SUCCESS_REQUIRES_VERDICT'
  | 'SILENT_EXIT_NO_COMMENT'
  | 'SILENT_EXIT_NO_AI'
  | 'MANUAL_WARNING_HAS_COMMENT'
  | 'FALLBACK_REQUIRES_REASON'
  | 'FALLBACK_REQUIRES_EXPLAINABLE_VERDICT'
  | 'AI_REVIEW_REQUIRES_AI_INVOCATION'
  | 'ERROR_PATH_NO_SUCCESS_STATE'
  | 'TERMINAL_STATE_REACHED'
  | 'COMMENT_POSTED_IMPLIES_REVIEW_READY_VISITED'
  | 'AI_INVOKED_IMPLIES_GATING_APPROVED'
  | 'STATE_HISTORY_NON_EMPTY'
  | 'DECISION_PATH_MATCHES_FINAL_STATE';

export interface PostconditionContext {
  // Final state
  finalState: PipelineState;
  isTerminal: boolean;
  
  // Decision path
  decisionPath: DecisionPath;
  
  // Outputs
  commentPosted: boolean;
  verdict?: 'safe' | 'safe_with_conditions' | 'requires_changes' | 'high_risk';
  
  // Execution details
  aiInvoked: boolean;
  aiBlocked: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
  
  // State history
  stateTransitions: Array<{ from: PipelineState; to: PipelineState }>;
  visitedStates: PipelineState[];
  
  // Pre-check results
  totalSignals: number;
  highConfidenceSignals: number;
}

export interface PostconditionDefinition {
  id: PostconditionID;
  description: string;
  severity: PostconditionSeverity;
  evaluate: (context: PostconditionContext) => boolean;
  rationale: string;
}

export interface PostconditionViolation {
  postconditionId: PostconditionID;
  description: string;
  severity: PostconditionSeverity;
  rationale: string;
  context: PostconditionContext;
  timestamp: string;
}

export interface PostconditionCheckResult {
  passed: boolean;
  violations: PostconditionViolation[];
  totalChecked: number;
}