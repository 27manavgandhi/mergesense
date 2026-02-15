import type { AIReviewInput } from '../ai-types.js';
import type { ChunkedDiffResult } from '../diff-intelligence/chunk-types.js';

export function buildSystemPrompt(): string {
  return `You are an expert code reviewer analyzing a GitHub pull request.

Your role is to:
1. Identify potential bugs, security issues, and design problems
2. Assess architectural implications
3. Evaluate error handling and edge cases
4. Consider performance and scalability
5. Provide actionable, specific recommendations

Focus on substantive issues. Ignore style preferences and minor formatting.

Respond ONLY with valid JSON in this exact format:
{
  "assessment": "2-3 sentence summary",
  "risks": ["specific risk 1", "specific risk 2"],
  "assumptions": ["assumption 1", "assumption 2"],
  "tradeoffs": ["tradeoff 1", "tradeoff 2"],
  "failureModes": ["failure mode 1", "failure mode 2"],
  "recommendations": ["recommendation 1", "recommendation 2"],
  "verdict": "safe|safe_with_conditions|requires_changes|high_risk"
}

Do not include any text outside the JSON structure.`;
}

export function buildUserPrompt(input: AIReviewInput): string {
  return `Analyze this pull request:

FILES: ${input.fileCount} files, ${input.totalChanges} changes
RISK SIGNALS: ${input.highConfidenceCount} high-confidence, ${input.mediumConfidenceCount} medium-confidence

CRITICAL RISK CATEGORIES:
${input.criticalCategories.length > 0 ? input.criticalCategories.join(', ') : 'None'}

Pre-check signals detected:
- Security: ${input.riskSignals.security.length}
- Persistence: ${input.riskSignals.persistence.length}
- Concurrency: ${input.riskSignals.concurrency.length}
- State Mutation: ${input.riskSignals.stateMutation.length}
- Error Handling: ${input.riskSignals.errorHandling.length}

Provide your analysis as JSON.`;
}

export function buildUserPromptWithChunks(
  input: AIReviewInput,
  chunked: ChunkedDiffResult
): string {
  const { chunks, context, stats } = chunked;

  let prompt = `Analyze this pull request:

FILES: ${input.fileCount} files, ${input.totalChanges} changes
RISK SIGNALS: ${input.highConfidenceCount} high-confidence, ${input.mediumConfidenceCount} medium-confidence

PR CONTEXT:
- Modified modules: ${context.modifiedModules.join(', ') || 'None'}
- New dependencies: ${context.newDependencies.join(', ') || 'None'}
- Critical paths touched: ${context.criticalPathsTouched ? 'YES' : 'No'}
- Security-sensitive files: ${context.securitySensitiveFiles.length > 0 ? context.securitySensitiveFiles.join(', ') : 'None'}
- API surface changed: ${context.apiSurfaceChanged ? 'YES' : 'No'}
- State mutation detected: ${context.stateMutationDetected ? 'YES' : 'No'}

CHUNK DISTRIBUTION:
- Total chunks: ${stats.totalChunks}
- High priority: ${stats.highPriority}
- Medium priority: ${stats.mediumPriority}
- Low priority: ${stats.lowPriority}
- Truncated: ${stats.truncated}

`;

  // High priority changes
  const highChunks = chunks.filter(c => c.priority === 'high');
  if (highChunks.length > 0) {
    prompt += `\nHIGH PRIORITY CHANGES (${highChunks.length}):\n`;
    for (const chunk of highChunks) {
      prompt += `\n[${chunk.filePath}] (risk: ${chunk.riskScore}, category: ${chunk.category})\n`;
      prompt += `+${chunk.linesAdded} -${chunk.linesRemoved}\n`;
      prompt += `${chunk.code}\n`;
    }
  }

  // Medium priority changes
  const mediumChunks = chunks.filter(c => c.priority === 'medium');
  if (mediumChunks.length > 0) {
    prompt += `\nMEDIUM PRIORITY CHANGES (${mediumChunks.length}):\n`;
    for (const chunk of mediumChunks) {
      prompt += `\n[${chunk.filePath}] (risk: ${chunk.riskScore}, category: ${chunk.category})\n`;
      prompt += `+${chunk.linesAdded} -${chunk.linesRemoved}\n`;
      prompt += `${chunk.code}\n`;
    }
  }

  // Low priority changes (limited)
  const lowChunks = chunks.filter(c => c.priority === 'low');
  if (lowChunks.length > 0) {
    prompt += `\nLOW PRIORITY CHANGES (showing ${lowChunks.length}):\n`;
    for (const chunk of lowChunks) {
      prompt += `\n[${chunk.filePath}] (risk: ${chunk.riskScore}, category: ${chunk.category})\n`;
      prompt += `+${chunk.linesAdded} -${chunk.linesRemoved}\n`;
    }
  }

  if (stats.truncated > 0) {
    prompt += `\nNOTE: ${stats.truncated} low-priority chunks omitted for token efficiency.\n`;
  }

  prompt += `\nREVIEW INSTRUCTIONS:
Focus on high-priority changes. Consider the PR context. Identify substantive risks.

Provide your analysis as JSON.`;

  return prompt;
}