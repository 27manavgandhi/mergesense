export type PipelineState =
  // Initial states
  | 'RECEIVED'
  | 'DIFF_EXTRACTION_PENDING'
  | 'DIFF_EXTRACTED'
  
  // Filtering states
  | 'FILTERING_PENDING'
  | 'FILTERED'
  | 'FILTERED_OUT'
  
  // Pre-check states
  | 'PRECHECK_PENDING'
  | 'PRECHECKED'
  
  // Gating decision states
  | 'AI_GATING_PENDING'
  | 'AI_APPROVED'
  | 'AI_BLOCKED_SAFE'
  | 'AI_BLOCKED_MANUAL'
  
  // AI execution states
  | 'AI_REVIEW_PENDING'
  | 'AI_INVOKED'
  | 'AI_RESPONDED'
  | 'AI_VALIDATED'
  
  // Fallback states
  | 'FALLBACK_PENDING'
  | 'FALLBACK_GENERATED'
  
  // Output states
  | 'REVIEW_READY'
  | 'COMMENT_PENDING'
  | 'COMMENT_POSTED'
  | 'COMMENT_FAILED'
  
  // Terminal states
  | 'COMPLETED_SUCCESS'
  | 'COMPLETED_SILENT'
  | 'COMPLETED_WARNING'
  | 'ABORTED_FATAL'
  | 'ABORTED_ERROR';

export interface StateMetadata {
  state: PipelineState;
  isTerminal: boolean;
  canTransitionTo: PipelineState[];
  description: string;
}

const STATE_DEFINITIONS: Record<PipelineState, Omit<StateMetadata, 'state'>> = {
  RECEIVED: {
    isTerminal: false,
    canTransitionTo: ['DIFF_EXTRACTION_PENDING', 'ABORTED_FATAL'],
    description: 'Webhook received, processing starting',
  },
  
  DIFF_EXTRACTION_PENDING: {
    isTerminal: false,
    canTransitionTo: ['DIFF_EXTRACTED', 'ABORTED_ERROR'],
    description: 'Extracting diff from GitHub',
  },
  
  DIFF_EXTRACTED: {
    isTerminal: false,
    canTransitionTo: ['FILTERING_PENDING'],
    description: 'Diff successfully extracted',
  },
  
  FILTERING_PENDING: {
    isTerminal: false,
    canTransitionTo: ['FILTERED', 'FILTERED_OUT'],
    description: 'Applying deterministic filters',
  },
  
  FILTERED: {
    isTerminal: false,
    canTransitionTo: ['PRECHECK_PENDING'],
    description: 'Filters passed, proceeding to pre-checks',
  },
  
  FILTERED_OUT: {
    isTerminal: false,
    canTransitionTo: ['COMPLETED_SILENT'],
    description: 'Filtered out (lock files, generated code)',
  },
  
  PRECHECK_PENDING: {
    isTerminal: false,
    canTransitionTo: ['PRECHECKED'],
    description: 'Running deterministic pre-checks',
  },
  
  PRECHECKED: {
    isTerminal: false,
    canTransitionTo: ['AI_GATING_PENDING'],
    description: 'Pre-checks completed, risk signals analyzed',
  },
  
  AI_GATING_PENDING: {
    isTerminal: false,
    canTransitionTo: ['AI_APPROVED', 'AI_BLOCKED_SAFE', 'AI_BLOCKED_MANUAL'],
    description: 'Evaluating whether AI review is needed',
  },
  
  AI_APPROVED: {
    isTerminal: false,
    canTransitionTo: ['AI_REVIEW_PENDING'],
    description: 'AI review approved by gating logic',
  },
  
  AI_BLOCKED_SAFE: {
    isTerminal: false,
    canTransitionTo: ['COMPLETED_SILENT'],
    description: 'AI blocked, no risks detected (safe to skip)',
  },
  
  AI_BLOCKED_MANUAL: {
    isTerminal: false,
    canTransitionTo: ['REVIEW_READY'],
    description: 'AI blocked, manual review required',
  },
  
  AI_REVIEW_PENDING: {
    isTerminal: false,
    canTransitionTo: ['AI_INVOKED', 'ABORTED_ERROR'],
    description: 'About to invoke AI',
  },
  
  AI_INVOKED: {
    isTerminal: false,
    canTransitionTo: ['AI_RESPONDED', 'FALLBACK_PENDING', 'ABORTED_ERROR'],
    description: 'AI invocation in progress',
  },
  
  AI_RESPONDED: {
    isTerminal: false,
    canTransitionTo: ['AI_VALIDATED', 'FALLBACK_PENDING'],
    description: 'AI response received',
  },
  
  AI_VALIDATED: {
    isTerminal: false,
    canTransitionTo: ['REVIEW_READY', 'FALLBACK_PENDING'],
    description: 'AI response validated and quality-checked',
  },
  
  FALLBACK_PENDING: {
    isTerminal: false,
    canTransitionTo: ['FALLBACK_GENERATED'],
    description: 'Generating deterministic fallback review',
  },
  
  FALLBACK_GENERATED: {
    isTerminal: false,
    canTransitionTo: ['REVIEW_READY'],
    description: 'Fallback review ready',
  },
  
  REVIEW_READY: {
    isTerminal: false,
    canTransitionTo: ['COMMENT_PENDING'],
    description: 'Review content ready for posting',
  },
  
  COMMENT_PENDING: {
    isTerminal: false,
    canTransitionTo: ['COMMENT_POSTED', 'COMMENT_FAILED'],
    description: 'Posting comment to GitHub',
  },
  
  COMMENT_POSTED: {
    isTerminal: false,
    canTransitionTo: ['COMPLETED_SUCCESS', 'COMPLETED_WARNING'],
    description: 'Comment successfully posted',
  },
  
  COMMENT_FAILED: {
    isTerminal: false,
    canTransitionTo: ['COMPLETED_WARNING', 'ABORTED_ERROR'],
    description: 'Comment posting failed',
  },
  
  COMPLETED_SUCCESS: {
    isTerminal: true,
    canTransitionTo: [],
    description: 'Pipeline completed successfully',
  },
  
  COMPLETED_SILENT: {
    isTerminal: true,
    canTransitionTo: [],
    description: 'Pipeline completed, no comment needed',
  },
  
  COMPLETED_WARNING: {
    isTerminal: true,
    canTransitionTo: [],
    description: 'Pipeline completed with warnings',
  },
  
  ABORTED_FATAL: {
    isTerminal: true,
    canTransitionTo: [],
    description: 'Pipeline aborted due to fatal error',
  },
  
  ABORTED_ERROR: {
    isTerminal: true,
    canTransitionTo: [],
    description: 'Pipeline aborted due to error',
  },
};

export function getStateMetadata(state: PipelineState): StateMetadata {
  return {
    state,
    ...STATE_DEFINITIONS[state],
  };
}

export function isTerminalState(state: PipelineState): boolean {
  return STATE_DEFINITIONS[state].isTerminal;
}

export function canTransition(from: PipelineState, to: PipelineState): boolean {
  return STATE_DEFINITIONS[from].canTransitionTo.includes(to);
}

export function getAllStates(): PipelineState[] {
  return Object.keys(STATE_DEFINITIONS) as PipelineState[];
}

export function getTerminalStates(): PipelineState[] {
  return getAllStates().filter(isTerminalState);
}