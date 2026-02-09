import { PipelineState, isTerminalState, getStateMetadata } from './states.js';
import { StateTransition, validateTransition, createTransition } from './transitions.js';
import { IllegalStateTransitionError, TerminalStateViolationError } from './errors.js';
import { logger } from '../../observability/logger.js';

export class PipelineStateMachine {
  private currentState: PipelineState;
  private transitions: StateTransition[] = [];
  private readonly reviewId: string;

  constructor(reviewId: string, initialState: PipelineState = 'RECEIVED') {
    this.reviewId = reviewId;
    this.currentState = initialState;
    
    logger.info('state_machine_initialized', 'Pipeline state machine created', {
      reviewId,
      initialState,
    });
  }

  getCurrentState(): PipelineState {
    return this.currentState;
  }

  getTransitionHistory(): StateTransition[] {
    return [...this.transitions];
  }

  canTransitionTo(targetState: PipelineState): boolean {
    const result = validateTransition(this.currentState, targetState);
    return result.allowed;
  }

  transition(targetState: PipelineState, reason?: string): void {
    const validationResult = validateTransition(this.currentState, targetState);
    
    if (!validationResult.allowed) {
      const error = isTerminalState(this.currentState)
        ? new TerminalStateViolationError(this.currentState, targetState)
        : new IllegalStateTransitionError(this.currentState, targetState, validationResult.reason!);
      
      logger.error('illegal_state_transition', 'Illegal state transition attempted', {
        reviewId: this.reviewId,
        from: this.currentState,
        to: targetState,
        reason: validationResult.reason,
        transitionHistory: this.transitions.map(t => `${t.from}→${t.to}`),
      });
      
      throw error;
    }
    
    const transition = createTransition(this.currentState, targetState, reason);
    this.transitions.push(transition);
    
    const previousState = this.currentState;
    this.currentState = targetState;
    
    logger.info('state_transition', 'Pipeline state changed', {
      reviewId: this.reviewId,
      from: previousState,
      to: targetState,
      reason,
      isTerminal: isTerminalState(targetState),
    });
  }

  safeTransition(targetState: PipelineState, reason?: string): boolean {
    try {
      this.transition(targetState, reason);
      return true;
    } catch (error) {
      logger.warn('state_transition_failed', 'State transition failed, continuing with current state', {
        reviewId: this.reviewId,
        from: this.currentState,
        to: targetState,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  requireState(expectedStates: PipelineState[]): void {
    if (!expectedStates.includes(this.currentState)) {
      const metadata = getStateMetadata(this.currentState);
      logger.error('state_requirement_violation', 'Pipeline not in required state', {
        reviewId: this.reviewId,
        currentState: this.currentState,
        expectedStates,
        currentStateDescription: metadata.description,
      });
      throw new Error(`Expected state to be one of [${expectedStates.join(', ')}], but was ${this.currentState}`);
    }
  }

  isTerminal(): boolean {
    return isTerminalState(this.currentState);
  }

  getFinalState(): PipelineState | null {
    return this.isTerminal() ? this.currentState : null;
  }

  getStateHistorySummary(): string[] {
    return this.transitions.map(t => `${t.from}→${t.to}`);
  }
}