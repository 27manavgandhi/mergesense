import { PostconditionViolation, PostconditionSeverity } from './types.js';

export class PostconditionViolationError extends Error {
  constructor(
    public readonly violations: PostconditionViolation[]
  ) {
    super(`Postcondition violations: ${violations.map(v => v.postconditionId).join(', ')}`);
    this.name = 'PostconditionViolationError';
  }

  hasFatalViolations(): boolean {
    return this.violations.some(v => v.severity === 'fatal');
  }

  hasErrorViolations(): boolean {
    return this.violations.some(v => v.severity === 'error');
  }

  getViolationsBySeverity(severity: PostconditionSeverity): PostconditionViolation[] {
    return this.violations.filter(v => v.severity === severity);
  }
}

export function summarizeViolations(violations: PostconditionViolation[]): {
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