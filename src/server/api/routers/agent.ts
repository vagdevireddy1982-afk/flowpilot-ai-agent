import { z } from "zod";
import { runAgentTurn } from "@/lib/ai/agent/orchestrator";
import { listToolsForRole, toToolSpec } from "@/lib/ai/tools/registry";
import { BASE_RISK } from "@/lib/ai/risk";
import { permissionProcedure, protectedProcedure, router } from "@/server/api/trpc";
import {
  createConversation,
  deleteConversation,
  getConversationDetail,
  listConversations,
  renameConversation,
  setConversationPinned,
} from "@/server/services/conversation-service";
import { getRuntimeConfig } from "@/server/services/settings-service";

export const agentRouter = router({
  conversations: protectedProcedure.query(({ ctx }) => listConversations(ctx.user.id)),

  conversation: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input, ctx }) => getConversationDetail(input.id, ctx.user.id)),

  createConversation: permissionProcedure("agent:use")
    .input(z.object({ title: z.string().trim().max(70).optional() }))
    .mutation(({ input, ctx }) => createConversation(ctx.user.id, input.title)),

  renameConversation: permissionProcedure("agent:use")
    .input(z.object({ id: z.string().min(1), title: z.string().trim().min(1).max(70) }))
    .mutation(({ input, ctx }) => renameConversation(input.id, ctx.user.id, input.title)),

  pinConversation: permissionProcedure("agent:use")
    .input(z.object({ id: z.string().min(1), pinned: z.boolean() }))
    .mutation(({ input, ctx }) => setConversationPinned(input.id, ctx.user.id, input.pinned)),

  deleteConversation: permissionProcedure("agent:use")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input, ctx }) => deleteConversation(input.id, ctx.user.id)),

  sendMessage: permissionProcedure("agent:use")
    .input(
      z.object({
        conversationId: z.string().min(1),
        message: z.string().trim().min(1).max(4000),
      }),
    )
    .mutation(({ input, ctx }) =>
      runAgentTurn({
        conversationId: input.conversationId,
        userId: ctx.user.id,
        message: input.message,
      }),
    ),

  /** Powers the "what can this agent do" panel — real registry, real risk levels. */
  capabilities: protectedProcedure.query(async ({ ctx }) => {
    const tools = listToolsForRole(ctx.user.role).map((tool) => ({
      name: tool.name,
      description: tool.description,
      permission: tool.permission,
      risk: BASE_RISK[tool.name] ?? "HIGH",
      parameters: toToolSpec(tool).parameters,
    }));
    return { tools, runtime: await getRuntimeConfig() };
  }),
});
