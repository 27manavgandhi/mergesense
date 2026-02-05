import { PipelinePath } from '../analysis/decision-trace.js';
import { isRedisHealthy } from '../persistence/redis-client.js';
import type { DistributedSemaphore } from '../persistence/types.js';
import type { IdempotencyStore } from '../persistence/types.js';

export interface MetricsSnapshot {
  processStartTime: string;
  uptimeSeconds: number;
  redis: {
    enabled: boolean;
    healthy: boolean;
    mode: 'distributed' | 'degraded' | 'single-instance';
  };
  prs: {
    total: number;
    aiInvoked: number;
    aiSkippedSafe: number;
    aiSkippedFiltered: number;
    aiBlockedManual: number;
    aiFallbackError: number;
    aiFallbackQuality: number;
    errorDiffExtraction: number;
    errorSizeLimit: number;
    loadShedPRSaturated: number;
    loadShedAISaturated: number;
    duplicateWebhooks: number;
    idempotentSkipped: number;
  };
  ai: {
    invocationCount: number;
    fallbackCount: number;
    fallbackRate: number;
    qualityRejectionCount: number;
    apiErrorCount: number;
  };
  tokens: {
    totalInput: number;
    totalOutput: number;
    totalCombined: number;
  };
  cost: {
    totalUSD: number;
    averagePerAIInvocation: number;
    averagePerPR: number;
  };
  concurrency: {
    prPipelines: {
      inFlight: number;
      peak: number;
      available: number;
      waiting: number;
    };
    aiCalls: {
      inFlight: number;
      peak: number;
      available: number;
      waiting: number;
    };
  };
  idempotency: {
    guardSize: number;
    guardMaxSize: number;
    guardTTLMs: number;
    type: 'redis' | 'memory';
  };
}

class Metrics {
  private startTime: Date = new Date();
  
  private counters = {
    prsTotal: 0,
    prsAIInvoked: 0,
    prsAISkippedSafe: 0,
    prsAISkippedFiltered: 0,
    prsAIBlockedManual: 0,
    prsAIFallbackError: 0,
    prsAIFallbackQuality: 0,
    prsErrorDiffExtraction: 0,
    prsErrorSizeLimit: 0,
    prsLoadShedPRSaturated: 0,
    prsLoadShedAISaturated: 0,
    prsDuplicateWebhooks: 0,
    prsIdempotentSkipped: 0,
    aiInvocationCount: 0,
    aiFallbackCount: 0,
    aiQualityRejectionCount: 0,
    aiAPIErrorCount: 0,
    tokensInput: 0,
    tokensOutput: 0,
    costTotalUSD: 0,
  };

  incrementPRProcessed(): void {
    this.counters.prsTotal++;
  }

  recordPipelinePath(path: PipelinePath): void {
    switch (path) {
      case 'ai_review':
        this.counters.prsAIInvoked++;
        break;
      case 'silent_exit_safe':
        this.counters.prsAISkippedSafe++;
        break;
      case 'silent_exit_filtered':
        this.counters.prsAISkippedFiltered++;
        break;
      case 'manual_review_warning':
        this.counters.prsAIBlockedManual++;
        break;
      case 'ai_fallback_error':
        this.counters.prsAIFallbackError++;
        break;
      case 'ai_fallback_quality':
        this.counters.prsAIFallbackQuality++;
        break;
      case 'error_diff_extraction':
        this.counters.prsErrorDiffExtraction++;
        break;
      case 'error_size_limit':
        this.counters.prsErrorSizeLimit++;
        break;
    }
  }

  recordLoadShedPRSaturated(): void {
    this.counters.prsLoadShedPRSaturated++;
  }

  recordLoadShedAISaturated(): void {
    this.counters.prsLoadShedAISaturated++;
  }

  recordDuplicateWebhook(): void {
    this.counters.prsDuplicateWebhooks++;
  }

  recordIdempotentSkipped(): void {
    this.counters.prsIdempotentSkipped++;
  }

  recordAIInvocation(): void {
    this.counters.aiInvocationCount++;
  }

  recordAIFallback(trigger: 'api_error' | 'quality_rejection'): void {
    this.counters.aiFallbackCount++;
    if (trigger === 'quality_rejection') {
      this.counters.aiQualityRejectionCount++;
    } else {
      this.counters.aiAPIErrorCount++;
    }
  }

