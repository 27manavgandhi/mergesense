/**
 * Current execution contract version.
 * 
 * CRITICAL: This version MUST be incremented whenever:
 * - A pipeline state is added or removed
 * - A state transition rule changes
 * - An invariant is added, removed, or has severity changed
 * - A postcondition is added, removed, or has severity changed
 * - The decision record schema changes in a semantic way
 * 
 * Version format: MAJOR.MINOR.PATCH
 * - MAJOR: Breaking changes to contract semantics
 * - MINOR: Additive changes (new invariants, new postconditions)
 * - PATCH: Non-semantic fixes (typos in descriptions, etc.)
 */
export const CURRENT_CONTRACT_VERSION = '1.0.0';

/**
 * Contract changelog.
 * Maintain this as documentation of evolution.
 */
export const CONTRACT_CHANGELOG: Record<string, string> = {
  '1.0.0': 'Initial execution contract - 28 states, 14 invariants, 14 postconditions',
};