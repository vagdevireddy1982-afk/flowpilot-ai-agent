import type { ApprovalStatus, Role } from "@/generated/prisma/enums";
import { recordRejection, resumeAfterApproval } from "@/lib/ai/agent/orchestrator";
import { getTool } from "@/lib/ai/tools/registry";
import { hasPermission } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { recordAudit } from "@/server/services/audit-service";

export const APPROVAL_INCLUDE = {
  requestedBy: { select: { id: true, name: true, email: true, avatarColor: true } },
  decidedBy: { select: { id: true, name: true, email: true } },
  conversation: { select: { id: true, title: true } },
  toolCall: { select: { id: true, status: true, result: true, error: true } },
} as const;

export async function listApprovals(filters: { status?: ApprovalStatus; limit?: number }) {
  return prisma.approval.findMany({
    where: { status: filters.status },
    include: APPROVAL_INCLUDE,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: Math.min(filters.limit ?? 50, 100),
  });
}

export async function getApproval(id: string) {
  const approval = await prisma.approval.findUnique({ where: { id }, include: APPROVAL_INCLUDE });
  if (!approval) throw notFound("Approval", id);
  return approval;
}

export interface Decider {
  id: string;
  role: Role;
}

/**
 * Who may decide an approval: the operator who requested it (provided they
 * personally hold the permission the tool requires) or anyone with the
 * dedicated `approval:decide` permission. This is what stops an AGENT from
 * self-approving a refund their role could never perform directly.
 */
export function canDecide(
  approval: { requestedById: string; toolName: string },
  decider: Decider,
): boolean {
  if (hasPermission(decider.role, "approval:decide")) return true;
  const tool = getTool(approval.toolName);
  if (!tool) return false;
  return approval.requestedById === decider.id && hasPermission(decider.role, tool.permission);
}

export async function decideApproval(input: {
  approvalId: string;
  decider: Decider;
  approve: boolean;
  note?: string;
}) {
  const approval = await getApproval(input.approvalId);

  if (approval.status !== "PENDING") {
    throw conflict(`This request was already ${approval.status.toLowerCase()}.`);
  }
  if (approval.expiresAt.getTime() < Date.now()) {
    await prisma.approval.update({
      where: { id: approval.id },
      data: { status: "EXPIRED" },
    });
    throw conflict("This approval request has expired. Ask the agent to propose the action again.");
  }
  if (!canDecide(approval, input.decider)) {
    throw forbidden(`approve ${approval.toolName}`);
  }

  const status: ApprovalStatus = input.approve ? "APPROVED" : "REJECTED";
  await prisma.approval.update({
    where: { id: approval.id },
    data: {
      status,
      decidedById: input.decider.id,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
    },
  });

  await recordAudit({
    action: input.approve ? "approval.approved" : "approval.rejected",
    actorType: "USER",
    userId: input.decider.id,
    conversationId: approval.conversationId,
    toolCallId: approval.toolCallId,
    tool: approval.toolName,
    input: approval.args,
    riskLevel: approval.riskLevel,
    approvalStatus: status,
    success: true,
  });

  if (!input.approve) {
    await prisma.toolCall.update({
      where: { id: approval.toolCallId },
      data: { status: "REJECTED", completedAt: new Date() },
    });
    const message = await recordRejection(approval.id, input.note);
    return { status, assistantMessageId: message.id, conversationId: approval.conversationId };
  }

  const turn = await resumeAfterApproval({
    approvalId: approval.id,
    actingUserId: input.decider.id,
  });

  return {
    status,
    assistantMessageId: turn.assistantMessageId,
    conversationId: approval.conversationId,
  };
}

export async function countPendingApprovals() {
  return prisma.approval.count({ where: { status: "PENDING" } });
}
