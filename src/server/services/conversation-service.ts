import { prisma } from "@/lib/db/prisma";
import { forbidden, notFound } from "@/lib/errors";
import type { AssistantMessageMetadata, ToolResult } from "@/types/agent";

export async function listConversations(userId: string, limit = 50) {
  return prisma.conversation.findMany({
    where: { userId },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      title: true,
      pinned: true,
      updatedAt: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
  });
}

export async function createConversation(userId: string, title?: string) {
  return prisma.conversation.create({
    data: { userId, title: title?.slice(0, 70) || "New conversation" },
    select: { id: true, title: true, createdAt: true, updatedAt: true, pinned: true },
  });
}

async function assertOwnership(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, userId: true, title: true, pinned: true },
  });
  if (!conversation) throw notFound("Conversation", conversationId);
  if (conversation.userId !== userId) throw forbidden("open this conversation");
  return conversation;
}

export interface ConversationToolCallView {
  id: string;
  name: string;
  status: string;
  riskLevel: string;
  durationMs: number | null;
  error: string | null;
  args: unknown;
  result: ToolResult | null;
  createdAt: Date;
  approval: {
    id: string;
    status: string;
    summary: string;
    riskLevel: string;
    decidedAt: Date | null;
    decisionNote: string | null;
  } | null;
}

/** Everything the chat UI needs to render one conversation. */
export async function getConversationDetail(conversationId: string, userId: string) {
  await assertOwnership(conversationId, userId);

  const [conversation, messages, toolCalls] = await Promise.all([
    prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { id: true, title: true, pinned: true, createdAt: true, updatedAt: true },
    }),
    prisma.message.findMany({
      where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, metadata: true, createdAt: true },
    }),
    prisma.toolCall.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: {
        approval: {
          select: {
            id: true,
            status: true,
            summary: true,
            riskLevel: true,
            decidedAt: true,
            decisionNote: true,
          },
        },
      },
    }),
  ]);

  return {
    conversation,
    messages: messages.map((message) => ({
      ...message,
      metadata: (message.metadata ?? {}) as AssistantMessageMetadata,
    })),
    toolCalls: toolCalls.map(
      (call): ConversationToolCallView => ({
        id: call.id,
        name: call.name,
        status: call.status,
        riskLevel: call.riskLevel,
        durationMs: call.durationMs,
        error: call.error,
        args: call.args,
        result: (call.result ?? null) as ToolResult | null,
        createdAt: call.createdAt,
        approval: call.approval,
      }),
    ),
  };
}

export async function renameConversation(conversationId: string, userId: string, title: string) {
  await assertOwnership(conversationId, userId);
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { title: title.slice(0, 70) },
    select: { id: true, title: true },
  });
}

export async function setConversationPinned(
  conversationId: string,
  userId: string,
  pinned: boolean,
) {
  await assertOwnership(conversationId, userId);
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { pinned },
    select: { id: true, pinned: true },
  });
}

export async function deleteConversation(conversationId: string, userId: string) {
  await assertOwnership(conversationId, userId);
  await prisma.conversation.delete({ where: { id: conversationId } });
  return { id: conversationId };
}
