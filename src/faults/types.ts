export type FaultCode =
  | 'DIFF_EXTRACTION_FAIL'
  | 'AI_TIMEOUT'
  | 'AI_MALFORMED_RESPONSE'
  | 'REDIS_UNAVAILABLE'
  | 'SEMAPHORE_LEAK_SIMULATION'
  | 'DECISION_WRITE_FAILURE'
  | 'METRICS_WRITE_FAILURE'
  | 'PUBLISH_COMMENT_FAILURE';

export type FaultTrigger = 'always' | 'never' | number;

export interface FaultConfig {
  enabled: boolean;
  triggers: Partial<Record<FaultCode, FaultTrigger>>;
}

export class FaultInjectionError extends Error {
  constructor(
    public readonly faultCode: FaultCode,
    message: string
  ) {
    super(message);
    this.name = 'FaultInjectionError';
  }
}