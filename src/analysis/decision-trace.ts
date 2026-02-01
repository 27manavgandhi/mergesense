import { PreCheckResult, RiskSignal } from '../types.js';

export type PipelinePath = 
  | 'silent_exit_safe'
  | 'silent_exit_filtered'
  | 'manual_review_warning'
  | 'ai_review'
  | 'ai_fallback_error'
  | 'ai_fallback_quality'
  | 'error_diff_extraction'
  | 'error_size_limit';

export interface AIGatingDecision {
  allowed: boolean;
  reason: string;
  highRiskSignals: number;
  mediumRiskSignals: number;
  criticalCategories: string[];
}

export interface FallbackReason {
  trigger: 'api_error' | 'validation_error' | 'quality_rejection' | 'timeout';
  details: string;
}

export interface DecisionTrace {
  reviewId: string;
  pipelinePath: PipelinePath;
  aiGating: AIGatingDecision;
  preCheckSummary: {
    totalSignalsDetected: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  };
  aiInvoked: boolean;
  fallbackUsed: boolean;
  fallbackReason?: FallbackReason;
  finalVerdict?: 'safe' | 'safe_with_conditions' | 'requires_changes' | 'high_risk';
  commentPosted: boolean;
}

export function createDecisionTrace(reviewId: string): DecisionTrace {
  return {
    reviewId,
    pipelinePath: 'silent_exit_safe',
    aiGating: {
      allowed: false,
      reason: 'Not yet determined',
      highRiskSignals: 0,
      mediumRiskSignals: 0,
      criticalCategories: [],
    },
    preCheckSummary: {
      totalSignalsDetected: 0,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
    },
    aiInvoked: false,
    fallbackUsed: false,
    commentPosted: false,
  };
}

export function recordPreCheckResults(
  trace: DecisionTrace,
  highConf: number,
  mediumConf: number,
  lowConf: number,
  criticalCategories: string[]
): void {
  trace.preCheckSummary.totalSignalsDetected = highConf + mediumConf + lowConf;
  trace.preCheckSummary.highConfidence = highConf;
  trace.preCheckSummary.mediumConfidence = mediumConf;
  trace.preCheckSummary.lowConfidence = lowConf;
  trace.aiGating.highRiskSignals = highConf;
  trace.aiGating.mediumRiskSignals = mediumConf;
  trace.aiGating.criticalCategories = criticalCategories;
}

export function recordAIGatingDecision(
  trace: DecisionTrace,
  allowed: boolean,
  reason: string
): void {
  trace.aiGating.allowed = allowed;
  trace.aiGating.reason = reason;
}

export function recordPipelinePath(trace: DecisionTrace, path: PipelinePath): void {
  trace.pipelinePath = path;
}

export function recordAIInvocation(trace: DecisionTrace, invoked: boolean): void {
  trace.aiInvoked = invoked;
}

export function recordFallback(
  trace: DecisionTrace,
  trigger: FallbackReason['trigger'],
  details: string
): void {
  trace.fallbackUsed = true;
  trace.fallbackReason = { trigger, details };
}

export function recordFinalVerdict(
  trace: DecisionTrace,
  verdict: DecisionTrace['finalVerdict']
): void {
  trace.finalVerdict = verdict;
}

export function recordCommentPosted(trace: DecisionTrace, posted: boolean): void {
  trace.commentPosted = posted;
}