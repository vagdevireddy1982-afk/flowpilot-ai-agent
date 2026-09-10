import { z } from "zod";
import type { ProviderToolCall } from "@/lib/ai/provider";
import { classifyRisk } from "@/lib/ai/risk";
import { getTool } from "@/lib/ai/tools/registry";
import type { ToolContext, ToolPreview } from "@/lib/ai/tools/types";
import { hasPermission } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";
import { isAppError, toUserMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/services/audit-service";
import type { ToolResult } from "@/types/agent";

/** How long a pending approval stays actionable. */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export type ExecutionOutcome =
  | { kind: "executed"; toolCallId: string; result: ToolResult; durationMs: number }
  | {
      kind: "awaiting_approval";
      toolCallId: string;
      approvalId: string;
      preview: ToolPreview;
      riskReasons: string[];
    };

export interface ExecuteOptions {
  call: ProviderToolCall;
  context: ToolContext;
  autoApproveMediumRisk: boolean;
}

/**
 * The single choke point between the model and the business layer.
 *
 * Order matters: unknown tool → permission → schema validation → risk →
 * approval gate → execution → audit. Nothing the model produces is trusted;
 * arguments are re-parsed with the tool's own Zod schema and the *validated*
 * output is what actually reaches the service layer.
 */
export async function executeToolCall(options: ExecuteOptions): Promise<ExecutionOutcome> {
  const { call, context, autoApproveMediumRisk } = options;
  const startedAt = Date.now();
  const tool = getTool(call.name);

  if (!tool) {
    return failClosed(context, call, "UNKNOWN_TOOL", `The tool "${call.name}" does not exist.`);
  }

  if (!hasPermission(context.role, tool.permission)) {
    return failClosed(
      context,
      call,
      "FORBIDDEN",
      `Your role (${context.role}) is not permitted to run ${call.name}.`,
    );
  }

  const parsed = tool.schema.safeParse(call.arguments);
  if (!parsed.success) {
    return failClosed(
      context,
      call,
      "INVALID_ARGUMENTS",
      `Invalid arguments for ${call.name}: ${formatIssues(parsed.error)}`,
    );
  }
  const args = parsed.data as Record<string, unknown>;

  const risk = classifyRisk(call.name, args, { autoApproveMediumRisk });

  if (risk.requiresApproval) {
    const preview = tool.preview
      ? await tool.preview(args, context)
      : genericPreview(call.name, args);

    const toolCall = await prisma.toolCall.create({
      data: {
        conversationId: context.conversationId,
        name: call.name,
        args: args as never,
        status: "AWAITING_APPROVAL",
        riskLevel: risk.level,
      },
    });

    const approval = await prisma.approval.create({
      data: {
        toolCallId: toolCall.id,
        conversationId: context.conversationId,
        toolName: call.name,
        args: args as never,
        summary: preview.title,
        riskLevel: risk.level,
        requestedById: context.userId,
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
      },
    });

    await recordAudit({
      action: "agent.approval_requested",
      actorType: "AGENT",
      userId: context.userId,
      conversationId: context.conversationId,
      toolCallId: toolCall.id,
      tool: call.name,
      input: args,
      riskLevel: risk.level,
      approvalStatus: "PENDING",
      success: true,
    });

    return {
      kind: "awaiting_approval",
      toolCallId: toolCall.id,
      approvalId: approval.id,
      preview,
      riskReasons: risk.reasons,
    };
  }

  const toolCall = await prisma.toolCall.create({
    data: {
      conversationId: context.conversationId,
      name: call.name,
      args: args as never,
      status: "RUNNING",
      riskLevel: risk.level,
    },
  });

  const result = await runTool(tool.name, args, context);
  const durationMs = Date.now() - startedAt;

  await prisma.toolCall.update({
    where: { id: toolCall.id },
    data: {
      status: result.ok ? "SUCCESS" : "FAILED",
      result: result as never,
      error: result.ok ? null : result.error,
      durationMs,
      completedAt: new Date(),
    },
  });

  await recordAudit({
    action: `agent.tool.${call.name}`,
    actorType: "AGENT",
    userId: context.userId,
    conversationId: context.conversationId,
    toolCallId: toolCall.id,
    tool: call.name,
    entityType: entityTypeFor(call.name),
    entityId: entityIdFrom(args),
    input: args,
    output: result,
    success: result.ok,
    riskLevel: risk.level,
    errorMessage: result.ok ? null : result.error,
    durationMs,
  });

  return { kind: "executed", toolCallId: toolCall.id, result, durationMs };
}

/** Runs an already-approved tool call. Risk and permissions are re-checked. */
export async function executeApprovedCall(
  toolCallId: string,
  context: ToolContext,
): Promise<{ result: ToolResult; durationMs: number }> {
  const startedAt = Date.now();
  const record = await prisma.toolCall.findUniqueOrThrow({ where: { id: toolCallId } });
  const tool = getTool(record.name);

  if (!tool || !hasPermission(context.role, tool.permission)) {
    const result: ToolResult = {
      ok: false,
      code: "FORBIDDEN",
      error: `This action can no longer be executed under your current role (${context.role}).`,
    };
    await prisma.toolCall.update({
      where: { id: toolCallId },
      data: { status: "FAILED", error: result.error, completedAt: new Date() },
    });
    return { result, durationMs: Date.now() - startedAt };
  }

  // Re-validate: the stored arguments are replayed through the same schema.
  const parsed = tool.schema.safeParse(record.args);
  if (!parsed.success) {
    const result: ToolResult = {
      ok: false,
      code: "INVALID_ARGUMENTS",
      error: `Stored arguments are no longer valid: ${formatIssues(parsed.error)}`,
    };
    await prisma.toolCall.update({
      where: { id: toolCallId },
      data: { status: "FAILED", error: result.error, completedAt: new Date() },
    });
    return { result, durationMs: Date.now() - startedAt };
  }

  const result = await runTool(record.name, parsed.data as Record<string, unknown>, context);
  const durationMs = Date.now() - startedAt;

  await prisma.toolCall.update({
    where: { id: toolCallId },
    data: {
      status: result.ok ? "SUCCESS" : "FAILED",
      result: result as never,
      error: result.ok ? null : result.error,
      durationMs,
      completedAt: new Date(),
    },
  });

  await recordAudit({
    action: `agent.tool.${record.name}`,
    actorType: "AGENT",
    userId: context.userId,
    conversationId: context.conversationId,
    toolCallId,
    tool: record.name,
    entityType: entityTypeFor(record.name),
    entityId: entityIdFrom(parsed.data as Record<string, unknown>),
    input: parsed.data,
    output: result,
    success: result.ok,
    riskLevel: record.riskLevel,
    approvalStatus: "APPROVED",
    errorMessage: result.ok ? null : result.error,
    durationMs,
  });

  return { result, durationMs };
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) return { ok: false, code: "UNKNOWN_TOOL", error: `Unknown tool ${name}.` };
  try {
    return await tool.execute(args, context);
  } catch (error) {
    logger.error("agent.tool_failed", {
      tool: name,
      conversationId: context.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      code: isAppError(error) ? error.code : "INTERNAL",
      error: toUserMessage(error),
    };
  }
}

async function failClosed(
  context: ToolContext,
  call: ProviderToolCall,
  code: string,
  message: string,
): Promise<ExecutionOutcome> {
  const toolCall = await prisma.toolCall.create({
    data: {
      conversationId: context.conversationId,
      name: call.name,
      args: (call.arguments ?? {}) as never,
      status: "FAILED",
      riskLevel: "LOW",
      error: message,
      completedAt: new Date(),
    },
  });

  await recordAudit({
    action: "agent.tool_rejected",
    actorType: "AGENT",
    userId: context.userId,
    conversationId: context.conversationId,
    toolCallId: toolCall.id,
    tool: call.name,
    input: call.arguments,
    success: false,
    errorMessage: message,
    riskLevel: "LOW",
  });

  logger.warn("agent.tool_rejected", { tool: call.name, code, userId: context.userId });

  return {
    kind: "executed",
    toolCallId: toolCall.id,
    result: { ok: false, code, error: message },
    durationMs: 0,
  };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "argument"} — ${issue.message}`)
    .join("; ");
}

function genericPreview(name: string, args: Record<string, unknown>): ToolPreview {
  return {
    title: `Run ${name}`,
    description: "This action needs your approval before it runs.",
    facts: Object.entries(args)
      .slice(0, 8)
      .map(([label, value]) => ({ label, value: String(value) })),
  };
}

function entityTypeFor(toolName: string): string | null {
  if (/order|refund/i.test(toolName)) return "Order";
  if (/ticket/i.test(toolName)) return "SupportTicket";
  if (/customer/i.test(toolName)) return "Customer";
  if (/email/i.test(toolName)) return "Email";
  if (/knowledge/i.test(toolName)) return "KnowledgeDocument";
  return null;
}

function entityIdFrom(args: Record<string, unknown>): string | null {
  for (const key of ["orderId", "ticketId", "customerId", "documentId"]) {
    const value = args[key];
    if (typeof value === "string") return value;
  }
  return null;
}
