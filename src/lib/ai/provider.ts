/**
 * Provider-agnostic LLM contract.
 *
 * Everything above this file (agent loop, tools, RAG) is written against these
 * types only. Swapping `MockAIProvider` for `OpenAIProvider` — or any other
 * OpenAI-compatible endpoint — is a configuration change, not a code change.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ProviderToolCall {
  id: string;
  name: string;
  /** Raw, unvalidated arguments from the model. Never trusted. */
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant turns that requested tools. */
  toolCalls?: ProviderToolCall[];
  /** Present on tool result turns. */
  toolCallId?: string;
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema derived from the tool's Zod schema. */
  parameters: Record<string, unknown>;
}

export interface GenerateOptions {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface GenerateResult {
  content: string;
  toolCalls: ProviderToolCall[];
  usage: TokenUsage;
  model: string;
  finishReason: "stop" | "tool_calls" | "length" | "error";
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  readonly embeddingModel: string;
  readonly supportsStreaming: boolean;

  generateResponse(options: GenerateOptions): Promise<GenerateResult>;
  generateWithTools(options: GenerateOptions): Promise<GenerateResult>;
  generateEmbedding(input: string[]): Promise<number[][]>;
}

export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Rough token estimate used for context budgeting and cost reporting when a
 * provider does not return usage (the mock never does).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
