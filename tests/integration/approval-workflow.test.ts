import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgentTurn } from "@/lib/ai/agent/orchestrator";
import { prisma } from "@/lib/db/prisma";
import { agentRateLimiter } from "@/lib/rate-limit";
import { decideApproval } from "@/server/services/approval-service";
import { createWorld, destroyWorld, type TestWorld } from "./helpers";

async function proposeRefund(world: TestWorld, userId: string) {
  agentRateLimiter.reset();
  const conversation = await prisma.conversation.create({
    data: { userId, title: "refund" },
  });
  return runAgentTurn({
    conversationId: conversation.id,
    userId,
    message: `Refund order ${world.orderReference}.`,
  });
}

describe("human-in-the-loop approval", () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createWorld("ADMIN");
  });

  afterAll(async () => {
    await destroyWorld(world);
  });

  it("stops a refund at the approval gate instead of executing it", async () => {
    const turn = await proposeRefund(world, world.userId);

    expect(turn.status).toBe("awaiting_approval");
    expect(turn.awaitingApprovalId).toBeTruthy();
    expect(turn.content).toContain("12,499");
    expect(turn.content).toMatch(/proceed\?/i);

    const approval = await prisma.approval.findUniqueOrThrow({
      where: { id: turn.awaitingApprovalId! },
      include: { toolCall: true },
    });
    expect(approval.status).toBe("PENDING");
    expect(approval.riskLevel).toBe("HIGH");
    expect(approval.toolCall.status).toBe("AWAITING_APPROVAL");

    // Nothing has actually happened to the order yet.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: world.orderId } });
    expect(order.refundedAmountMinor).toBe(0);
    expect(order.paymentStatus).toBe("PAID");
    expect(await prisma.refund.count({ where: { orderId: world.orderId } })).toBe(0);
  });

  it("executes the action only once a human approves", async () => {
    const turn = await proposeRefund(world, world.userId);
    const decision = await decideApproval({
      approvalId: turn.awaitingApprovalId!,
      approve: true,
      decider: { id: world.userId, role: "ADMIN" },
    });

    expect(decision.status).toBe("APPROVED");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: world.orderId } });
    expect(order.refundedAmountMinor).toBe(1_249_900);
    expect(order.paymentStatus).toBe("REFUNDED");

    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId: world.orderId } });
    expect(refund.amountMinor).toBe(1_249_900);
    expect(refund.actorType).toBe("AGENT");

    const message = await prisma.message.findUniqueOrThrow({
      where: { id: decision.assistantMessageId },
    });
    expect(message.content).toMatch(/refunded/i);

    // Reset for the remaining cases.
    await prisma.refund.deleteMany({ where: { orderId: world.orderId } });
    await prisma.order.update({
      where: { id: world.orderId },
      data: { refundedAmountMinor: 0, paymentStatus: "PAID", status: "SHIPPED" },
    });
  });

  it("changes nothing when the request is rejected", async () => {
    const turn = await proposeRefund(world, world.userId);
    const decision = await decideApproval({
      approvalId: turn.awaitingApprovalId!,
      approve: false,
      note: "Finance will handle this one",
      decider: { id: world.userId, role: "ADMIN" },
    });

    expect(decision.status).toBe("REJECTED");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: world.orderId } });
    expect(order.refundedAmountMinor).toBe(0);

    const toolCall = await prisma.toolCall.findFirstOrThrow({
      where: { approval: { id: turn.awaitingApprovalId! } },
    });
    expect(toolCall.status).toBe("REJECTED");

    const message = await prisma.message.findUniqueOrThrow({
      where: { id: decision.assistantMessageId },
    });
    expect(message.content).toMatch(/rejected/i);
    expect(message.content).toMatch(/Nothing was changed/i);
  });

  it("refuses a second decision on the same request", async () => {
    const turn = await proposeRefund(world, world.userId);
    await decideApproval({
      approvalId: turn.awaitingApprovalId!,
      approve: false,
      decider: { id: world.userId, role: "ADMIN" },
    });

    await expect(
      decideApproval({
        approvalId: turn.awaitingApprovalId!,
        approve: true,
        decider: { id: world.userId, role: "ADMIN" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a decision from a role that cannot perform the action", async () => {
    const turn = await proposeRefund(world, world.userId);

    await expect(
      decideApproval({
        approvalId: turn.awaitingApprovalId!,
        approve: true,
        decider: { id: world.adminId, role: "VIEWER" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const approval = await prisma.approval.findUniqueOrThrow({
      where: { id: turn.awaitingApprovalId! },
    });
    expect(approval.status).toBe("PENDING");
  });

  it("expires a stale request rather than executing it late", async () => {
    const turn = await proposeRefund(world, world.userId);
    await prisma.approval.update({
      where: { id: turn.awaitingApprovalId! },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      decideApproval({
        approvalId: turn.awaitingApprovalId!,
        approve: true,
        decider: { id: world.userId, role: "ADMIN" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const approval = await prisma.approval.findUniqueOrThrow({
      where: { id: turn.awaitingApprovalId! },
    });
    expect(approval.status).toBe("EXPIRED");
    expect(await prisma.refund.count({ where: { orderId: world.orderId } })).toBe(0);
  });
});

describe("role limits on high-risk tools", () => {
  let operatorWorld: TestWorld;

  beforeAll(async () => {
    operatorWorld = await createWorld("AGENT");
  });

  afterAll(async () => {
    await destroyWorld(operatorWorld);
  });

  it("never even proposes a refund to an operator who cannot issue one", async () => {
    const turn = await proposeRefund(operatorWorld, operatorWorld.userId);

    expect(turn.status).toBe("completed");
    expect(turn.awaitingApprovalId).toBeUndefined();
    expect(turn.content).toMatch(/isn't available to your role/i);

    const approvals = await prisma.approval.count({
      where: { conversationId: turn.conversationId },
    });
    expect(approvals).toBe(0);
  });
});
