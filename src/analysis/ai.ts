import { DiffFile, PreCheckResult, ReviewOutput } from '../types.js';
import { analyzeRiskSignals } from './risk-analyzer.js';
import { createClaudeClient } from './claude-client.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts/review-prompt.js';
import { AIReviewInput, AIReviewOutput, AIResponseValidationError, AIValidationError } from './ai-types.js';

function validateAIResponse(response: unknown): AIReviewOutput {
  const errors: AIValidationError[] = [];
  
  if (typeof response !== 'object' || response === null) {
    throw new AIResponseValidationError([{ field: 'root', reason: 'Response is not an object' }]);
  }
  
  const r = response as Record<string, unknown>;
  
  if (typeof r.assessment !== 'string') {
    errors.push({ field: 'assessment', reason: 'Must be a string' });
  }
  
  if (!Array.isArray(r.risks)) {
    errors.push({ field: 'risks', reason: 'Must be an array' });
  }
  
  if (!Array.isArray(r.assumptions)) {
    errors.push({ field: 'assumptions', reason: 'Must be an array' });
  }
  
  if (!Array.isArray(r.tradeoffs)) {
    errors.push({ field: 'tradeoffs', reason: 'Must be an array' });
  }
  
  if (!Array.isArray(r.failureModes)) {
    errors.push({ field: 'failureModes', reason: 'Must be an array' });
  }
  
  if (!Array.isArray(r.recommendations)) {
    errors.push({ field: 'recommendations', reason: 'Must be an array' });
  }
  
  const validVerdicts = ['safe', 'safe_with_conditions', 'requires_changes', 'high_risk'];
  if (!validVerdicts.includes(r.verdict as string)) {
    errors.push({ field: 'verdict', reason: `Must be one of: ${validVerdicts.join(', ')}` });
  }
  
  if (errors.length > 0) {
    throw new AIResponseValidationError(errors);
  }
  
  return r as AIReviewOutput;
}

function createFallbackReview(preChecks: PreCheckResult, fileCount: number): ReviewOutput {
  const riskAnalysis = analyzeRiskSignals(preChecks);
  
  return {
    assessment: `AI review unavailable. Analyzed ${fileCount} files with ${riskAnalysis.highConfidenceSignals} high-confidence risk signals detected.`,
    risks: riskAnalysis.criticalCategories.map(cat => `${cat} modifications detected - manual review recommended`),
    assumptions: ['AI analysis could not be completed - relying on deterministic pre-checks only'],
    tradeoffs: [],
    failureModes: [],
    recommendations: ['Manual review required - AI service unavailable'],
    verdict: riskAnalysis.highConfidenceSignals >= 3 ? 'high_risk' : 
             riskAnalysis.highConfidenceSignals >= 1 ? 'requires_changes' : 
             'safe_with_conditions',
  };
}

export async function generateReview(
  files: DiffFile[],
  preChecks: PreCheckResult
): Promise<ReviewOutput> {
  const riskAnalysis = analyzeRiskSignals(preChecks);
  
  const input: AIReviewInput = {
    fileCount: files.length,
    totalChanges: files.reduce((sum, f) => sum + f.changes, 0),
    riskSignals: preChecks,
    criticalCategories: riskAnalysis.criticalCategories,
    highConfidenceCount: riskAnalysis.highConfidenceSignals,
    mediumConfidenceCount: riskAnalysis.mediumConfidenceSignals,
  };
  
  try {
    const client = createClaudeClient();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(input);
    
    console.log('Calling Claude API...');
    const response = await client.generateReview(systemPrompt, userPrompt);
    
    if (response.usage) {
      console.log('Claude API usage:', {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      });
    }
    
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || !textContent.text) {
      throw new Error('No text content in Claude response');
    }
    
    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent.text);
    } catch (parseError) {
      console.error('Failed to parse Claude response as JSON:', textContent.text);
      throw new Error('Claude returned invalid JSON');
    }
    
    const validated = validateAIResponse(parsed);
    
    return {
      assessment: validated.assessment,
      risks: validated.risks,
      assumptions: validated.assumptions,
      tradeoffs: validated.tradeoffs,
      failureModes: validated.failureModes,
      recommendations: validated.recommendations,
      verdict: validated.verdict,
    };
    
  } catch (error) {
    console.error('AI review failed, using fallback:', error);
    return createFallbackReview(preChecks, files.length);
  }
}