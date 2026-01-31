import { AIReviewInput } from '../ai-types.js';

export function buildSystemPrompt(): string {
  return `You are MergeSense, an elite Staff/Principal Software Engineer with 10+ years of production experience.

You review pull requests as if you will be personally accountable for this code in production.

Your role:
- Evaluate engineering judgment, not style
- Focus on correctness, failure modes, and long-term maintainability
- Identify hidden risks and unstated assumptions
- Assess trade-offs made (explicitly or implicitly)

You must NEVER:
- Comment on formatting, naming, or style
- Suggest changes without explaining why
- Praise code without justification
- Invent issues that are not logically sound

Respond ONLY in valid JSON matching this exact structure:
{
  "assessment": "Concise overall evaluation in 1-2 sentences",
  "risks": ["Risk 1 with specific impact", "Risk 2 with conditions"],
  "assumptions": ["Assumption 1 the code relies on", "Assumption 2"],
  "tradeoffs": ["What was optimized vs what was sacrificed"],
  "failureModes": ["What breaks under load/failure/misuse"],
  "recommendations": ["Specific actionable recommendation"],
  "verdict": "safe" | "safe_with_conditions" | "requires_changes" | "high_risk"
}

Rules:
- Keep arrays concise (max 5 items each)
- Be specific, not generic
- Explain WHY, not just WHAT
- If a section has nothing meaningful, use empty array
- verdict must be one of the four exact strings shown`;
}

export function buildUserPrompt(input: AIReviewInput): string {
  const riskSummary = formatRiskSignals(input);
  
  return `Review this pull request based on deterministic pre-check analysis.

**PR Metrics:**
- Files changed: ${input.fileCount}
- Total changes: ${input.totalChanges}
- High-confidence risk signals: ${input.highConfidenceCount}
- Medium-confidence risk signals: ${input.mediumConfidenceCount}

**Critical Risk Categories Detected:**
${input.criticalCategories.length > 0 ? input.criticalCategories.map(c => `- ${c}`).join('\n') : 'None'}

**Detailed Risk Signals:**
${riskSummary}

Based on this analysis, provide your engineering review as JSON.

Remember:
- Focus on what could go wrong in production
- Identify assumptions that aren't documented
- Explain trade-offs clearly
- Be specific about failure modes
- No style feedback`;
}

function formatRiskSignals(input: AIReviewInput): string {
  const lines: string[] = [];
  
  const entries = Object.entries(input.riskSignals);
  
  for (const [category, signal] of entries) {
    if (!signal.detected) continue;
    
    lines.push(`\n**${category}** (confidence: ${signal.confidence})`);
    
    if (signal.locations.length > 0) {
      lines.push(`Files: ${signal.locations.slice(0, 3).join(', ')}`);
    }
    
    if (signal.details.length > 0) {
      lines.push(`Examples:`);
      signal.details.slice(0, 2).forEach(detail => {
        lines.push(`  - ${detail}`);
      });
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : 'No specific risk signals detected';
}