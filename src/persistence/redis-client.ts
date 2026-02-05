import Redis from 'ioredis';
import { logger } from '../observability/logger.js';

const CONNECT_TIMEOUT_MS = 5000;
const COMMAND_TIMEOUT_MS = 2000;

let redisClient: Redis | null = null;
let isHealthy = false;

export function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    connectTimeout: CONNECT_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS,
    retryStrategy: (times: number) => {
      if (times > 3) {
        logger.error('redis_connection', 'Max retries exceeded, giving up', { times });
        return null;
      }
      const delay = Math.min(times * 200, 2000);
      logger.warn('redis_connection', 'Retrying connection', { times, delay });
      return delay;
    },
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on('connect', () => {
    logger.info('redis_lifecycle', 'Redis connecting');
  });

  client.on('ready', () => {
    logger.info('redis_lifecycle', 'Redis ready');
    isHealthy = true;
  });

  client.on('error', (error) => {
    logger.error('redis_lifecycle', 'Redis error', {
      error: error.message,
    });
    isHealthy = false;
  });

  client.on('close', () => {
    logger.warn('redis_lifecycle', 'Redis connection closed');
    isHealthy = false;
  });

  client.on('reconnecting', () => {
    logger.info('redis_lifecycle', 'Redis reconnecting');
  });

  return client;
}

export function initializeRedis(url?: string): void {
  if (!url) {
    logger.info('redis_initialization', 'REDIS_URL not provided, using in-memory mode');
    return;
  }

  try {
    redisClient = createRedisClient(url);
    logger.info('redis_initialization', 'Redis client initialized', {
      mode: 'distributed',
    });
  } catch (error) {
    logger.error('redis_initialization', 'Failed to initialize Redis', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    redisClient = null;
  }
}

export function getRedisClient(): Redis | null {
  return redisClient;
}

export function isRedisHealthy(): boolean {
  return redisClient !== null && isHealthy;
}

export async function shutdownRedis(): Promise<void> {
  if (redisClient) {
    logger.info('redis_shutdown', 'Shutting down Redis connection');
    await redisClient.quit();
    redisClient = null;
    isHealthy = false;
  }
}