import { FaultCode, FaultConfig, FaultTrigger } from './types.js';

class FaultController {
  private config: FaultConfig = {
    enabled: false,
    triggers: {},
  };

  initialize(): void {
    const enabled = process.env.FAULTS_ENABLED === 'true';
    
    if (!enabled) {
      this.config = { enabled: false, triggers: {} };
      return;
    }

    this.config.enabled = true;
    this.config.triggers = {
      DIFF_EXTRACTION_FAIL: this.parseTrigger(process.env.FAULT_DIFF_EXTRACTION_FAIL),
      AI_TIMEOUT: this.parseTrigger(process.env.FAULT_AI_TIMEOUT),
      AI_MALFORMED_RESPONSE: this.parseTrigger(process.env.FAULT_AI_MALFORMED_RESPONSE),
      REDIS_UNAVAILABLE: this.parseTrigger(process.env.FAULT_REDIS_UNAVAILABLE),
      SEMAPHORE_LEAK_SIMULATION: this.parseTrigger(process.env.FAULT_SEMAPHORE_LEAK_SIMULATION),
      DECISION_WRITE_FAILURE: this.parseTrigger(process.env.FAULT_DECISION_WRITE_FAILURE),
      METRICS_WRITE_FAILURE: this.parseTrigger(process.env.FAULT_METRICS_WRITE_FAILURE),
      PUBLISH_COMMENT_FAILURE: this.parseTrigger(process.env.FAULT_PUBLISH_COMMENT_FAILURE),
    };
  }

  private parseTrigger(value: string | undefined): FaultTrigger {
    if (!value) return 'never';
    if (value === 'always') return 'always';
    if (value === 'never') return 'never';
    
    const prob = parseFloat(value);
    if (isNaN(prob) || prob < 0 || prob > 1) return 'never';
    return prob;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  shouldInject(faultCode: FaultCode): boolean {
    if (!this.config.enabled) return false;
    
    const trigger = this.config.triggers[faultCode];
    if (!trigger || trigger === 'never') return false;
    if (trigger === 'always') return true;
    
    return Math.random() < trigger;
  }

  getConfig(): Readonly<FaultConfig> {
    return this.config;
  }
}

export const faultController = new FaultController();