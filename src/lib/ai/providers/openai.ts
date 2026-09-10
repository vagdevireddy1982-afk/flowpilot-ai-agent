import type {
  AIProvider,
  ChatMessage,
  GenerateOptions,
  GenerateResult,
  ProviderToolCall,
} from "@/lib/ai/provider";
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/provider";
import { AppError, providerError } from "@/lib/errors";
import { logger } from "@/lib/logger";

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiChoice {
  message: { content: string | null; tool_calls?: OpenAiToolCall[] };
  finish_reason: string;
}

interface OpenAiChatResponse {
  choices: OpenAiChoice[];
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface OpenAiEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Works against any OpenAI-compatible `/chat/completions` + `/embeddings`
 * endpoint (OpenAI, Azure OpenAI gateways, Together, Groq, vLLM, Ollama's
 * compatibility layer …) by pointing LLM_BASE_URL at it.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly supportsStreaming = true;

  constructor(
    readonly model: string,
    readonly embeddingModel: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async generateResponse(options: GenerateOptions): Promise<GenerateResult> {
    return this.chat({ ...options, tools: undefined });
  }

  async generateWithTools(options: GenerateOptions): Promise<GenerateResult> {
    return this.chat(options);
  }

  async generateEmbedding(input: string[]): Promise<number[][]> {
    if (input.length === 0) return [];
    const payload = await this.request<OpenAiEmbeddingResponse>("/embeddings", {
      model: this.embeddingModel,
      input,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return payload.data
      .sort((a, b) => a.index - b.index)
      .map((row) => row.embedding);
  }

  private async chat(options: GenerateOptions): Promise<GenerateResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: options.messages.map(toOpenAiMessage),
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1024,
    };

    if (options.tools?.length) {
      body.tools = options.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tool_choice = "auto";
    }

    const payload = await this.request<OpenAiChatResponse>(
      "/chat/completions",
      body,
      options.signal,
    );
    const choice = payload.choices[0];
    if (!choice) throw providerError("The model returned an empty response.");

    return {
      content: choice.message.content ?? "",
      toolCalls: (choice.message.tool_calls ?? []).map(parseToolCall),
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0,
      },
      model: payload.model ?? this.model,
      finishReason: choice.finish_reason === "tool_calls" ? "tool_calls" : "stop",
    };
  }

  private async request<T>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    signal?.addEventListener("abort", () => controller.abort(), { once: true });

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 429) {
        throw new AppError(
          "RATE_LIMITED",
          "The AI provider is rate limiting us right now. Please retry in a few seconds.",
        );
      }
      if (!response.ok) {
        const detail = await response.text();
        logger.error("llm.request_failed", { status: response.status, detail: detail.slice(0, 300) });
        throw providerError(
          `The AI provider returned an error (${response.status}). Falling back is not possible for this request.`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("TIMEOUT", "The AI provider took too long to respond. Please retry.");
      }
      throw providerError("Could not reach the AI provider. Check LLM_BASE_URL and connectivity.", error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toOpenAiMessage(message: ChatMessage) {
  if (message.role === "tool") {
    return {
      role: "tool" as const,
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant" as const,
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function parseToolCall(call: OpenAiToolCall): ProviderToolCall {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed JSON from the model is expected occasionally; Zod validation
    // downstream turns the empty object into a clear "missing argument" error.
    logger.warn("llm.tool_args_unparseable", { tool: call.function.name });
  }
  return { id: call.id, name: call.function.name, arguments: args };
}
