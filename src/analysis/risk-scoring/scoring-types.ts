export interface RiskDimensionScores {
  security: number;        // 0-1
  persistence: number;     // 0-1
  concurrency: number;     // 0-1
  apiExposure: number;     // 0-1
  stateMutation: number;   // 0-1
  criticalPath: number;    // 0-1
  chunkDensity: number;    // 0-1
}

export interface CompositeRiskScore {
  score: number;           // 0-100
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;      // 0-1
  breakdown: RiskDimensionScores;
}