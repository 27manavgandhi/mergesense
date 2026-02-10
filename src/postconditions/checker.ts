import { 
  PostconditionDefinition, 
  PostconditionContext, 
  PostconditionCheckResult, 
  PostconditionViolation,
  PostconditionID 
} from './types.js';
import { getAllPostconditions, getPostconditionsByIds } from './registry.js';
import { logger } from '../observability/logger.js';
import { PostconditionViolationError, summarizeViolations } from './violations.js';

export function checkPostconditions(
  context: PostconditionContext,
  postconditionIds?: PostconditionID[]
): PostconditionCheckResult {
  const postconditions = postconditionIds 
    ? getPostconditionsByIds(postconditionIds)
    : getAllPostconditions();

  const violations: PostconditionViolation[] = [];

  for (const postcondition of postconditions) {
    try {
      const passed = postcondition.evaluate(context);
      
      if (!passed) {
        const violation: PostconditionViolation = {
          postconditionId: postcondition.id,
          description: postcondition.description,
          severity: postcondition.severity,
          rationale: postcondition.rationale,
          context,
          timestamp: new Date().toISOString(),
        };
        
        violations.push(violation);
        
        logger.error('postcondition_violation', `Postcondition violated: ${postcondition.id}`, {
          postconditionId: postcondition.id,
          severity: postcondition.severity,
          description: postcondition.description,
          rationale: postcondition.rationale,
          finalState: context.finalState,
          decisionPath: context.decisionPath,
        });
      }
    } catch (error) {
      logger.error('postcondition_check_error', 'Error evaluating postcondition', {
        postconditionId: postcondition.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const result: PostconditionCheckResult = {
    passed: violations.length === 0,
    violations,
    totalChecked: postconditions.length,
  };

  if (!result.passed) {
    const summary = summarizeViolations(violations);
    
    logger.warn('postcondition_check_summary', 'Postcondition check completed with violations', {
      totalChecked: postconditions.length,
      summary,
    });
  } else {
    logger.info('postcondition_check_summary', 'All postconditions passed', {
      totalChecked: postconditions.length,
    });
  }

  return result;
}

export function enforcePostconditions(
  context: PostconditionContext,
  postconditionIds?: PostconditionID[]
): void {
  const result = checkPostconditions(context, postconditionIds);
  
  if (!result.passed) {
    const fatalViolations = result.violations.filter(v => v.severity === 'fatal');
    if (fatalViolations.length > 0) {
      throw new PostconditionViolationError(fatalViolations);
    }
  }
}

export function safeCheckPostconditions(
  context: PostconditionContext,
  postconditionIds?: PostconditionID[]
): PostconditionViolation[] {
  try {
    const result = checkPostconditions(context, postconditionIds);
    return result.violations;
  } catch (error) {
    logger.error('postcondition_safe_check_error', 'Safe postcondition check failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
}