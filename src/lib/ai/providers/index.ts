import type { AIProvider } from "@/lib/ai/provider";
import { MockAIProvider } from "@/lib/ai/providers/mock";
import { OpenAIProvider } from "@/lib/ai/providers/openai";
import { env, resolveAiProvider } from "@/lib/env";

let cached: AIProvider | null = null;

/**
 * Single place where a concrete provider is chosen. Falls back to the mock
 * whenever credentials are missing so the app never hard-fails on a fresh
 * clone (see `resolveAiProvider`).
 */
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  cached =
    resolveAiProvider() === "openai"
      ? new OpenAIProvider(env.LLM_MODEL, env.EMBEDDING_MODEL, env.LLM_API_KEY!, env.LLM_BASE_URL)
      : new MockAIProvider();
  return cached;
}

/** Test seam: forces re-resolution after env changes. */
export function resetAIProvider(): void {
  cached = null;
}

export { MockAIProvider, OpenAIProvider };