  recordTokenUsage(inputTokens: number, outputTokens: number, costUSD: number): void {
    this.counters.tokensInput += inputTokens;
    this.counters.tokensOutput += outputTokens;
    this.counters.costTotalUSD += costUSD;
  }

  async snapshot(
    prSemaphore?: DistributedSemaphore, 
    aiSemaphore?: DistributedSemaphore,
    idempotencyGuard?: IdempotencyStore,
    redisEnabled?: boolean
  ): Promise<MetricsSnapshot> {
    const uptimeMs = Date.now() - this.startTime.getTime();
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    
    const fallbackRate = this.counters.aiInvocationCount > 0
      ? this.counters.aiFallbackCount / this.counters.aiInvocationCount
      : 0;
    
    const averagePerAIInvocation = this.counters.aiInvocationCount > 0
      ? this.counters.costTotalUSD / this.counters.aiInvocationCount
      : 0;
    
    const averagePerPR = this.counters.prsTotal > 0
      ? this.counters.costTotalUSD / this.counters.prsTotal
      : 0;

    const idempotencyStats = idempotencyGuard?.getStats() ?? { size: 0, maxSize: 0, ttlMs: 0, type: 'memory' as const };
    const redisHealthy = isRedisHealthy();
    
    let redisMode: 'distributed' | 'degraded' | 'single-instance' = 'single-instance';
    if (redisEnabled) {
      redisMode = redisHealthy ? 'distributed' : 'degraded';
    }

    const prInFlight = prSemaphore ? await prSemaphore.getInFlight() : 0;
    const prAvailable = prSemaphore ? await prSemaphore.getAvailable() : 0;
    const aiInFlight = aiSemaphore ? await aiSemaphore.getInFlight() : 0;
    const aiAvailable = aiSemaphore ? await aiSemaphore.getAvailable() : 0;

    return {
      processStartTime: this.startTime.toISOString(),
      uptimeSeconds,
      redis: {
        enabled: redisEnabled ?? false,
        healthy: redisHealthy,
        mode: redisMode,
      },
      prs: {
        total: this.counters.prsTotal,
        aiInvoked: this.counters.prsAIInvoked,
        aiSkippedSafe: this.counters.prsAISkippedSafe,
        aiSkippedFiltered: this.counters.prsAISkippedFiltered,
        aiBlockedManual: this.counters.prsAIBlockedManual,
        aiFallbackError: this.counters.prsAIFallbackError,
        aiFallbackQuality: this.counters.prsAIFallbackQuality,
        errorDiffExtraction: this.counters.prsErrorDiffExtraction,
        errorSizeLimit: this.counters.prsErrorSizeLimit,
        loadShedPRSaturated: this.counters.prsLoadShedPRSaturated,
        loadShedAISaturated: this.counters.prsLoadShedAISaturated,
        duplicateWebhooks: this.counters.prsDuplicateWebhooks,
        idempotentSkipped: this.counters.prsIdempotentSkipped,
      },
      ai: {
        invocationCount: this.counters.aiInvocationCount,
        fallbackCount: this.counters.aiFallbackCount,
        fallbackRate: parseFloat(fallbackRate.toFixed(4)),
        qualityRejectionCount: this.counters.aiQualityRejectionCount,
        apiErrorCount: this.counters.aiAPIErrorCount,
      },
      tokens: {
        totalInput: this.counters.tokensInput,
        totalOutput: this.counters.tokensOutput,
        totalCombined: this.counters.tokensInput + this.counters.tokensOutput,
      },
      cost: {
        totalUSD: parseFloat(this.counters.costTotalUSD.toFixed(6)),
        averagePerAIInvocation: parseFloat(averagePerAIInvocation.toFixed(6)),
        averagePerPR: parseFloat(averagePerPR.toFixed(6)),
      },
      concurrency: {
        prPipelines: {
          inFlight: prInFlight,
          peak: prSemaphore?.getPeak() ?? 0,
          available: prAvailable,
          waiting: prSemaphore?.getWaiting() ?? 0,
        },
        aiCalls: {
          inFlight: aiInFlight,
          peak: aiSemaphore?.getPeak() ?? 0,
          available: aiAvailable,
          waiting: aiSemaphore?.getWaiting() ?? 0,
        },
      },
      idempotency: {
        guardSize: idempotencyStats.size,
        guardMaxSize: idempotencyStats.maxSize,
        guardTTLMs: idempotencyStats.ttlMs,
        type: idempotencyStats.type,
      },
    };
  }
}

export const metrics = new Metrics();