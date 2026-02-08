import { InvariantViolation, InvariantSeverity } from './types.js';

export class InvariantViolationError extends Error {
  constructor(
    public readonly violations: InvariantViolation[]
  ) {
    super(`Invariant violations: ${violations.map(v => v.invariantId).join(', ')}`);
    this.name = 'InvariantViolationError';
  }

  hasFatalViolations(): boolean {
    return this.violations.some(v => v.severity === 'fatal');
  }

  hasErrorViolations(): boolean {
    return this.violations.some(v => v.severity === 'error');
  }

  getViolationsBySeverity(severity: InvariantSeverity): InvariantViolation[] {
    return this.violations.filter(v => v.severity === severity);
  }
}

export function summarizeViolations(violations: InvariantViolation[]): {
  total: number;
  warn: number;
  error: number;
  fatal: number;
} {
  return {
    total: violations.length,
    warn: violations.filter(v => v.severity === 'warn').length,
    error: violations.filter(v => v.severity === 'error').length,
    fatal: violations.filter(v => v.severity === 'fatal').length,
  };
}