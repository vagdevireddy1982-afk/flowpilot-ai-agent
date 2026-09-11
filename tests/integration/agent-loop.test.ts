import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgentTurn } from "@/lib/ai/agent/orchestrator";
import { prisma } from "@/lib/db/prisma";
import { agentRateLimiter } from "@/lib/rate-limit";
import { createWorld, destroyWorld, TEST_CUSTOMER_NAME, type TestWorld } from "./helpers";

/**
 * These exercise the whole loop against Postgres: context assembly, tool
 * selection, validation, risk classification, execution and persistence.
 */
describe("agent turn", () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createWorld("ADMIN");
  });

  afterAll(async () => {
    await destroyWorld(world);
  });

  async function turn(message: string, userId = world.userId) {
    agentRateLimiter.reset();
    const conversation = await prisma.conversation.create({
      data: { userId, title: message.slice(0, 60) },
    });
    return runAgentTurn({ conversationId: conversation.id, userId, message });
  }

  it("answers an order lookup from the database", async () => {
    const result = await turn(`Show me order ${world.orderReference}.`);

    expect(result.status).toBe("completed");
    expect(result.content).toContain(world.orderReference);
    expect(result.content).toContain(TEST_CUSTOMER_NAME);
    expect(result.content).toContain("12,499");
    expect(result.toolCallIds).toHaveLength(1);

    const call = await prisma.toolCall.findUniqueOrThrow({ where: { id: result.toolCallIds[0]! } });
    expect(call.name).toBe("getOrder");
    expect(call.status).toBe("SUCCESS");
    expect(call.riskLevel).toBe("LOW");
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("persists the user and assistant messages", async () => {
    const result = await turn(`Find customer ${TEST_CUSTOMER_NAME}.`);
    const messages = await prisma.message.findMany({
      where: { conversationId: result.conversationId },
      orderBy: { createdAt: "asc" },
    });

    expect(messages[0]!.role).toBe("USER");
    expect(messages.some((message) => message.role === "TOOL")).toBe(true);
    expect(messages[messages.length - 1]!.role).toBe("ASSISTANT");
  });

  it("titles a new conversation from the first message", async () => {
    const result = await turn(`Find customer ${TEST_CUSTOMER_NAME}.`);
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: result.conversationId },
    });
    expect(conversation.title).toContain(TEST_CUSTOMER_NAME);
  });

  it("records a run for analytics", async () => {
    const result = await turn(`Show me order ${world.orderReference}.`);
    const run = await prisma.agentRun.findFirstOrThrow({
      where: { conversationId: result.conversationId },
    });

    expect(run.status).toBe("completed");
    expect(run.provider).toBe("mock");
    expect(run.toolCallCount).toBeGreaterThan(0);
    expect(run.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a missing record instead of inventing one", async () => {
    const result = await turn("Show me order ORD-999999.");
    expect(result.content).toMatch(/not found/i);

    const call = await prisma.toolCall.findFirstOrThrow({
      where: { conversationId: result.conversationId },
    });
    expect(call.status).toBe("FAILED");
    expect(call.error).toMatch(/not found/i);
  });

  it("answers a policy question with citations that resolve to stored chunks", async () => {
    const result = await turn("According to our refund policy, how long do customers have?");

    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.content).toMatch(/30 days|thirty days/i);

    for (const citation of result.citations) {
      const chunk = await prisma.knowledgeChunk.findUnique({ where: { id: citation.chunkId } });
      expect(chunk).not.toBeNull();
      expect(chunk!.documentId).toBe(citation.documentId);
    }
  });

  it("declines to answer when the knowledge base has nothing relevant", async () => {
    const result = await turn("What does our policy say about interplanetary shipping to Mars?");
    expect(result.content).toMatch(/not contain enough information|does not contain/i);
    expect(result.citations).toHaveLength(0);
  });

  it("keeps conversation context across turns", async () => {
    agentRateLimiter.reset();
    const conversation = await prisma.conversation.create({
      data: { userId: world.userId, title: "context" },
    });

    await runAgentTurn({
      conversationId: conversation.id,
      userId: world.userId,
      message: `Show me order ${world.orderReference}.`,
    });
    agentRateLimiter.reset();
    await runAgentTurn({
      conversationId: conversation.id,
      userId: world.userId,
      message: `Find customer ${TEST_CUSTOMER_NAME}.`,
    });

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id, role: { in: ["USER", "ASSISTANT"] } },
    });
    expect(messages.length).toBeGreaterThanOrEqual(4);
  });

  it("refuses to open someone else's conversation", async () => {
    const otherConversation = await prisma.conversation.create({
      data: { userId: world.adminId, title: "not yours" },
    });

    await expect(
      runAgentTurn({
        conversationId: otherConversation.id,
        userId: world.userId,
        message: "Show me anything.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rate-limits a burst of turns", async () => {
    agentRateLimiter.reset();
    const conversation = await prisma.conversation.create({
      data: { userId: world.userId, title: "burst" },
    });

    let limited = false;
    for (let i = 0; i < 14; i += 1) {
      try {
        await runAgentTurn({
          conversationId: conversation.id,
          userId: world.userId,
          message: `Find customer ${TEST_CUSTOMER_NAME}.`,
        });
      } catch (error) {
        if ((error as { code?: string }).code === "RATE_LIMITED") {
          limited = true;
          break;
        }
        throw error;
      }
    }
    expect(limited).toBe(true);
    agentRateLimiter.reset();
  });
});
