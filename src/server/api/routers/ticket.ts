import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { permissionProcedure, protectedProcedure, router } from "@/server/api/trpc";
import { recordAudit } from "@/server/services/audit-service";
import { createTicket, getTicket, listTickets, updateTicket } from "@/server/services/ticket-service";

const status = z.enum(["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]);
const priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const category = z.enum(["BILLING", "DELIVERY", "PRODUCT", "ACCOUNT", "OTHER"]);

export const ticketRouter = router({
  list: permissionProcedure("ticket:read")
    .input(
      z.object({
        search: z.string().trim().optional(),
        status: status.optional(),
        priority: priority.optional(),
        category: category.optional(),
        customerId: z.string().optional(),
        assignedToId: z.string().optional(),
        openOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
    )
    .query(({ input }) => listTickets(input)),

  detail: permissionProcedure("ticket:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input }) => getTicket(input.id)),

  assignees: protectedProcedure.query(() =>
    prisma.user.findMany({
      where: { isActive: true, role: { in: ["ADMIN", "AGENT"] } },
      select: { id: true, name: true, email: true, avatarColor: true },
      orderBy: { name: "asc" },
    }),
  ),

  create: permissionProcedure("ticket:write")
    .input(
      z.object({
        customerId: z.string().min(1),
        subject: z.string().trim().min(3).max(160),
        description: z.string().trim().min(3).max(4000),
        priority: priority.default("MEDIUM"),
        category: category.default("OTHER"),
        orderId: z.string().optional(),
        assignedToId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ticket = await createTicket({
        customerIdOrReference: input.customerId,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        category: input.category,
        orderIdOrReference: input.orderId ?? null,
        assignedToId: input.assignedToId ?? null,
        createdBy: "USER",
      });
      await recordAudit({
        action: "ticket.created",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "SupportTicket",
        entityId: ticket.id,
        input,
        riskLevel: "MEDIUM",
      });
      return ticket;
    }),

  update: permissionProcedure("ticket:write")
    .input(
      z.object({
        id: z.string().min(1),
        status: status.optional(),
        priority: priority.optional(),
        category: category.optional(),
        assignedToId: z.string().nullable().optional(),
        subject: z.string().trim().min(3).max(160).optional(),
        description: z.string().trim().min(3).max(4000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input;
      const ticket = await updateTicket(id, updates);
      await recordAudit({
        action: "ticket.updated",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "SupportTicket",
        entityId: ticket.id,
        input: updates,
        riskLevel: "MEDIUM",
      });
      return ticket;
    }),
});
