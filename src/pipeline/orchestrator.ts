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
import { safeCheckInvariants } from '../invariants/checker.js';
import { metrics } from '../metrics/metrics.js';
import { InvariantViolation } from '../invariants/types.js';

export async function processPullRequest(
  context: PRContext, 
  reviewId: string, 
  idempotencyKey: string
): Promise<void> {
  const startTime = Date.now();
  const injectedFaults: string[] = [];
  
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

    let files;
    try {
      files = await extractDiff(octokit, context);
      logger.info('diff_extraction', 'Diff extracted successfully', {
        fileCount: files.length,
        totalChanges: files.reduce((sum, f) => sum + f.changes, 0),
      });
    } catch (error) {
      if (error instanceof FaultInjectionError) {
        injectedFaults.push(error.faultCode);
      }
      
      logger.error('diff_extraction', 'Diff extraction failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      recordPipelinePath(trace, 'error_diff_extraction');
      try {
        metrics.recordPipelinePath('error_diff_extraction');
      } catch (metricsError) {
        if (metricsError instanceof FaultInjectionError) {
          injectedFaults.push(metricsError.faultCode);
          logger.warn('fault_handling', 'Metrics write failed (injected), continuing', {
            faultCode: metricsError.faultCode,
          });
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
          logger.error('fault_handling', 'Publish failed (injected), decision still recorded', {
            faultCode: publishError.faultCode,
          });
          recordCommentPosted(trace, false);
        } else {
          throw publishError;
        }
      }
      
      logger.info('pipeline_complete', 'Pipeline finished with error', { trace });
      
      await emitDecision(context, reviewId, trace, startTime, injectedFaults);
      return;
    }

    const filterResult = filterDiff(files);
    if (!filterResult.passed) {
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
      logger.info('pipeline_complete', 'Pipeline finished (silent exit - filtered)', { trace });
      
      await emitDecision(context, reviewId, trace, startTime, injectedFaults);
      return;
    }

    const filteredFiles = files.filter(f => 
      f.patch && f.patch.trim().length > 0
    );

    const preChecks = runPreChecks(filteredFiles);
    const riskAnalysis = analyzeRiskSignals(preChecks);
    
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

    const aiDecision = shouldBlockAI(preChecks);
    
    if (aiDecision.block) {
      recordAIGatingDecision(trace, false, aiDecision.reason!);
      logger.info('ai_gating', 'AI blocked', {
        reason: aiDecision.reason,
        highRiskSignals: riskAnalysis.highConfidenceSignals,
      });
      
      if (riskAnalysis.safeToSkipAI) {
        recordPipelinePath(trace, 'silent_exit_safe');
        try {
          metrics.recordPipelinePath('silent_exit_safe');
        } catch (metricsError) {
          if (metricsError instanceof FaultInjectionError) {
            injectedFaults.push(metricsError.faultCode);
          }
        }
        logger.info('pipeline_complete', 'Pipeline finished (silent exit - safe)', { trace });
        
        await emitDecision(context, reviewId, trace, startTime, injectedFaults);
        return;
      }

      if (riskAnalysis.requiresManualReview) {
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
        
        try {
          await publishReview(octokit, context, manualReviewComment);
        } catch (publishError) {
          if (publishError instanceof FaultInjectionError) {
            injectedFaults.push(publishError.faultCode);
            logger.error('fault_handling', 'Publish failed (injected), decision still recorded', {
              faultCode: publishError.faultCode,
            });
            recordCommentPosted(trace, false);
          } else {
            throw publishError;
          }
        }
        
        logger.info('pipeline_complete', 'Pipeline finished (manual review warning)', { trace });
        
        await emitDecision(context, reviewId, trace, startTime, injectedFaults);
        return;
      }
    }

    recordAIGatingDecision(trace, true, 'Risk signals within acceptable range for AI review');
    logger.info('ai_gating', 'AI review approved', {
      highRiskSignals: riskAnalysis.highConfidenceSignals,
      mediumRiskSignals: riskAnalysis.mediumConfidenceSignals,
    });

    const review = await generateReview(filteredFiles, preChecks, trace, injectedFaults);
    recordFinalVerdict(trace, review.verdict);
    
    if (trace.fallbackUsed) {
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

    try {
      await publishReview(octokit, context, comment);
      recordCommentPosted(trace, true);
    } catch (publishError) {
      if (publishError instanceof FaultInjectionError) {
        injectedFaults.push(publishError.faultCode);
        logger.error('fault_handling', 'Publish failed (injected), decision still recorded', {
          faultCode: publishError.faultCode,
        });
        recordCommentPosted(trace, false);
      } else {
        throw publishError;
      }
    }
    
    logger.info('pipeline_complete', 'Pipeline finished successfully', {
      trace,
      verdict: review.verdict,
      fallbackUsed: trace.fallbackUsed,
    });
    
    await emitDecision(context, reviewId, trace, startTime, injectedFaults);
  } catch (error) {
    if (error instanceof FaultInjectionError) {
      logger.error('fault_uncaught', 'Uncaught fault injection error', {
        faultCode: error.faultCode,
      });
    }
    throw error;
  } finally {
    try {
      await prSemaphore.release();
    } catch (releaseError) {
      if (releaseError instanceof FaultInjectionError) {
        injectedFaults.push(releaseError.faultCode);
        logger.error('fault_handling', 'Semaphore release failed (injected), permit leaked', {
          faultCode: releaseError.faultCode,
        });
      } else {
        throw releaseError;
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
  invariantViolations: InvariantViolation[]
): Promise<void> {
  try {
    // Check decision consistency invariants
    const finalViolations = safeCheckInvariants({
      pipelinePath: trace.pipelinePath,
      commentPosted: trace.commentPosted,
      fallbackUsed: trace.fallbackUsed,
      fallbackReason: trace.fallbackReason ? `${trace.fallbackReason.trigger}: ${trace.fallbackReason.details}` : undefined,
      verdict: trace.finalVerdict,
    }, ['PIPELINE_PATH_VALID', 'DECISION_COMMENT_CONSISTENT', 'FALLBACK_ALWAYS_EXPLAINED']);
    
    const allViolations = [...invariantViolations, ...finalViolations];
    
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
    };

    await decisionHistory.append(decision);
    
    if (allViolations.length > 0) {
      metrics.recordInvariantViolations(allViolations);
    }
    
    logger.info('decision_recorded', 'Decision record emitted', {
      reviewId,
      path: trace.pipelinePath,
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
