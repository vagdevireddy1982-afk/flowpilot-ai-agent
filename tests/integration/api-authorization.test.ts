import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The router module pulls in Auth.js purely to build a request context. These
// tests supply their own context, so the session reader is stubbed out rather
// than dragging the Next request runtime into the test environment.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { runAgentTurn } from "@/lib/ai/agent/orchestrator";
import { prisma } from "@/lib/db/prisma";
import { agentRateLimiter } from "@/lib/rate-limit";
import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import type { Role } from "@/generated/prisma/enums";
import { createWorld, destroyWorld, type TestWorld } from "./helpers";

/**
 * Authorization at the API boundary, not at the service it delegates to.
 *
 * These call the router the way a request does, so they cover the permission
 * middleware and the error translation around it. A denial that arrives as an
 * INTERNAL_SERVER_ERROR is a bug even when the action was correctly refused:
 * the client cannot tell "you may not" from "we broke".
 */

const createCaller = createCallerFactory(appRouter);

function callerFor(user: { id: string; name: string; email: string; role: Role } | null) {
  return createCaller({ user, db: prisma, requestId: "test" });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error) {
    return error instanceof TRPCError ? error.code : `NOT_A_TRPC_ERROR: ${String(error)}`;
  }
}

describe("API authorization", () => {
  let world: TestWorld;
  let agent: ReturnType<typeof callerFor>;
  let viewer: ReturnType<typeof callerFor>;
  let admin: ReturnType<typeof callerFor>;

  beforeAll(async () => {
    world = await createWorld("AGENT");
    const [agentUser, adminUser] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: world.userId } }),
      prisma.user.findUniqueOrThrow({ where: { id: world.adminId } }),
    ]);
    const viewerUser = await prisma.user.create({
      data: {
        email: `${world.prefix}.viewer@test.local`,
        name: "Test Viewer",
        passwordHash: agentUser.passwordHash,
        role: "VIEWER",
      },
    });

    agent = callerFor(agentUser);
    admin = callerFor(adminUser);
    viewer = callerFor(viewerUser);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: `${world.prefix}.viewer@test.local` } });
    await destroyWorld(world);
  });

  it("refuses an operator the actions their role does not carry", async () => {
    expect(await codeOf(agent.order.cancel({ id: world.orderReference, reason: "no" }))).toBe(
      "FORBIDDEN",
    );
    expect(await codeOf(agent.order.refund({ id: world.orderReference, reason: "no" }))).toBe(
      "FORBIDDEN",
    );
  });

  it("keeps a viewer read-only", async () => {
    expect(await codeOf(viewer.agent.createConversation({}))).toBe("FORBIDDEN");
    expect(
      await codeOf(viewer.customer.create({ name: "Nope", email: "nope@test.local" })),
    ).toBe("FORBIDDEN");

    // Reading still works, so the denial is about the action and not the role.
    await expect(viewer.customer.list({ limit: 1 })).resolves.toBeDefined();
  });

  it("rejects a signed-out caller before any permission check", async () => {
    expect(await codeOf(callerFor(null).customer.list({ limit: 1 }))).toBe("UNAUTHORIZED");
  });

  it("will not let an operator approve what their role cannot perform", async () => {
    // A real refund proposal, gated the way the product gates it.
    agentRateLimiter.reset();
    const conversation = await prisma.conversation.create({
      data: { userId: world.adminId, title: "refund" },
    });
    const turn = await runAgentTurn({
      conversationId: conversation.id,
      userId: world.adminId,
      message: `Refund order ${world.orderReference}.`,
    });
    expect(turn.status).toBe("awaiting_approval");
    const approvalId = turn.awaitingApprovalId!;

    expect(await codeOf(agent.approval.decide({ id: approvalId, approve: true }))).toBe("FORBIDDEN");

    const untouched = await prisma.approval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(untouched.status).toBe("PENDING");
    expect(untouched.decidedById).toBeNull();

    await expect(admin.approval.decide({ id: approvalId, approve: false })).resolves.toBeDefined();
  });

  it("reports a missing record as not found rather than a server fault", async () => {
    expect(await codeOf(admin.order.detail({ id: "ORD-000000" }))).toBe("NOT_FOUND");
  });

  it("reports invalid input as a bad request", async () => {
    expect(await codeOf(admin.ticket.create({ subject: "" } as never))).toBe("BAD_REQUEST");
  });
});
