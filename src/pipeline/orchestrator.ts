import { PRContext } from '../types.js';
import { createInstallationClient } from '../github/client.js';
import { extractDiff } from '../diff/extractor.js';
import { filterDiff } from '../filters/deterministic.js';
import { runPreChecks, shouldBlockAI } from '../analysis/prechecks.js';
import { analyzeRiskSignals, formatRiskSummary } from '../analysis/risk-analyzer.js';
import { generateReview } from '../analysis/ai.js';
import { formatReview } from '../output/formatter.js';
import { publishReview } from '../output/publisher.js';

export async function processPullRequest(context: PRContext): Promise<void> {
  console.log(`Processing PR #${context.pull_number} in ${context.owner}/${context.repo}`);

  const octokit = await createInstallationClient(context.installation_id);

  let files;
  try {
    files = await extractDiff(octokit, context);
  } catch (error) {
    console.error('Diff extraction failed:', error);
    await publishReview(
      octokit,
      context,
      '## MergeSense Review\n\n⚠️ Unable to analyze: PR too large or diff unavailable'
    );
    return;
  }

  const filterResult = filterDiff(files);
  if (!filterResult.passed) {
    console.log(`Skipping PR: ${filterResult.reason}`);
    return;
  }

  const filteredFiles = files.filter(f => 
    f.patch && f.patch.trim().length > 0
  );

  const preChecks = runPreChecks(filteredFiles);
  const riskAnalysis = analyzeRiskSignals(preChecks);
  
  console.log('Pre-checks completed:', {
    totalSignals: riskAnalysis.totalSignals,
    highConfidence: riskAnalysis.highConfidenceSignals,
    mediumConfidence: riskAnalysis.mediumConfidenceSignals,
    criticalCategories: riskAnalysis.criticalCategories,
  });

  const aiDecision = shouldBlockAI(preChecks);
  
  if (aiDecision.block) {
    console.log(`AI blocked: ${aiDecision.reason}`);
    
    if (riskAnalysis.safeToSkipAI) {
      console.log('No significant risks detected - skipping review comment');
      return;
    }

    if (riskAnalysis.requiresManualReview) {
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
      console.log('Manual review recommendation posted');
      return;
    }
  }

  const review = await generateReview(filteredFiles, preChecks);
  const comment = formatReview(review, filterResult);

  await publishReview(octokit, context, comment);
  console.log(`Review posted for PR #${context.pull_number}`);
}
