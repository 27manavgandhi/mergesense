import type { PipelineState } from '../pipeline/state/states.js';

export type InvariantSeverity = 'warn' | 'error' | 'fatal';

export type InvariantID = 
  | 'SEMAPHORE_PERMITS_NON_NEGATIVE'
  | 'SEMAPHORE_IN_FLIGHT_MATCHES_ACQUIRED'
  | 'AI_GATING_RESPECTED'
  | 'FALLBACK_ALWAYS_EXPLAINED'
  | 'DECISION_VERDICT_CONSISTENT'
  | 'DECISION_COMMENT_CONSISTENT'
  | 'METRICS_MATCH_DECISIONS'
  | 'IDEMPOTENCY_TTL_HONORED'
  | 'REDIS_MODE_CONSISTENT'
  | 'PIPELINE_PATH_VALID'
  // New state-based invariants
  | 'STATE_AI_INVOCATION_REQUIRES_PENDING'
  | 'STATE_COMMENT_REQUIRES_REVIEW_READY'
  | 'STATE_TERMINAL_NO_FURTHER_TRANSITIONS'
  | 'STATE_SILENT_EXIT_NO_AI';

export interface InvariantContext {
  // Semaphore context
  semaphorePermits?: number;
  semaphoreInFlight?: number;
  semaphoreMaxPermits?: number;
  
  // AI context
  aiGatingAllowed?: boolean;
  aiInvoked?: boolean;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  
  // Decision context
  verdict?: 'safe' | 'safe_with_conditions' | 'requires_changes' | 'high_risk';
  risks?: string[];
  commentPosted?: boolean;
  pipelinePath?: string;
  
  // Metrics context
  metricsAIInvoked?: number;
  decisionAIInvoked?: boolean;
  
  // Redis context
  redisEnabled?: boolean;
  redisHealthy?: boolean;
  instanceMode?: 'single-instance' | 'distributed' | 'degraded';
  
  // State machine context (NEW)
  currentState?: PipelineState;
  previousState?: PipelineState;
  isTerminalState?: boolean;
  aboutToInvokeAI?: boolean;
  aboutToPostComment?: boolean;
}

export interface InvariantDefinition {
  id: InvariantID;
  description: string;
  severity: InvariantSeverity;
  evaluate: (context: InvariantContext) => boolean;
}

export interface InvariantViolation {
  invariantId: InvariantID;
  description: string;
  severity: InvariantSeverity;
  context: InvariantContext;
  timestamp: string;
}

export interface InvariantCheckResult {
  passed: boolean;
  violations: InvariantViolation[];
}