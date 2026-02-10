import { PRContext } from '../types.js';
import { createInstallationClient } from '../github/client.js';
import { extractDiff } from '../diff/extractor.js';
import { filterDiff } from '../filters/deterministic.js';
import { runPreChecks, shouldBlockAI } from '../analysis/prechecks.js';
import { analyzeRiskSignals, formatRiskSummary } from '../analysis/risk-analyzer.js';
import { generateReview } from '../analysis/ai.js';
import { formatReview } from '../output/formatter.js';
import { publishReview } from '../output/publisher.js';
import { logger } from '../observability/logger.js';
import { metrics } from '../metrics/metrics.js';
import { prSemaphore, decisionHistory, instanceMode } from '../index.js';
import { idempotencyGuard } from '../idempotency/guard.js';
import { FaultInjectionError } from '../faults/types.js';
import { PipelineStateMachine } from './state/machine.js';
import { safeCheckInvariants } from '../invariants/checker.js';
import type { InvariantViolation } from '../invariants/types.js';

import { checkPostconditions } from '../postconditions/checker.js';
import type { PostconditionContext } from '../postconditions/types.js';

import { 
  createDecisionTrace, 
  recordPreCheckResults, 
  recordAIGatingDecision,
  recordPipelinePath,
  recordFinalVerdict,
  recordCommentPosted,
  type DecisionTrace 
} from '../analysis/decision-trace.js';
import type { DecisionRecord } from '../decisions/types.js';

