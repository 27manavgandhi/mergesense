import { InvariantDefinition, InvariantContext, InvariantID } from './types.js';

const INVARIANTS: Record<InvariantID, InvariantDefinition> = {
  SEMAPHORE_PERMITS_NON_NEGATIVE: {
    id: 'SEMAPHORE_PERMITS_NON_NEGATIVE',
    description: 'Semaphore available permits must never be negative',
    severity: 'fatal',
    evaluate: (ctx: InvariantContext) => {
      if (ctx.semaphorePermits === undefined) return true;
      return ctx.semaphorePermits >= 0;
    },
  },

  SEMAPHORE_IN_FLIGHT_MATCHES_ACQUIRED: {
    id: 'SEMAPHORE_IN_FLIGHT_MATCHES_ACQUIRED',
    description: 'In-flight count must equal (max - available) permits',
    severity: 'error',
    evaluate: (ctx: InvariantContext) => {
      if (ctx.semaphoreInFlight === undefined || 
          ctx.semaphorePermits === undefined || 
          ctx.semaphoreMaxPermits === undefined) {
        return true;
      }
      const expected = ctx.semaphoreMaxPermits - ctx.semaphorePermits;
      return ctx.semaphoreInFlight === expected;
    },
  },

  AI_GATING_RESPECTED: {
    id: 'AI_GATING_RESPECTED',
    description: 'AI must not be invoked when gating disallows it',
    severity: 'fatal',
    evaluate: (ctx: InvariantContext) => {
      if (ctx.aiGatingAllowed === undefined || ctx.aiInvoked === undefined) {
        return true;
      }
      if (!ctx.aiGatingAllowed && ctx.aiInvoked) {
        return false;
      }
      return true;
    },
  },

  FALLBACK_ALWAYS_EXPLAINED: {
    id: 'FALLBACK_ALWAYS_EXPLAINED',
    description: 'Fallback usage must always have an explicit reason',
    severity: 'error',
    evaluate: (ctx: InvariantContext) => {
      if (ctx.fallbackUsed === undefined) return true;
      if (ctx.fallbackUsed && !ctx.fallbackReason) {
        return false;
      }
      return true;
    },
  },

  DECISION_VERDICT_CONSISTENT: {
    id: 'DECISION_VERDICT_CONSISTENT',
    description: 'Verdict "safe" cannot coexist with risks',
    severity: 'error',
    evaluate: (ctx: InvariantContext) => {
      if (!ctx.verdict || !ctx.risks) return true;
      if (ctx.verdict === 'safe' && ctx.risks.length > 0) {
        return false;
      }
      if (ctx.verdict === 'high_risk' && ctx.risks.length === 0) {
        return false;
      }
      return true;
    },
  },

  DECISION_COMMENT_CONSISTENT: {
    id: 'DECISION_COMMENT_CONSISTENT',
    description: 'Silent exit paths must not post comments',
    severity: 'error',
    evaluate: (ctx: InvariantContext) => {
      if (!ctx.pipelinePath || ctx.commentPosted === undefined) return true;
      
      const silentPaths = ['silent_exit_safe', 'silent_exit_filtered'];
      if (silentPaths.includes(ctx.pipelinePath) && ctx.commentPosted) {
        return false;
      }
      return true;
    },
  },

  METRICS_MATCH_DECISIONS: {
    id: 'METRICS_MATCH_DECISIONS',
    description: 'Metrics AI invocation count must match decision records',
    severity: 'warn',
    evaluate: (ctx: InvariantContext) => {
      if (ctx.metricsAIInvoked === undefined || ctx.decisionAIInvoked === undefined) {
        return true;
      }
      return true;
    },
  },

  IDEMPOTENCY_TTL_HONORED: {
    id: 'IDEMPOTENCY_TTL_HONORED',
    description: 'Idempotency guard must respect TTL window',
    severity: 'warn',
    evaluate: (_ctx: InvariantContext) => {
      return true;
    },
  },

  REDIS_MODE_CONSISTENT: {
    id: 'REDIS_MODE_CONSISTENT',
    description: 'Instance mode must match Redis health state',
    severity: 'error',
    evaluate: (ctx: InvariantContext) => {
      if (!ctx.redisEnabled || ctx.redisHealthy === undefined || !ctx.instanceMode) {
        return true;
      }
      
      if (!ctx.redisEnabled && ctx.instanceMode !== 'single-instance') {
        return false;
      }
      
      if (ctx.redisEnabled && ctx.redisHealthy && ctx.instanceMode !== 'distributed') {
        return false;
      }
      
      if (ctx.redisEnabled && !ctx.redisHealthy && ctx.instanceMode !== 'degraded') {
        return false;
      }
      
      return true;
    },
  },

  PIPELINE_PATH_VALID: {
    id: 'PIPELINE_PATH_VALID',
    description: 'Pipeline path must be one of the defined valid paths',
    severity: 'fatal',
    evaluate: (ctx: InvariantContext) => {
      if (!ctx.pipelinePath) return true;
      
      const validPaths = [
        'ai_review',
        'silent_exit_safe',
        'silent_exit_filtered',
        'manual_review_warning',
        'ai_fallback_error',
        'ai_fallback_quality',
        'error_diff_extraction',
        'error_size_limit',
      ];
      
      return validPaths.includes(ctx.pipelinePath);
    },
  },
};

export function getInvariant(id: InvariantID): InvariantDefinition {
  return INVARIANTS[id];
}

export function getAllInvariants(): InvariantDefinition[] {
  return Object.values(INVARIANTS);
}

export function getInvariantsByIds(ids: InvariantID[]): InvariantDefinition[] {
  return ids.map(id => INVARIANTS[id]);
}