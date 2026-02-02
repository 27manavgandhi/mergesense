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
import { 
  createDecisionTrace, 
  recordPreCheckResults, 
  recordAIGatingDecision,
  recordPipelinePath,
  recordFinalVerdict,
  recordCommentPosted,
  type DecisionTrace 
} from '../analysis/decision-trace.js';

export async function processPullRequest(context: PRContext, reviewId: string): Promise<void> {
  const trace = createDecisionTrace(reviewId);
  
  metrics.incrementPRProcessed();
  
  logger.info('pipeline_start', 'Processing pull request', {
    owner: context.owner,
    repo: context.repo,
    pullNumber: context.pull_number,
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
    logger.error('diff_extraction', 'Diff extraction failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    recordPipelinePath(trace, 'error_diff_extraction');
    metrics.recordPipelinePath('error_diff_extraction');
    recordCommentPosted(trace, true);
    
    await publishReview(
      octokit,
      context,
      '## MergeSense Review\n\n⚠️ Unable to analyze: PR too large or diff unavailable'
    );
    
    logger.info('pipeline_complete', 'Pipeline finished with error', { trace });
    return;
  }

  const filterResult = filterDiff(files);
  if (!filterResult.passed) {
    logger.info('file_filtering', 'PR skipped after filtering', {
      reason: filterResult.reason,
      filesIgnored: filterResult.filesIgnored,
    });
    recordPipelinePath(trace, 'silent_exit_filtered');
    metrics.recordPipelinePath('silent_exit_filtered');
    logger.info('pipeline_complete', 'Pipeline finished (silent exit - filtered)', { trace });
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
      metrics.recordPipelinePath('silent_exit_safe');
      logger.info('pipeline_complete', 'Pipeline finished (silent exit - safe)', { trace });
      return;
    }

    if (riskAnalysis.requiresManualReview) {
      recordPipelinePath(trace, 'manual_review_warning');
      metrics.recordPipelinePath('manual_review_warning');
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
      
      await publishReview(octokit, context, manualReviewComment);
      logger.info('pipeline_complete', 'Pipeline finished (manual review warning)', { trace });
      return;
    }
  }

  recordAIGatingDecision(trace, true, 'Risk signals within acceptable range for AI review');
  logger.info('ai_gating', 'AI review approved', {
    highRiskSignals: riskAnalysis.highConfidenceSignals,
    mediumRiskSignals: riskAnalysis.mediumConfidenceSignals,
  });

  const review = await generateReview(filteredFiles, preChecks, trace);
  recordFinalVerdict(trace, review.verdict);
  
  if (trace.fallbackUsed) {
    const path = trace.fallbackReason?.trigger === 'quality_rejection' ? 'ai_fallback_quality' : 'ai_fallback_error';
    recordPipelinePath(trace, path);
    metrics.recordPipelinePath(path);
  } else {
    recordPipelinePath(trace, 'ai_review');
    metrics.recordPipelinePath('ai_review');
  }
  
  const comment = formatReview(review, filterResult);

  await publishReview(octokit, context, comment);
  recordCommentPosted(trace, true);
  
  logger.info('pipeline_complete', 'Pipeline finished successfully', {
    trace,
    verdict: review.verdict,
    fallbackUsed: trace.fallbackUsed,
  });
}