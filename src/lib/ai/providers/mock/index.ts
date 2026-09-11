import type {
  AIProvider,
  GenerateOptions,
  GenerateResult,
  ProviderToolCall,
} from "@/lib/ai/provider";
import { estimateTokens } from "@/lib/ai/provider";
import { embedText, tokenize } from "@/lib/ai/providers/mock/embedding";
import { planNextStep, type MockStep } from "@/lib/ai/providers/mock/intent";
import type { Citation } from "@/types/agent";

interface ParsedToolResult {
  ok: boolean;
  summary?: string;
  error?: string;
  data?: unknown;
  citations?: Citation[];
}

const READ_ONLY_TOOLS = new Set([
  "getCustomer",
  "searchCustomers",
  "getOrder",
  "searchOrders",
  "getOrderHistory",
  "getCustomerOrderHistory",
  "getCustomerTickets",
  "getTicket",
  "searchKnowledgeBase",
]);

/**
 * Deterministic stand-in for a tool-calling LLM.
 *
 * It reproduces the two behaviours the agent loop depends on: choosing a tool
 * (with arguments) from a natural-language request, and writing a final answer
 * once tool results are available. Answers are composed from the tools' own
 * factual summaries, so the mock can never hallucinate a value that is not in
 * the database.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  readonly model = "flowpilot-mock-1";
  readonly embeddingModel = "flowpilot-hash-1536";
  readonly supportsStreaming = false;

  async generateWithTools(options: GenerateOptions): Promise<GenerateResult> {
    const userMessage = lastUserMessage(options.messages);
    const steps = collectSteps(options.messages);
    const allowed = new Set((options.tools ?? []).map((tool) => tool.name));

    const plan = planNextStep({ userMessage, steps });

    if (plan.kind === "tool" && allowed.has(plan.name)) {
      const toolCall: ProviderToolCall = {
        id: `mock_call_${steps.length + 1}`,
        name: plan.name,
        arguments: plan.arguments,
      };
      return {
        content: "",
        toolCalls: [toolCall],
        usage: usageFor(options, ""),
        model: this.model,
        finishReason: "tool_calls",
      };
    }

    // The planner chose a tool this user's role cannot run: say so instead of
    // silently answering with whatever was gathered so far.
    if (plan.kind === "tool" && !allowed.has(plan.name)) {
      const content = [
        `To do that I would need to run **${plan.name}**, which isn't available to your role in this session.`,
        steps.length > 0 ? `\nHere's what I found before stopping:\n${composeAnswer(userMessage, steps)}` : "",
        "\nAn administrator can run this action, or you can ask me for something else.",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        content,
        toolCalls: [],
        usage: usageFor(options, content),
        model: this.model,
        finishReason: "stop",
      };
    }

    const content =
      plan.kind === "answer" && plan.content
        ? plan.content
        : composeAnswer(userMessage, steps);

    return {
      content,
      toolCalls: [],
      usage: usageFor(options, content),
      model: this.model,
      finishReason: "stop",
    };
  }

  async generateResponse(options: GenerateOptions): Promise<GenerateResult> {
    const userMessage = lastUserMessage(options.messages);
    const steps = collectSteps(options.messages);
    const content = composeAnswer(userMessage, steps);
    return {
      content,
      toolCalls: [],
      usage: usageFor(options, content),
      model: this.model,
      finishReason: "stop",
    };
  }

  async generateEmbedding(input: string[]): Promise<number[][]> {
    return input.map((text) => embedText(text));
  }
}

/**
 * Extractive "generation": picks the sentences from retrieved passages that
 * overlap most with the question. A real LLM would paraphrase; the mock quotes,
 * which keeps every grounded answer verifiably faithful to the source.
 */
