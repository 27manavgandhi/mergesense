import crypto from 'crypto';

export interface LogContext {
  reviewId: string;
  owner?: string;
  repo?: string;
  pullNumber?: number;
}

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  reviewId: string;
  phase: string;
  message: string;
  data?: Record<string, unknown>;
  owner?: string;
  repo?: string;
  pullNumber?: number;
}

class Logger {
  private context: LogContext | null = null;

  setContext(context: LogContext): void {
    this.context = context;
  }

  clearContext(): void {
    this.context = null;
  }

  private log(level: 'info' | 'warn' | 'error', phase: string, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      reviewId: this.context?.reviewId || 'unknown',
      phase,
      message,
      data,
    };

    if (this.context?.owner) entry.owner = this.context.owner;
    if (this.context?.repo) entry.repo = this.context.repo;
    if (this.context?.pullNumber) entry.pullNumber = this.context.pullNumber;

    console.log(JSON.stringify(entry));
  }

  info(phase: string, message: string, data?: Record<string, unknown>): void {
    this.log('info', phase, message, data);
  }

  warn(phase: string, message: string, data?: Record<string, unknown>): void {
    this.log('warn', phase, message, data);
  }

  error(phase: string, message: string, data?: Record<string, unknown>): void {
    this.log('error', phase, message, data);
  }
}

export const logger = new Logger();

export function generateReviewId(): string {
  return crypto.randomBytes(8).toString('hex');
}