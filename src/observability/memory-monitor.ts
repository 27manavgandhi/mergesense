import { RUNTIME_CONFIG } from '../config/runtime-config.js';
import { logger } from './logger.js';

/**
 * Check memory usage and exit if limit exceeded.
 * 
 * Called at strategic points (e.g., start of PR processing).
 * Prevents runaway memory consumption.
 * 
 * Fail-fast philosophy:
 * - Better to exit cleanly than degrade silently
 * - Allows orchestrator to restart process
 * - Prevents OOM kills
 */
export function checkMemoryUsage(): void {
  const usage = process.memoryUsage();
  const heapMb = usage.heapUsed / 1024 / 1024;
  const rssM = usage.rss / 1024 / 1024;

  logger.info('memory_check', 'Memory usage checked', {
    heapUsedMb: heapMb.toFixed(2),
    rssMb: rssM.toFixed(2),
    limitMb: RUNTIME_CONFIG.memoryLimitMb,
  });

  if (heapMb > RUNTIME_CONFIG.memoryLimitMb) {
    logger.fatal('memory_limit_exceeded', 'Heap usage exceeded configured limit - exiting', {
      heapUsedMb: heapMb.toFixed(2),
      limitMb: RUNTIME_CONFIG.memoryLimitMb,
      exceedBy: (heapMb - RUNTIME_CONFIG.memoryLimitMb).toFixed(2),
    });

    // Graceful exit - allows orchestrator to restart
    process.exit(1);
  }
}

/**
 * Get current memory usage for metrics.
 */
export function getMemoryUsage(): {
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  externalMb: number;
} {
  const usage = process.memoryUsage();
  
  return {
    heapUsedMb: usage.heapUsed / 1024 / 1024,
    heapTotalMb: usage.heapTotal / 1024 / 1024,
    rssMb: usage.rss / 1024 / 1024,
    externalMb: usage.external / 1024 / 1024,
  };
}