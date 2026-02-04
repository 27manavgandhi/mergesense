export type IdempotencyResult = 
  | { status: 'new'; key: string }
  | { status: 'duplicate_recent'; key: string; firstSeenAt: Date }
  | { status: 'evicted'; key: string };

export interface IdempotencyEntry {
  key: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  count: number;
}