function extractRelevantSentences(question: string, citations: Citation[]): string {
  const questionTerms = new Set(tokenize(question));
  const candidates: Array<{ sentence: string; score: number }> = [];

  for (const [index, citation] of citations.slice(0, 3).entries()) {
    const sentences = citation.snippet
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.replace(/^[#\s*-]+/, "").trim())
      .filter(
        (sentence) =>
          sentence.length > 40 &&
          // Document front-matter, and fragments the snippet window cut short.
          !/^(version|owner|last reviewed)/i.test(sentence) &&
          !sentence.endsWith("…"),
      );

    for (const sentence of sentences) {
      const terms = new Set(tokenize(sentence));
      if (terms.size === 0) continue;
      // Distinct terms, so repeating one word from the question does not
      // outrank a sentence that covers more of it.
      const matched = [...terms].filter((term) => questionTerms.has(term)).length;
      candidates.push({
        sentence,
        // Prefer sentences that answer the question, then earlier citations.
        score: matched / Math.sqrt(terms.size) - index * 0.05,
      });
    }
  }

  if (candidates.length === 0) {
    return citations[0]!.snippet;
  }

  const best = candidates.sort((a, b) => b.score - a.score).slice(0, 2);
  const ordered = candidates.filter((candidate) => best.includes(candidate));
  return ordered.map((candidate) => candidate.sentence).join(" ");
}

function usageFor(options: GenerateOptions, content: string) {
  const promptTokens = options.messages.reduce(
    (sum, message) => sum + estimateTokens(message.content),
    0,
  );
  return { promptTokens, completionTokens: estimateTokens(content) };
}

function lastUserMessage(messages: GenerateOptions["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === "user") return messages[i]!.content;
  }
  return "";
}

/** Rebuilds the executed-tool timeline from the message list. */
function collectSteps(messages: GenerateOptions["messages"]): MockStep[] {
  const steps: MockStep[] = [];
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  const pending = new Map<string, { name: string; arguments: Record<string, unknown> }>();
  for (let i = lastUserIndex + 1; i < messages.length; i += 1) {
    const message = messages[i]!;
    if (message.role === "assistant" && message.toolCalls) {
      for (const call of message.toolCalls) {
        pending.set(call.id, { name: call.name, arguments: call.arguments });
      }
    }
    if (message.role === "tool") {
      const meta = message.toolCallId ? pending.get(message.toolCallId) : undefined;
      steps.push({
        name: meta?.name ?? message.name ?? "unknown",
        arguments: meta?.arguments ?? {},
        result: parseResult(message.content),
      });
    }
  }
  return steps;
}

function parseResult(content: string): ParsedToolResult {
  try {
    const parsed = JSON.parse(content) as ParsedToolResult;
    return { ...parsed, ok: parsed.ok !== false };
  } catch {
    return { ok: true, summary: content };
  }
}

/** Writes the final answer purely from tool summaries — never invents facts. */
export function composeAnswer(userMessage: string, steps: MockStep[]): string {
  if (steps.length === 0) {
    return "I wasn't able to find anything to act on in that request. Could you rephrase it, or include an order reference such as ORD-1004?";
  }

  const failed = steps.find((step) => step.result && step.result.ok === false);
  if (failed) {
    return `I couldn't complete that. ${failed.result?.error ?? "The action failed."}`;
  }

  const knowledgeStep = steps.find((step) => step.name === "searchKnowledgeBase");
  if (knowledgeStep) {
    const citations = (knowledgeStep.result?.citations ?? []) as Citation[];
    if (citations.length === 0) {
      return "The knowledge base does not contain enough information to answer that reliably. I'd rather not guess — consider uploading the relevant policy document, or I can escalate this to a human specialist.";
    }
    const answer = extractRelevantSentences(userMessage, citations);
    const sources = [...new Set(citations.slice(0, 3).map((citation) => citation.documentTitle))];
    return [
      `Based on our knowledge base: ${answer}`,
      "",
      `Source${sources.length > 1 ? "s" : ""}: ${sources.join(", ")}. Open a citation below to read the exact passage I used.`,
    ].join("\n");
  }

  const actions = steps.filter((step) => !READ_ONLY_TOOLS.has(step.name));
  const lookups = steps.filter((step) => READ_ONLY_TOOLS.has(step.name));

  const lines: string[] = [];
  for (const step of lookups) {
    if (step.result?.summary) lines.push(step.result.summary);
  }

  if (actions.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(actions.length === 1 ? "Here's what I did:" : "Here's what I did:");
    for (const step of actions) {
      if (step.result?.summary) lines.push(`• ${step.result.summary}`);
    }
  }

  if (lines.length === 0) {
    return "I ran the lookup but there was nothing to report.";
  }

  const askedAnything = /\?|\bwhat\b|\bwhich\b|\bwho\b|\bstatus\b/i.test(userMessage);
  if (askedAnything && actions.length === 0) {
    lines.push("");
    lines.push("Let me know if you'd like me to take an action on this.");
  }

  return lines.join("\n");
}
