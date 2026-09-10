import { z } from "zod";
import { permissionProcedure, router } from "@/server/api/trpc";
import { recordAudit } from "@/server/services/audit-service";
import {
  buildCustomerSummary,
  createCustomer,
  getCustomerDetail,
  listCustomers,
  updateCustomer,
} from "@/server/services/customer-service";

const statusEnum = z.enum(["ACTIVE", "INACTIVE", "PROSPECT", "CHURNED"]);

export const customerRouter = router({
  list: permissionProcedure("customer:read")
    .input(
      z.object({
        search: z.string().trim().optional(),
        status: statusEnum.optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
    )
    .query(({ input }) => listCustomers(input)),

  detail: permissionProcedure("customer:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input }) => getCustomerDetail(input.id)),

  summary: permissionProcedure("customer:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input }) => buildCustomerSummary(input.id)),

  create: permissionProcedure("customer:write")
    .input(
      z.object({
        name: z.string().trim().min(2).max(120),
        email: z.string().email(),
        phone: z.string().trim().max(40).optional(),
        company: z.string().trim().max(120).optional(),
        notes: z.string().trim().max(2000).optional(),
        status: statusEnum.default("ACTIVE"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const customer = await createCustomer(input);
      await recordAudit({
        action: "customer.created",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "Customer",
        entityId: customer.id,
        input,
        riskLevel: "MEDIUM",
      });
      return customer;
    }),

  update: permissionProcedure("customer:write")
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(2).max(120).optional(),
        email: z.string().email().optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        company: z.string().trim().max(120).nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
        status: statusEnum.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input;
      const customer = await updateCustomer(id, updates);
      await recordAudit({
        action: "customer.updated",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "Customer",
        entityId: customer.id,
        input: updates,
        riskLevel: "MEDIUM",
      });
      return customer;
    }),
});
