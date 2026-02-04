import { IdempotencyResult, IdempotencyEntry } from './types.js';

const MAX_ENTRIES = 1000;
const TTL_MS = 3600000;

export class IdempotencyGuard {
  private entries: Map<string, IdempotencyEntry> = new Map();
  private insertionOrder: string[] = [];

  checkAndMark(key: string): IdempotencyResult {
    this.evictExpired();

    const existing = this.entries.get(key);
    
    if (existing) {
      existing.lastSeenAt = new Date();
      existing.count++;
      
      return {
        status: 'duplicate_recent',
        key,
        firstSeenAt: existing.firstSeenAt,
      };
    }

    if (this.entries.size >= MAX_ENTRIES) {
      this.evictOldest();
    }

    const entry: IdempotencyEntry = {
      key,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      count: 1,
    };

    this.entries.set(key, entry);
    this.insertionOrder.push(key);

    return { status: 'new', key };
  }

  private evictExpired(): void {
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.lastSeenAt.getTime() > TTL_MS) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      this.entries.delete(key);
      const index = this.insertionOrder.indexOf(key);
      if (index !== -1) {
        this.insertionOrder.splice(index, 1);
      }
    }
  }

  private evictOldest(): void {
    if (this.insertionOrder.length === 0) return;

    const oldestKey = this.insertionOrder.shift()!;
    this.entries.delete(oldestKey);
  }

  getStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.entries.size,
      maxSize: MAX_ENTRIES,
      ttlMs: TTL_MS,
    };
  }

  clear(): void {
    this.entries.clear();
    this.insertionOrder = [];
  }
}

export const idempotencyGuard = new IdempotencyGuard();