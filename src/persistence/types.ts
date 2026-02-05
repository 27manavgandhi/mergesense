export interface IdempotencyStore {
  checkAndMark(key: string): Promise<{ status: 'new' | 'duplicate_recent'; firstSeenAt?: Date }>;
  getStats(): { size: number; maxSize: number; ttlMs: number; type: 'redis' | 'memory' };
}

export interface DistributedSemaphore {
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
  getInFlight(): Promise<number>;
  getPeak(): number;
  getAvailable(): Promise<number>;
  getWaiting(): number;
}