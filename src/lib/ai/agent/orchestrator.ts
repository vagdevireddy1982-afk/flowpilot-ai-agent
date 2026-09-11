import { executeApprovedCall, executeToolCall } from "@/lib/ai/agent/executor";
import { buildConversationContext, DEFAULT_BUDGET } from "@/lib/ai/memory/context";
import { buildSystemPrompt } from "@/lib/ai/prompts/system";
import type { ChatMessage, GenerateResult } from "@/lib/ai/provider";
import { getAIProvider } from "@/lib/ai/providers";
import { getToolSpecs, listToolsForRole } from "@/lib/ai/tools/registry";
import type { ToolContext } from "@/lib/ai/tools/types";
import { prisma } from "@/lib/db/prisma";
import { forbidden, notFound, toUserMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { agentRateLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/server/services/audit-service";
import { getSettings } from "@/server/services/settings-service";
import type {
  AgentTurnResult,
  AssistantMessageMetadata,
  Citation,
  ToolResult,
} from "@/types/agent";

/** Safety valve against a model that keeps requesting tools forever. */
const MAX_TOOL_STEPS = 5;

/** Rough blended $/1K tokens, stored in micro-dollars for cost reporting. */
const COST_PER_1K_TOKENS_USD = 0.0006;

export interface AgentTurnInput {
  conversationId: string;
  userId: string;
  message: string;
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const startedAt = Date.now();
  await agentRateLimiter.check(`agent:${input.userId}`);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, email: true, role: true },
  });
  const settings = await getSettings();
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
  });

  if (!user) throw notFound("User", input.userId);
  if (!conversation) throw notFound("Conversation", input.conversationId);
  if (conversation.userId !== user.id) throw forbidden("open this conversation");

  const provider = getAIProvider();
  const toolContext: ToolContext = {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    role: user.role,
    conversationId: conversation.id,
  };

  await prisma.message.create({
    data: { conversationId: conversation.id, role: "USER", content: input.message },
  });

  // First user message doubles as the conversation title.
  const messageCount = await prisma.message.count({
    where: { conversationId: conversation.id, role: "USER" },
  });
  if (messageCount === 1) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { title: input.message.slice(0, 70) },
    });
  }

  const history = await buildConversationContext(conversation.id, {
    ...DEFAULT_BUDGET,
    maxMessages: settings.maxContextMessages,
  });

  const systemPrompt = buildSystemPrompt({
    organizationName: settings.name,
    userName: user.name,
    userRole: user.role,
    availableTools: listToolsForRole(user.role).map((tool) => tool.name),
    currency: settings.defaultCurrency,
  });

  // History already ends with the message we just stored.
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...history.messages];

  const citations: Citation[] = [];
  const toolCallIds: string[] = [];
  let usedKnowledge = false;
  let escalated = false;
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      const generation: GenerateResult = await provider.generateWithTools({
        messages,
        tools: getToolSpecs(user.role),
      });
      promptTokens += generation.usage.promptTokens;
      completionTokens += generation.usage.completionTokens;

      if (generation.toolCalls.length === 0) {
        const content =
          generation.content.trim() ||
          "I wasn't able to produce an answer for that. Could you rephrase the request?";
        const assistant = await persistAssistantMessage(conversation.id, content, {
          citations,
          provider: provider.name,
          model: generation.model,
          latencyMs: Date.now() - startedAt,
          usedKnowledge,
          escalated,
        });

        await finishRun({
          conversationId: conversation.id,
          userId: user.id,
          provider: provider.name,
          model: generation.model,
          status: "completed",
          latencyMs: Date.now() - startedAt,
          promptTokens,
          completionTokens,
          toolCallCount: toolCallIds.length,
          usedKnowledge,
          escalated,
        });

        return {
          conversationId: conversation.id,
          assistantMessageId: assistant.id,
          status: "completed",
          content,
          citations,
          toolCallIds,
          escalated,
          latencyMs: Date.now() - startedAt,
        };
      }

      // Only the first proposed call is executed per step: it keeps the audit
      // trail linear and lets each result inform the next decision.
      const call = generation.toolCalls[0]!;
      messages.push({ role: "assistant", content: generation.content, toolCalls: [call] });

      const outcome = await executeToolCall({
        call,
        context: toolContext,
        autoApproveMediumRisk: settings.autoApproveMediumRisk,
      });

      if (outcome.kind === "awaiting_approval") {
        toolCallIds.push(outcome.toolCallId);
        const content = buildApprovalPrompt(outcome.preview, outcome.riskReasons);
        const assistant = await persistAssistantMessage(conversation.id, content, {
          citations,
          provider: provider.name,
          model: generation.model,
          latencyMs: Date.now() - startedAt,
          usedKnowledge,
          awaitingApprovalId: outcome.approvalId,
        });
        await prisma.toolCall.update({
          where: { id: outcome.toolCallId },
          data: { messageId: assistant.id },
        });

        await finishRun({
          conversationId: conversation.id,
          userId: user.id,
          provider: provider.name,
          model: generation.model,
          status: "awaiting_approval",
          latencyMs: Date.now() - startedAt,
          promptTokens,
          completionTokens,
          toolCallCount: toolCallIds.length,
          usedKnowledge,
          escalated,
        });

        return {
          conversationId: conversation.id,
          assistantMessageId: assistant.id,
          status: "awaiting_approval",
          content,
          citations,
          toolCallIds,
          awaitingApprovalId: outcome.approvalId,
          escalated,
          latencyMs: Date.now() - startedAt,
        };
      }

      toolCallIds.push(outcome.toolCallId);
      collectSideEffects(outcome.result, call.name, citations, () => {
        usedKnowledge = true;
      });
      if (call.name === "escalateToHuman" && outcome.result.ok) escalated = true;

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "TOOL",
          content: JSON.stringify(outcome.result),
          metadata: { toolCallId: outcome.toolCallId, name: call.name } as never,
        },
      });

      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(outcome.result),
      });
    }

    // Loop budget exhausted — answer with what we have rather than looping on.
    const fallback =
      "I gathered several results but couldn't converge on a final answer within the step budget. Here's where I got to — ask me to continue and I'll pick up from these results.";
    const assistant = await persistAssistantMessage(conversation.id, fallback, {
      citations,
      provider: provider.name,
      model: provider.model,
      latencyMs: Date.now() - startedAt,
      usedKnowledge,
    });

    await finishRun({
      conversationId: conversation.id,
      userId: user.id,
      provider: provider.name,
      model: provider.model,
      status: "completed",
      latencyMs: Date.now() - startedAt,
      promptTokens,
      completionTokens,
      toolCallCount: toolCallIds.length,
      usedKnowledge,
      escalated,
    });

    return {
      conversationId: conversation.id,
      assistantMessageId: assistant.id,
      status: "completed",
      content: fallback,
      citations,
      toolCallIds,
      escalated,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = toUserMessage(error);
    logger.error("agent.turn_failed", {
      conversationId: conversation.id,
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    const assistant = await persistAssistantMessage(conversation.id, message, {
      provider: provider.name,
      model: provider.model,
      latencyMs: Date.now() - startedAt,
      error: message,
    });

    await finishRun({
      conversationId: conversation.id,
      userId: user.id,
      provider: provider.name,
      model: provider.model,
      status: "failed",
      latencyMs: Date.now() - startedAt,
      promptTokens,
      completionTokens,
      toolCallCount: toolCallIds.length,
      usedKnowledge,
      escalated,
      error: message,
    });

    await recordAudit({
      action: "agent.turn_failed",
      actorType: "AGENT",
      userId: user.id,
      conversationId: conversation.id,
      input: { message: input.message },
      success: false,
      errorMessage: message,
    });

    return {
      conversationId: conversation.id,
      assistantMessageId: assistant.id,
      status: "failed",
      content: message,
      citations,
      toolCallIds,
      escalated,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/**
 * Continues a turn that stopped at an approval gate: runs the approved tool,
 * feeds the result back to the model, and stores the final answer.
 */
export async function resumeAfterApproval(input: {
  approvalId: string;
  actingUserId: string;
}): Promise<AgentTurnResult> {
  const startedAt = Date.now();
  const approval = await prisma.approval.findUnique({
    where: { id: input.approvalId },
    include: { toolCall: true, conversation: true },
  });
  if (!approval) throw notFound("Approval", input.approvalId);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: approval.conversation.userId },
    select: { id: true, name: true, email: true, role: true },
  });
  const settings = await getSettings();

  const provider = getAIProvider();
  const toolContext: ToolContext = {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    role: user.role,
    conversationId: approval.conversationId,
  };

  const { result } = await executeApprovedCall(approval.toolCallId, toolContext);

  await prisma.message.create({
    data: {
      conversationId: approval.conversationId,
      role: "TOOL",
      content: JSON.stringify(result),
      metadata: { toolCallId: approval.toolCallId, name: approval.toolName } as never,
    },
  });

  const history = await buildConversationContext(approval.conversationId, {
    ...DEFAULT_BUDGET,
    maxMessages: settings.maxContextMessages,
  });

  const systemPrompt = buildSystemPrompt({
    organizationName: settings.name,
    userName: user.name,
    userRole: user.role,
    availableTools: listToolsForRole(user.role).map((tool) => tool.name),
    currency: settings.defaultCurrency,
  });

  const callId = `approved_${approval.toolCallId}`;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.messages,
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: callId,
          name: approval.toolName,
          arguments: approval.args as Record<string, unknown>,
        },
      ],
    },
    { role: "tool", toolCallId: callId, name: approval.toolName, content: JSON.stringify(result) },
  ];

  const generation = await provider.generateWithTools({
    messages,
    // No further tools on the resume step: the approved action is the last one.
    tools: [],
  });

  const content =
    generation.content.trim() ||
    (result.ok ? result.summary : `The approved action failed: ${result.error}`);

  const citations: Citation[] = [];
  collectSideEffects(result, approval.toolName, citations, () => undefined);

  const assistant = await persistAssistantMessage(approval.conversationId, content, {
    citations,
    provider: provider.name,
    model: generation.model,
    latencyMs: Date.now() - startedAt,
  });

  await finishRun({
    conversationId: approval.conversationId,
    userId: user.id,
    provider: provider.name,
    model: generation.model,
    status: result.ok ? "completed" : "failed",
    latencyMs: Date.now() - startedAt,
    promptTokens: generation.usage.promptTokens,
    completionTokens: generation.usage.completionTokens,
    toolCallCount: 1,
    usedKnowledge: false,
    escalated: false,
    error: result.ok ? undefined : result.error,
  });

  return {
    conversationId: approval.conversationId,
    assistantMessageId: assistant.id,
    status: result.ok ? "completed" : "failed",
    content,
    citations,
    toolCallIds: [approval.toolCallId],
    escalated: false,
    latencyMs: Date.now() - startedAt,
  };
}

