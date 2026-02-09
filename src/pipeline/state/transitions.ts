import { PipelineState, canTransition, isTerminalState } from './states.js';

export interface StateTransition {
  from: PipelineState;
  to: PipelineState;
  timestamp: string;
  reason?: string;
}

export interface TransitionResult {
  allowed: boolean;
  reason?: string;
}

export function validateTransition(
  from: PipelineState,
  to: PipelineState
): TransitionResult {
  // Terminal states cannot transition
  if (isTerminalState(from)) {
    return {
      allowed: false,
      reason: `Cannot transition from terminal state ${from}`,
    };
  }
  
  // Check if transition is in allowed set
  if (!canTransition(from, to)) {
    return {
      allowed: false,
      reason: `Invalid transition from ${from} to ${to}`,
    };
  }
  
  return { allowed: true };
}

export function createTransition(
  from: PipelineState,
  to: PipelineState,
  reason?: string
): StateTransition {
  return {
    from,
    to,
    timestamp: new Date().toISOString(),
    reason,
  };
}