export async function processPullRequest(
  context: PRContext, 
  reviewId: string, 
  idempotencyKey: string
): Promise<void> {
  const startTime = Date.now();
  const injectedFaults: string[] = [];
  const invariantViolations: InvariantViolation[] = [];
  
  // Initialize state machine
  const stateMachine = new PipelineStateMachine(reviewId, 'RECEIVED');
  
  const idempotencyResult = await idempotencyGuard.checkAndMark(idempotencyKey);

  if (idempotencyResult.status === 'duplicate_recent') {
    logger.info('idempotency_guard', 'Duplicate webhook detected, skipping processing', {
      idempotencyKey,
      firstSeenAt: idempotencyResult.firstSeenAt,
      owner: context.owner,
      repo: context.repo,
      pullNumber: context.pull_number,
    });
    metrics.recordDuplicateWebhook();
    metrics.recordIdempotentSkipped();
    return;
  }

  const acquired = await prSemaphore.tryAcquire();
  if (!acquired) {
    logger.warn('load_shedding', 'PR pipeline concurrency limit reached, dropping request', {
      inFlight: await prSemaphore.getInFlight(),
      waiting: prSemaphore.getWaiting(),
      owner: context.owner,
      repo: context.repo,
      pullNumber: context.pull_number,
    });
    metrics.recordLoadShedPRSaturated();
    return;
  }

  const trace = createDecisionTrace(reviewId);
  
  try {
    metrics.incrementPRProcessed();
    
    logger.info('pipeline_start', 'Processing pull request', {
      owner: context.owner,
      repo: context.repo,
      pullNumber: context.pull_number,
      idempotencyKey,
      concurrency: {
        inFlight: await prSemaphore.getInFlight(),
        available: await prSemaphore.getAvailable(),
      },
    });

    const octokit = await createInstallationClient(context.installation_id);

    // STATE: DIFF_EXTRACTION_PENDING
    stateMachine.transition('DIFF_EXTRACTION_PENDING');
    
    let files;
    try {
      files = await extractDiff(octokit, context);
      stateMachine.transition('DIFF_EXTRACTED');
      
      logger.info('diff_extraction', 'Diff extracted successfully', {
        fileCount: files.length,
        totalChanges: files.reduce((sum, f) => sum + f.changes, 0),
      });
    } catch (error) {
      if (error instanceof FaultInjectionError) {
        injectedFaults.push(error.faultCode);
      }
      
      stateMachine.transition('ABORTED_ERROR', 'Diff extraction failed');
      
      logger.error('diff_extraction', 'Diff extraction failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      recordPipelinePath(trace, 'error_diff_extraction');
      try {
        metrics.recordPipelinePath('error_diff_extraction');
      } catch (metricsError) {
        if (metricsError instanceof FaultInjectionError) {
          injectedFaults.push(metricsError.faultCode);
        }
      }
      recordCommentPosted(trace, true);
      
      try {
        await publishReview(
          octokit,
          context,
          '## MergeSense Review\n\n⚠️ Unable to analyze: PR too large or diff unavailable'
        );
      } catch (publishError) {
        if (publishError instanceof FaultInjectionError) {
          injectedFaults.push(publishError.faultCode);
          recordCommentPosted(trace, false);
        }
      }
      
      await emitDecision(context, reviewId, trace, startTime, injectedFaults, invariantViolations, stateMachine);
      return;
    }

    // STATE: FILTERING_PENDING
    stateMachine.transition('FILTERING_PENDING');
    
    const filterResult = filterDiff(files);
    if (!filterResult.passed) {
      stateMachine.transition('FILTERED_OUT');
      stateMachine.transition('COMPLETED_SILENT');
      
      logger.info('file_filtering', 'PR skipped after filtering', {
        reason: filterResult.reason,
        filesIgnored: filterResult.filesIgnored,
      });
      
      recordPipelinePath(trace, 'silent_exit_filtered');
      try {
        metrics.recordPipelinePath('silent_exit_filtered');
      } catch (metricsError) {
        if (metricsError instanceof FaultInjectionError) {
          injectedFaults.push(metricsError.faultCode);
        }
      }
      
      // Check state invariant: silent exit should not have AI invoked
      const silentExitViolations = safeCheckInvariants({
        currentState: stateMachine.getCurrentState(),
        aiInvoked: trace.aiInvoked,
      }, ['STATE_SILENT_EXIT_NO_AI']);
      invariantViolations.push(...silentExitViolations);
      
      await emitDecision(context, reviewId, trace, startTime, injectedFaults, invariantViolations, stateMachine);
      return;
    }

    stateMachine.transition('FILTERED');
    
    const filteredFiles = files.filter(f => 
      f.patch && f.patch.trim().length > 0
    );

    // STATE: PRECHECK_PENDING
    stateMachine.transition('PRECHECK_PENDING');
    
    const preChecks = runPreChecks(filteredFiles);
    const riskAnalysis = analyzeRiskSignals(preChecks);
    
    stateMachine.transition('PRECHECKED');
    
    recordPreCheckResults(
      trace,
      riskAnalysis.highConfidenceSignals,
      riskAnalysis.mediumConfidenceSignals,
      riskAnalysis.lowConfidenceSignals,
      riskAnalysis.criticalCategories
    );
    
    logger.info('prechecks_complete', 'Pre-checks completed', {
      totalSignals: riskAnalysis.totalSignals,
      highConfidence: riskAnalysis.highConfidenceSignals,
      mediumConfidence: riskAnalysis.mediumConfidenceSignals,
      criticalCategories: riskAnalysis.criticalCategories,
    });

    // STATE: AI_GATING_PENDING
    stateMachine.transition('AI_GATING_PENDING');
    
    const aiDecision = shouldBlockAI(preChecks);
    
    if (aiDecision.block) {
      recordAIGatingDecision(trace, false, aiDecision.reason!);
      logger.info('ai_gating', 'AI blocked', {
        reason: aiDecision.reason,
        highRiskSignals: riskAnalysis.highConfidenceSignals,
      });
      
      if (riskAnalysis.safeToSkipAI) {
        stateMachine.transition('AI_BLOCKED_SAFE');
        stateMachine.transition('COMPLETED_SILENT');
        
        recordPipelinePath(trace, 'silent_exit_safe');
        try {
          metrics.recordPipelinePath('silent_exit_safe');
        } catch (metricsError) {
          if (metricsError instanceof FaultInjectionError) {
            injectedFaults.push(metricsError.faultCode);
          }
        }
        
        // Check state invariant
        const silentExitViolations = safeCheckInvariants({
          currentState: stateMachine.getCurrentState(),
          aiInvoked: trace.aiInvoked,
        }, ['STATE_SILENT_EXIT_NO_AI']);
        invariantViolations.push(...silentExitViolations);
        
        await emitDecision(context, reviewId, trace, startTime, injectedFaults, invariantViolations, stateMachine);
        return;
      }

      if (riskAnalysis.requiresManualReview) {
        stateMachine.transition('AI_BLOCKED_MANUAL');
        stateMachine.transition('REVIEW_READY');
        stateMachine.transition('COMMENT_PENDING');
        
        recordPipelinePath(trace, 'manual_review_warning');
        try {
          metrics.recordPipelinePath('manual_review_warning');
        } catch (metricsError) {
          if (metricsError instanceof FaultInjectionError) {
            injectedFaults.push(metricsError.faultCode);
          }
        }
        recordCommentPosted(trace, true);
        
        const manualReviewComment = [
          '## MergeSense Review',
          '',
          '⚠️ **This PR requires manual review**',
          '',
          `Detected ${riskAnalysis.highConfidenceSignals} high-confidence risk signals across multiple categories.`,
          '',
          formatRiskSummary(preChecks, riskAnalysis),
          '',
          '**Recommendation**: Have a senior engineer review this PR before merge.',
        ].join('\n');
        
        // Check state invariant before posting comment
        const commentInvariants = safeCheckInvariants({
          currentState: stateMachine.getCurrentState(),
          aboutToPostComment: true,
        }, ['STATE_COMMENT_REQUIRES_REVIEW_READY']);
        invariantViolations.push(...commentInvariants);
        
        try {
          await publishReview(octokit, context, manualReviewComment);
          stateMachine.transition('COMMENT_POSTED');
          stateMachine.transition('COMPLETED_WARNING');
        } catch (publishError) {
          if (publishError instanceof FaultInjectionError) {
            injectedFaults.push(publishError.faultCode);
            stateMachine.transition('COMMENT_FAILED');
            stateMachine.transition('COMPLETED_WARNING');
            recordCommentPosted(trace, false);
          } else {
            throw publishError;
          }
        }
        
        await emitDecision(context, reviewId, trace, startTime, injectedFaults, invariantViolations, stateMachine);
        return;
      }
    }

    // STATE: AI_APPROVED
    stateMachine.transition('AI_APPROVED');
    stateMachine.transition('AI_REVIEW_PENDING');
    
    recordAIGatingDecision(trace, true, 'Risk signals within acceptable range for AI review');
    logger.info('ai_gating', 'AI review approved', {
      highRiskSignals: riskAnalysis.highConfidenceSignals,
      mediumRiskSignals: riskAnalysis.mediumConfidenceSignals,
    });

    const review = await generateReview(filteredFiles, preChecks, trace, injectedFaults, stateMachine);
    recordFinalVerdict(trace, review.verdict);
    
    if (trace.fallbackUsed) {
      stateMachine.transition('REVIEW_READY');
      const path = trace.fallbackReason?.trigger === 'quality_rejection' ? 'ai_fallback_quality' : 'ai_fallback_error';
      recordPipelinePath(trace, path);
      try {
        metrics.recordPipelinePath(path);
      } catch (metricsError) {
        if (metricsError instanceof FaultInjectionError) {
          injectedFaults.push(metricsError.faultCode);
        }
      }
    } else {
      stateMachine.transition('REVIEW_READY');
      recordPipelinePath(trace, 'ai_review');
      try {
        metrics.recordPipelinePath('ai_review');
      } catch (metricsError) {
        if (metricsError instanceof FaultInjectionError) {
          injectedFaults.push(metricsError.faultCode);
        }
      }
    }
    
    const comment = formatReview(review, filterResult);

    stateMachine.transition('COMMENT_PENDING');
    
    // Check state invariant before posting comment
    const commentInvariants = safeCheckInvariants({
      currentState: stateMachine.getCurrentState(),
      aboutToPostComment: true,
    }, ['STATE_COMMENT_REQUIRES_REVIEW_READY']);
    invariantViolations.push(...commentInvariants);

    try {
      await publishReview(octokit, context, comment);
      stateMachine.transition('COMMENT_POSTED');
      stateMachine.transition('COMPLETED_SUCCESS');
      recordCommentPosted(trace, true);
    } catch (publishError) {
      if (publishError instanceof FaultInjectionError) {
        injectedFaults.push(publishError.faultCode);
        stateMachine.transition('COMMENT_FAILED');
        stateMachine.transition('COMPLETED_WARNING');
        recordCommentPosted(trace, false);
      } else {
        throw publishError;
      }
    }
    
    await emitDecision(context, reviewId, trace, startTime, injectedFaults, invariantViolations, stateMachine);
  } catch (error) {
    if (error instanceof FaultInjectionError) {
      logger.error('fault_uncaught', 'Uncaught fault injection error', {
        faultCode: error.faultCode,
      });
    }
    
    if (!stateMachine.isTerminal()) {
      stateMachine.transition('ABORTED_FATAL', error instanceof Error ? error.message : 'Unknown error');
    }
    
    throw error;
  } finally {
    try {
      await prSemaphore.release();
    } catch (releaseError) {
      if (releaseError instanceof FaultInjectionError) {
        injectedFaults.push(releaseError.faultCode);
      }
    }
  }
}

async function emitDecision(
  context: PRContext,
  reviewId: string,
  trace: DecisionTrace,
  startTime: number,
  injectedFaults: string[],
  invariantViolations: InvariantViolation[],
  stateMachine: PipelineStateMachine
): Promise<void> {
  try {
    // Check final decision consistency invariants
    const finalViolations = safeCheckInvariants({
      pipelinePath: trace.pipelinePath,
      commentPosted: trace.commentPosted,
      fallbackUsed: trace.fallbackUsed,
      fallbackReason: trace.fallbackReason ? `${trace.fallbackReason.trigger}: ${trace.fallbackReason.details}` : undefined,
      verdict: trace.finalVerdict,
      currentState: stateMachine.getCurrentState(),
      isTerminalState: stateMachine.isTerminal(),
    }, ['PIPELINE_PATH_VALID', 'DECISION_COMMENT_CONSISTENT', 'FALLBACK_ALWAYS_EXPLAINED']);
    
    const allViolations = [...invariantViolations, ...finalViolations];
    
    const stateHistory = stateMachine.getTransitionHistory();
    
    const decision: DecisionRecord = {
      reviewId,
      timestamp: new Date().toISOString(),
      pr: {
        owner: context.owner,
        repo: context.repo,
        number: context.pull_number,
      },
      path: trace.pipelinePath,
      aiInvoked: trace.aiInvoked,
      aiBlocked: !trace.aiGating.allowed,
      aiBlockedReason: trace.aiGating.reason,
      fallbackUsed: trace.fallbackUsed,
      fallbackReason: trace.fallbackReason ? `${trace.fallbackReason.trigger}: ${trace.fallbackReason.details}` : undefined,
      preCheckSummary: trace.preCheckSummary,
      verdict: trace.finalVerdict,
      commentPosted: trace.commentPosted,
      processingTimeMs: Date.now() - startTime,
      instanceMode: instanceMode(),
      faultsInjected: injectedFaults.length > 0 ? injectedFaults : undefined,
      invariantViolations: allViolations.length > 0 ? {
        total: allViolations.length,
        warn: allViolations.filter(v => v.severity === 'warn').length,
        error: allViolations.filter(v => v.severity === 'error').length,
        fatal: allViolations.filter(v => v.severity === 'fatal').length,
        violations: allViolations.map(v => ({
          invariantId: v.invariantId,
          severity: v.severity,
          description: v.description,
        })),
      } : undefined,
      stateHistory: {
        transitions: stateHistory.map(t => ({
          from: t.from,
          to: t.to,
          timestamp: t.timestamp,
        })),
        finalState: stateMachine.getFinalState()!,
        totalTransitions: stateHistory.length,
      },
    };

    await decisionHistory.append(decision);
    
    if (allViolations.length > 0) {
      metrics.recordInvariantViolations(allViolations);
    }
    
    logger.info('decision_recorded', 'Decision record emitted', {
      reviewId,
      path: trace.pipelinePath,
      finalState: stateMachine.getFinalState(),
      stateTransitions: stateMachine.getStateHistorySummary(),
      processingTimeMs: decision.processingTimeMs,
      faultsInjected: injectedFaults.length > 0 ? injectedFaults : undefined,
      invariantViolations: allViolations.length > 0 ? allViolations.map(v => v.invariantId) : undefined,
    });
  } catch (error) {
    if (error instanceof FaultInjectionError) {
      logger.warn('fault_handling', 'Decision write failed (injected), continuing', {
        faultCode: error.faultCode,
      });
    } else {
      logger.error('decision_record_error', 'Failed to emit decision record', {
        error: error instanceof Error ? error.message : 'Unknown error',
        reviewId,
      });
    }
  }
}