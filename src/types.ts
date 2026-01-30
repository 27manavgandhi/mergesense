export interface PRContext {
  owner: string;
  repo: string;
  pull_number: number;
  installation_id: number;
}

export interface DiffFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface FilterResult {
  passed: boolean;
  reason?: string;
  filesAnalyzed: number;
  filesIgnored: number;
}

export interface RiskSignal {
  detected: boolean;
  confidence: 'high' | 'medium' | 'low';
  locations: string[];
  details: string[];
}

export interface PreCheckResult {
  publicAPI: RiskSignal;
  stateMutation: RiskSignal;
  authentication: RiskSignal;
  persistence: RiskSignal;
  concurrency: RiskSignal;
  errorHandling: RiskSignal;
  networking: RiskSignal;
  dependencies: RiskSignal;
  criticalPath: RiskSignal;
  securityBoundaries: RiskSignal;
}

export interface DiffContext {
  addedLines: string[];
  removedLines: string[];
  modifiedFiles: string[];
  addedFiles: string[];
  removedFiles: string[];
}

export interface ReviewOutput {
  assessment: string;
  risks: string[];
  assumptions: string[];
  tradeoffs: string[];
  failureModes: string[];
  recommendations: string[];
  verdict: 'safe' | 'safe_with_conditions' | 'requires_changes' | 'high_risk';
}
