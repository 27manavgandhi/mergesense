import type { Request, Response, NextFunction } from 'express';
import { RUNTIME_CONFIG } from '../config/runtime-config.js';
import { logger } from '../observability/logger.js';

/**
 * Global request rate limiter.
 * 
 * Uses sliding window algorithm:
 * - Tracks requests per minute
 * - Resets window every 60 seconds
 * - Returns 429 when limit exceeded
 * 
 * Stateless (in-memory only).
 * Single-instance safe.
 * No Redis required.
 */
let requestCount = 0;
let windowStart = Date.now();

export function globalRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const now = Date.now();
  const windowElapsed = now - windowStart;

  // Reset window every 60 seconds
  if (windowElapsed > 60_000) {
    logger.info('rate_limit_window_reset', 'Rate limit window reset', {
      previousCount: requestCount,
      windowDurationMs: windowElapsed,
    });
    
    windowStart = now;
    requestCount = 0;
  }

  requestCount++;

  // Check limit
  if (requestCount > RUNTIME_CONFIG.maxRequestsPerMinute) {
    const retryAfterMs = 60_000 - windowElapsed;
    
    logger.warn('rate_limit_exceeded', 'Global rate limit exceeded', {
      requestCount,
      limit: RUNTIME_CONFIG.maxRequestsPerMinute,
      retryAfterMs,
      path: req.path,
    });

    res.status(429).json({
      error: 'Rate limit exceeded',
      limit: RUNTIME_CONFIG.maxRequestsPerMinute,
      retryAfterMs,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    });
    return;
  }

  next();
}