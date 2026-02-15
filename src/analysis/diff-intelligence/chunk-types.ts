export type ChunkPriority = 'high' | 'medium' | 'low';

export interface DiffChunk {
  filePath: string;
  priority: ChunkPriority;
  riskScore: number;
  linesAdded: number;
  linesRemoved: number;
  category: string;
  code: string;
}

export interface PRContextSummary {
  modifiedModules: string[];
  newDependencies: string[];
  criticalPathsTouched: boolean;
  securitySensitiveFiles: string[];
  apiSurfaceChanged: boolean;
  stateMutationDetected: boolean;
}

export interface ChunkedDiffResult {
  chunks: DiffChunk[];
  context: PRContextSummary;
  stats: {
    totalChunks: number;
    highPriority: number;
    mediumPriority: number;
    lowPriority: number;
    truncated: number;
  };
}