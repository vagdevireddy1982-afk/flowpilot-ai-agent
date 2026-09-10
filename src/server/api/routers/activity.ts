import { z } from "zod";
import { permissionProcedure, router } from "@/server/api/trpc";
import { auditFilterOptions, listAuditLogs } from "@/server/services/audit-service";
import { listEmails } from "@/server/services/email-service";
import { listEscalations, updateEscalation } from "@/server/services/escalation-service";
import { recordAudit } from "@/server/services/audit-service";

export const activityRouter = router({
  logs: permissionProcedure("audit:read")
    .input(
      z.object({
        userId: z.string().optional(),
        tool: z.string().optional(),
        action: z.string().optional(),
        success: z.boolean().optional(),
        riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
        actorType: z.enum(["USER", "AGENT", "SYSTEM"]).optional(),
        search: z.string().trim().optional(),
        from: z.date().optional(),
        to: z.date().optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().optional(),
      }),
    )
    .query(({ input }) => listAuditLogs(input)),

  filterOptions: permissionProcedure("audit:read").query(() => auditFilterOptions()),

  emails: permissionProcedure("email:read")
    .input(
      z.object({
        search: z.string().trim().optional(),
        customerId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().optional(),
      }),
    )
    .query(({ input }) => listEmails(input)),

  escalations: permissionProcedure("audit:read")
    .input(z.object({ status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional() }))
    .query(({ input }) => listEscalations(input.status)),

  updateEscalation: permissionProcedure("ticket:write")
    .input(
      z.object({
        id: z.string().min(1),
        status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const escalation = await updateEscalation(input.id, {
        status: input.status,
        assignedToId: ctx.user.id,
      });
      await recordAudit({
        action: "escalation.updated",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "Escalation",
        entityId: escalation.id,
        input,
        riskLevel: "MEDIUM",
      });
      return escalation;
    }),
});