/** Records the operator's rejection as a normal assistant turn. */
export async function recordRejection(approvalId: string, note?: string) {
  const approval = await prisma.approval.findUniqueOrThrow({
    where: { id: approvalId },
    include: { conversation: true },
  });

  const content = `I did not run **${approval.toolName}** — the action was rejected${
    note ? `: ${note}` : "."
  } Nothing was changed. Tell me how you'd like to proceed instead.`;

  return persistAssistantMessage(approval.conversationId, content, {});
}

async function persistAssistantMessage(
  conversationId: string,
  content: string,
  metadata: AssistantMessageMetadata,
) {
  const message = await prisma.message.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content,
      metadata: metadata as never,
    },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
  return message;
}

function collectSideEffects(
  result: ToolResult,
  toolName: string,
  citations: Citation[],
  markKnowledge: () => void,
) {
  if (!result.ok) return;
  if (toolName === "searchKnowledgeBase") markKnowledge();
  for (const citation of result.citations ?? []) {
    if (!citations.some((existing) => existing.chunkId === citation.chunkId)) {
      citations.push(citation);
    }
  }
}

function buildApprovalPrompt(
  preview: { title: string; description: string; facts: Array<{ label: string; value: string }> },
  reasons: string[],
): string {
  const facts = preview.facts.map((fact) => `- **${fact.label}:** ${fact.value}`).join("\n");
  return [
    `${preview.description}`,
    "",
    facts,
    "",
    reasons.length > 0 ? `_Why this needs approval: ${reasons.join("; ")}._` : "",
    "",
    "Do you want me to proceed?",
  ]
    .filter((line) => line !== undefined)
    .join("\n")
    .trim();
}

async function finishRun(run: {
  conversationId: string;
  userId: string;
  provider: string;
  model: string;
  status: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  toolCallCount: number;
  usedKnowledge: boolean;
  escalated: boolean;
  error?: string;
}) {
  const totalTokens = run.promptTokens + run.completionTokens;
  await prisma.agentRun.create({
    data: {
      conversationId: run.conversationId,
      userId: run.userId,
      provider: run.provider,
      model: run.model,
      status: run.status,
      latencyMs: run.latencyMs,
      promptTokens: run.promptTokens,
      completionTokens: run.completionTokens,
      costUsdMicros: Math.round((totalTokens / 1000) * COST_PER_1K_TOKENS_USD * 1_000_000),
      toolCallCount: run.toolCallCount,
      usedKnowledge: run.usedKnowledge,
      escalated: run.escalated,
      error: run.error ?? null,
    },
  });
}
