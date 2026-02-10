import { PostconditionDefinition, PostconditionContext, PostconditionID } from './types.js';

const POSTCONDITIONS: Record<PostconditionID, PostconditionDefinition> = {
  SUCCESS_REQUIRES_COMMENT: {
    id: 'SUCCESS_REQUIRES_COMMENT',
    description: 'Successful completion must include a posted comment',
    severity: 'fatal',
    rationale: 'COMPLETED_SUCCESS means we delivered value to the user; value = visible review comment',
    evaluate: (ctx: PostconditionContext) => {
      if (ctx.finalState !== 'COMPLETED_SUCCESS') return true;
      return ctx.commentPosted === true;
    },
  },

  SUCCESS_REQUIRES_VERDICT: {
    id: 'SUCCESS_REQUIRES_VERDICT',
    description: 'Successful completion must include a verdict',
    severity: 'fatal',
    rationale: 'Success implies we made a review decision; decision requires verdict',
    evaluate: (ctx: PostconditionContext) => {
      if (ctx.finalState !== 'COMPLETED_SUCCESS') return true;
      return ctx.verdict !== undefined;
    },
  },

  SILENT_EXIT_NO_COMMENT: {
    id: 'SILENT_EXIT_NO_COMMENT',
    description: 'Silent exit must not post a comment',
    severity: 'fatal',
    rationale: 'COMPLETED_SILENT means no action needed; comment contradicts this',
    evaluate: (ctx: PostconditionContext) => {
      if (ctx.finalState !== 'COMPLETED_SILENT') return true;
      return ctx.commentPosted === false;
    },
  },

  SILENT_EXIT_NO_AI: {
    id: 'SILENT_EXIT_NO_AI',
    description: 'Silent exit must not have invoked AI',
    severity: 'error',
    rationale: 'Silent means deterministically safe; AI invocation contradicts this',
    evaluate: (ctx: PostconditionContext) => {
      if (ctx.finalState !== 'COMPLETED_SILENT') return true;
      return ctx.aiInvoked === false;
    },
  },

  MANUAL_WARNING_HAS_COMMENT: {
    id: 'MANUAL_WARNING_HAS_COMMENT',
    description: 'Manual review warning must post a comment',
    severity: 'fatal',
    rationale: 'Warning path exists to notify user; notification requires comment',
    evaluate: (ctx: PostconditionContext) => {
      if (ctx.decisionPath !== 'manual_review_warning') return true;
      return ctx.commentPosted === true;
    },
  },

  FALLBACK_REQUIRES_REASON: {
    id: 'FALLBACK_REQUIRES_REASON',
    description: 'Fallback usage must have an explicit reason',
    severity: 'fatal',
    rationale: 'Fallback is a degradation; degradation requires explanation',
    evaluate: (ctx: PostconditionContext) => {
      if (!ctx.fallbackUsed) return true;
      return ctx.fallbackReason !== undefined && ctx.fallbackReason.length > 0;
    },
  },

  FALLBACK_REQUIRES_EXPLAINABLE_VERDICT: {
    id: 'FALLBACK_REQUIRES_EXPLAINABLE_VERDICT',
    description: 'Fallback review must produce a verdict',
    severity: 'error',
    rationale: 'Fallback still provides review; review requires verdict',
    evaluate: (ctx: PostconditionContext) => {
      if (!ctx.fallbackUsed) return true;
      return ctx.verdict !== undefined;
    },
  },

  AI_REVIEW_REQUIRES_AI_INVOCATION: {
    id: 'AI_REVIEW_REQUIRES_AI_INVOCATION',
    description: 'AI review path must have invoked AI (or used fallback)',
    severity: 'fatal',
    rationale: 'Path labeled "ai_review" means AI participated; absence is contradiction',
    evaluate: (ctx: PostconditionContext) => {
      if (ctx.decisionPath !== 'ai_review' && 
          !ctx.decisionPath.startsWith('ai_fallback')) return true;
      return ctx.aiInvoked === true || ctx.fallbackUsed === true;
    },
  },

  ERROR_PATH_NO_SUCCESS_STATE: {
    id: 'ERROR_PATH_NO_SUCCESS_STATE',
    description: 'Error paths must not end in COMPLETED_SUCCESS',
    severity: 'fatal',
    rationale: 'Error path means failure occurred; success contradicts this',
    evaluate: (ctx: PostconditionContext) => {
      const errorPaths: DecisionPath[] = ['error_diff_extraction', 'error_size_limit'];
      if (!errorPaths.includes(ctx.decisionPath)) return true;
      return ctx.finalState !== 'COMPLETED_SUCCESS';
    },
  },

  TERMINAL_STATE_REACHED: {
    id: 'TERMINAL_STATE_REACHED',
    description: 'Pipeline must reach a terminal state',
    severity: 'fatal',
    rationale: 'Non-terminal final state means incomplete execution',
    evaluate: (ctx: PostconditionContext) => {
      return ctx.isTerminal === true;
    },
  },

  COMMENT_POSTED_IMPLIES_REVIEW_READY_VISITED: {
    id: 'COMMENT_POSTED_IMPLIES_REVIEW_READY_VISITED',
    description: 'Posted comment must have passed through REVIEW_READY state',
    severity: 'error',
    rationale: 'Comment posting requires content; content prepared in REVIEW_READY',
    evaluate: (ctx: PostconditionContext) => {
      if (!ctx.commentPosted) return true;
      return ctx.visitedStates.includes('REVIEW_READY');
    },
  },

  AI_INVOKED_IMPLIES_GATING_APPROVED: {
    id: 'AI_INVOKED_IMPLIES_GATING_APPROVED',
    description: 'AI invocation must have been preceded by gating approval',
    severity: 'fatal',
    rationale: 'Gating exists to control AI usage; bypass is correctness violation',
    evaluate: (ctx: PostconditionContext) => {
      if (!ctx.aiInvoked) return true;
      return ctx.visitedStates.includes('AI_APPROVED');
    },
  },

  STATE_HISTORY_NON_EMPTY: {
    id: 'STATE_HISTORY_NON_EMPTY',
    description: 'State transition history must not be empty',
    severity: 'fatal',
    rationale: 'Empty history means no execution occurred',
    evaluate: (ctx: PostconditionContext) => {
      return ctx.stateTransitions.length > 0;
    },
  },

  DECISION_PATH_MATCHES_FINAL_STATE: {
    id: 'DECISION_PATH_MATCHES_FINAL_STATE',
    description: 'Decision path must be consistent with final state',
    severity: 'error',
    rationale: 'Path and state must tell the same story',
    evaluate: (ctx: PostconditionContext) => {
      // Silent exits
      if (ctx.decisionPath === 'silent_exit_safe' || ctx.decisionPath === 'silent_exit_filtered') {
        return ctx.finalState === 'COMPLETED_SILENT';
      }
      
      // Success paths
      if (ctx.decisionPath === 'ai_review' || 
          ctx.decisionPath === 'ai_fallback_error' || 
          ctx.decisionPath === 'ai_fallback_quality' ||
          ctx.decisionPath === 'manual_review_warning') {
        return ctx.finalState === 'COMPLETED_SUCCESS' || ctx.finalState === 'COMPLETED_WARNING';
      }
      
      // Error paths
      if (ctx.decisionPath === 'error_diff_extraction' || ctx.decisionPath === 'error_size_limit') {
        return ctx.finalState === 'ABORTED_ERROR' || ctx.finalState === 'COMPLETED_WARNING';
      }
      
      return true;
    },
  },
};

export function getPostcondition(id: PostconditionID): PostconditionDefinition {
  return POSTCONDITIONS[id];
}

export function getAllPostconditions(): PostconditionDefinition[] {
  return Object.values(POSTCONDITIONS);
}

export function getPostconditionsByIds(ids: PostconditionID[]): PostconditionDefinition[] {
  return ids.map(id => POSTCONDITIONS[id]);
}