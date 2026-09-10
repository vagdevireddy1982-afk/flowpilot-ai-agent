import { z } from "zod";
import { permissionProcedure, router } from "@/server/api/trpc";
import { recordAudit } from "@/server/services/audit-service";
import {
  deleteDocument,
  getChunk,
  getDocument,
  knowledgeStats,
  listDocuments,
  searchKnowledge,
} from "@/server/services/knowledge-service";
import { ingestDocument } from "@/lib/ai/rag/ingest";

export const knowledgeRouter = router({
  list: permissionProcedure("knowledge:read").query(() => listDocuments()),

  stats: permissionProcedure("knowledge:read").query(() => knowledgeStats()),

  document: permissionProcedure("knowledge:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input }) => getDocument(input.id)),

  chunk: permissionProcedure("knowledge:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input }) => getChunk(input.id)),

  search: permissionProcedure("knowledge:read")
    .input(z.object({ query: z.string().trim().min(2), limit: z.number().int().min(1).max(10).default(6) }))
    .query(({ input }) => searchKnowledge(input.query, input.limit)),

  reindex: permissionProcedure("knowledge:write")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const result = await ingestDocument(input.id);
      await recordAudit({
        action: "knowledge.reindexed",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "KnowledgeDocument",
        entityId: input.id,
        output: result,
        riskLevel: "MEDIUM",
      });
      return result;
    }),

  delete: permissionProcedure("knowledge:write")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const deleted = await deleteDocument(input.id);
      await recordAudit({
        action: "knowledge.deleted",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "KnowledgeDocument",
        entityId: input.id,
        output: deleted,
        riskLevel: "MEDIUM",
      });
      return deleted;
    }),
});
