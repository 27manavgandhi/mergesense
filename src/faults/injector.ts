import { FaultCode, FaultInjectionError } from './types.js';
import { faultController } from './controller.js';
import { logger } from '../observability/logger.js';

export function maybeInjectFault(faultCode: FaultCode): void {
  if (faultController.shouldInject(faultCode)) {
    logger.warn('fault_injected', 'Injecting controlled failure', {
      faultCode,
      mode: 'chaos_safety',
    });
    throw new FaultInjectionError(faultCode, `Injected fault: ${faultCode}`);
  }
}

export function isFaultEnabled(): boolean {
  return faultController.isEnabled();
}