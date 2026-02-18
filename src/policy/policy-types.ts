export type PolicyMode = 'OFF' | 'WARN' | 'ENFORCE';

export interface MergePolicyResult {
  allowed: boolean;
  violated: boolean;
  reasons: string[];
}