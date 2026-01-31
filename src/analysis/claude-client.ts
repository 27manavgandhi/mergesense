import Anthropic from '@anthropic-ai/sdk';
import { ClaudeAPIResponse } from './ai-types.js';

const MAX_TOKENS = 2048;
const TIMEOUT_MS = 30000;
const MAX_RETRIES = 1;

export class ClaudeClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }
    
    this.client = new Anthropic({
      apiKey,
      timeout: TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    });
  }

  async generateReview(systemPrompt: string, userPrompt: string): Promise<ClaudeAPIResponse> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      return {
        content: response.content,
        stop_reason: response.stop_reason,
        usage: response.usage ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        } : undefined,
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        console.error('Claude API error:', {
          status: error.status,
          message: error.message,
          type: error.type,
        });
        throw new Error(`Claude API failed: ${error.message}`);
      }
      throw error;
    }
  }
}

export function createClaudeClient(): ClaudeClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set');
  }
  
  return new ClaudeClient(apiKey);
}