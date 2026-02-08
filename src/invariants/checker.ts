import { InvariantDefinition, InvariantContext, InvariantCheckResult, InvariantViolation, InvariantID } from './types.js';
import { getInvariantsByIds, getAllInvariants } from './registry.js';
import { logger } from '../observability/logger.js';
import { InvariantViolationError, summarizeViolations } from './violations.js';

export function checkInvariants(
  context: InvariantContext,
  invariantIds?: InvariantID[]
): InvariantCheckResult {
  const invariants = invariantIds 
    ? getInvariantsByIds(invariantIds)
    : getAllInvariants();

  const violations: InvariantViolation[] = [];

  for (const invariant of invariants) {
    try {
      const passed = invariant.evaluate(context);
      
      if (!passed) {
        const violation: InvariantViolation = {
          invariantId: invariant.id,
          description: invariant.description,
          severity: invariant.severity,
          context,
          timestamp: new Date().toISOString(),
        };
        
        violations.push(violation);
        
        logger.warn('invariant_violation', `Invariant violated: ${invariant.id}`, {
          invariantId: invariant.id,
          severity: invariant.severity,
          description: invariant.description,
          context,
        });
      }
    } catch (error) {
      logger.error('invariant_check_error', 'Error evaluating invariant', {
        invariantId: invariant.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

export function enforceInvariants(
  context: InvariantContext,
  invariantIds?: InvariantID[]
): void {
  const result = checkInvariants(context, invariantIds);
  
  if (!result.passed) {
    const summary = summarizeViolations(result.violations);
    
    logger.error('invariant_enforcement', 'Invariant violations detected', {
      summary,
      violations: result.violations.map(v => ({
        id: v.invariantId,
        severity: v.severity,
        description: v.description,
      })),
    });
    
    const fatalViolations = result.violations.filter(v => v.severity === 'fatal');
    if (fatalViolations.length > 0) {
      throw new InvariantViolationError(fatalViolations);
    }
  }
}

export function safeCheckInvariants(
  context: InvariantContext,
  invariantIds?: InvariantID[]
): InvariantViolation[] {
  try {
    const result = checkInvariants(context, invariantIds);
    return result.violations;
  } catch (error) {
    logger.error('invariant_safe_check_error', 'Safe invariant check failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
}