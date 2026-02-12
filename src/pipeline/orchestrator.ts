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
import { getContractVersion, getContractHash } from '../contracts/registry.js';
import { generateExecutionProofHash } from '../attestation/hasher.js';
import { ProofGenerationError } from '../attestation/types.js';
import type { ExecutionProofInput } from '../attestation/types.js';


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
    
    const allInvariantViolations = [...invariantViolations, ...finalViolations];
    
    // Evaluate postconditions
    const stateHistory = stateMachine.getTransitionHistory();
    const visitedStates = [
      ...new Set([
        'RECEIVED' as PipelineState,
        ...stateHistory.map(t => t.from),
        ...stateHistory.map(t => t.to),
      ])
    ];

    const formallyValid = 
      allInvariantViolations.filter(v => v.severity === 'fatal' || v.severity === 'error').length === 0 &&
      postconditionResult.violations.filter(v => v.severity === 'fatal' || v.severity === 'error').length === 0;
    
    metrics.recordFormallyValid(formallyValid);
    
    if (postconditionResult.violations.length > 0) {
      metrics.recordPostconditionViolations(postconditionResult.violations);
    }
    
    // Build decision record (without proof yet)
    const baseDecision = {
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
      invariantViolations: allInvariantViolations.length > 0 ? {
        total: allInvariantViolations.length,
        warn: allInvariantViolations.filter(v => v.severity === 'warn').length,
        error: allInvariantViolations.filter(v => v.severity === 'error').length,
        fatal: allInvariantViolations.filter(v => v.severity === 'fatal').length,
        violations: allInvariantViolations.map(v => ({
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
      postconditions: {
        totalChecked: postconditionResult.totalChecked,
        passed: postconditionResult.passed,
        violations: {
          total: postconditionResult.violations.length,
          warn: postconditionResult.violations.filter(v => v.severity === 'warn').length,
          error: postconditionResult.violations.filter(v => v.severity === 'error').length,
          fatal: postconditionResult.violations.filter(v => v.severity === 'fatal').length,
          details: postconditionResult.violations.map(v => ({
            postconditionId: v.postconditionId,
            severity: v.severity,
            description: v.description,
            rationale: v.rationale,
          })),
        },
      },
      formallyValid,
      contractVersion: getContractVersion(),
      contractHash: getContractHash(),
      contractValid: true,
    };
    
    // Generate execution proof
    try {
      const proofInput: ExecutionProofInput = {
        contractHash: baseDecision.contractHash,
        contractVersion: baseDecision.contractVersion,
        reviewId: baseDecision.reviewId,
        prOwner: baseDecision.pr.owner,
        prRepo: baseDecision.pr.repo,
        prNumber: baseDecision.pr.number,
        decisionPath: baseDecision.path,
        invariantViolations: {
          total: baseDecision.invariantViolations?.total || 0,
          warn: baseDecision.invariantViolations?.warn || 0,
          error: baseDecision.invariantViolations?.error || 0,
          fatal: baseDecision.invariantViolations?.fatal || 0,
          violationIds: baseDecision.invariantViolations?.violations.map(v => v.invariantId) || [],
        },
        stateTransitions: baseDecision.stateHistory.transitions.map(t => ({
          from: t.from,
          to: t.to,
        })),
        finalState: baseDecision.stateHistory.finalState,
        postconditionResults: {
          totalChecked: baseDecision.postconditions.totalChecked,
          passed: baseDecision.postconditions.passed,
          violationCount: baseDecision.postconditions.violations.total,
          violationIds: baseDecision.postconditions.violations.details.map(v => v.postconditionId),
        },
        verdict: baseDecision.verdict,
        processingTimeMs: baseDecision.processingTimeMs,
        aiInvoked: baseDecision.aiInvoked,
        fallbackUsed: baseDecision.fallbackUsed,
        commentPosted: baseDecision.commentPosted,
        timestamp: baseDecision.timestamp,
      };
      
      const executionProofHash = generateExecutionProofHash(proofInput);
      
      logger.info('execution_proof_generated', 'Cryptographic execution proof generated', {
        reviewId,
        proofHash: executionProofHash,
        algorithm: 'sha256-v1',
      });
      
      // Create sealed decision record
      const decision: DecisionRecord = {
        ...baseDecision,
        executionProofHash,
        executionProofAlgorithm: 'sha256-v1',
        sealed: true,
      };
      
      await decisionHistory.append(decision);
      
      if (allInvariantViolations.length > 0) {
        metrics.recordInvariantViolations(allInvariantViolations);
      }
      
      logger.info('decision_recorded', 'Decision record emitted and sealed', {
        reviewId,
        path: trace.pipelinePath,
        finalState: stateMachine.getFinalState(),
        stateTransitions: stateMachine.getStateHistorySummary(),
        processingTimeMs: decision.processingTimeMs,
        faultsInjected: injectedFaults.length > 0 ? injectedFaults : undefined,
        invariantViolations: allInvariantViolations.length > 0 ? allInvariantViolations.map(v => v.invariantId) : undefined,
        postconditionsPassed: postconditionResult.passed,
        formallyValid,
        sealed: true,
        proofHash: executionProofHash,
      });
      
    } catch (proofError) {
      logger.error('proof_generation_failed', 'Failed to generate execution proof', {
        reviewId,
        error: proofError instanceof Error ? proofError.message : 'Unknown error',
      });
      
      throw new ProofGenerationError(
        `Execution proof generation failed: ${proofError instanceof Error ? proofError.message : 'Unknown error'}`,
        reviewId
      );
    }
    
  } catch (error) {
    if (error instanceof FaultInjectionError) {
      logger.warn('fault_handling', 'Decision write failed (injected), continuing', {
        faultCode: error.faultCode,
      });
    } else if (error instanceof ProofGenerationError) {
      logger.error('proof_generation_fatal', 'Execution failed due to proof generation error', {
        reviewId: error.reviewId,
      });
      throw error;
    } else {
      logger.error('decision_record_error', 'Failed to emit decision record', {
        error: error instanceof Error ? error.message : 'Unknown error',
        reviewId,
      });
    }
  }
}
    
    const postconditionContext: PostconditionContext = {
      finalState: stateMachine.getFinalState()!,
      isTerminal: stateMachine.isTerminal(),
      decisionPath: trace.pipelinePath,
      commentPosted: trace.commentPosted,
      verdict: trace.finalVerdict,
      aiInvoked: trace.aiInvoked,
      aiBlocked: !trace.aiGating.allowed,
      fallbackUsed: trace.fallbackUsed,
      fallbackReason: trace.fallbackReason ? `${trace.fallbackReason.trigger}: ${trace.fallbackReason.details}` : undefined,
      stateTransitions: stateHistory.map(t => ({ from: t.from, to: t.to })),
      visitedStates,
      totalSignals: trace.preCheckSummary.totalSignals,
      highConfidenceSignals: trace.preCheckSummary.highConfidence,
    };
    
    const postconditionResult = checkPostconditions(postconditionContext);
    
    // Determine formal validity
    const formallyValid = 
      allInvariantViolations.filter(v => v.severity === 'fatal' || v.severity === 'error').length === 0 &&
      postconditionResult.violations.filter(v => v.severity === 'fatal' || v.severity === 'error').length === 0;
    
    metrics.recordFormallyValid(formallyValid);
    
    if (postconditionResult.violations.length > 0) {
      metrics.recordPostconditionViolations(postconditionResult.violations);
    }
    
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
      contractVersion: getContractVersion(),
      contractHash: getContractHash(),
      contractValid: true, // Always true if execution reached this point
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
      invariantViolations: allInvariantViolations.length > 0 ? {
        total: allInvariantViolations.length,
        warn: allInvariantViolations.filter(v => v.severity === 'warn').length,
        error: allInvariantViolations.filter(v => v.severity === 'error').length,
        fatal: allInvariantViolations.filter(v => v.severity === 'fatal').length,
        violations: allInvariantViolations.map(v => ({
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
      postconditions: {
        totalChecked: postconditionResult.totalChecked,
        passed: postconditionResult.passed,
        violations: {
          total: postconditionResult.violations.length,
          warn: postconditionResult.violations.filter(v => v.severity === 'warn').length,
          error: postconditionResult.violations.filter(v => v.severity === 'error').length,
          fatal: postconditionResult.violations.filter(v => v.severity === 'fatal').length,
          details: postconditionResult.violations.map(v => ({
            postconditionId: v.postconditionId,
            severity: v.severity,
            description: v.description,
            rationale: v.rationale,
          })),
        },
      },
      formallyValid,
    };

    await decisionHistory.append(decision);
    
    if (allInvariantViolations.length > 0) {
      metrics.recordInvariantViolations(allInvariantViolations);
    }
    
    logger.info('decision_recorded', 'Decision record emitted', {
      reviewId,
      path: trace.pipelinePath,
      finalState: stateMachine.getFinalState(),
      stateTransitions: stateMachine.getStateHistorySummary(),
      processingTimeMs: decision.processingTimeMs,
      faultsInjected: injectedFaults.length > 0 ? injectedFaults : undefined,
      invariantViolations: allInvariantViolations.length > 0 ? allInvariantViolations.map(v => v.invariantId) : undefined,
      postconditionsPassed: postconditionResult.passed,
      formallyValid,
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