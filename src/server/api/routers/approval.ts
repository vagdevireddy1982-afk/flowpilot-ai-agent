import { z } from "zod";
import { permissionProcedure, protectedProcedure, router } from "@/server/api/trpc";
import {
  canDecide,
  decideApproval,
  getApproval,
  listApprovals,
} from "@/server/services/approval-service";

export const approvalRouter = router({
  list: permissionProcedure("approval:read")
    .input(
      z.object({
        status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const approvals = await listApprovals(input);
      return approvals.map((approval) => ({
        ...approval,
        canDecide: canDecide(approval, { id: ctx.user.id, role: ctx.user.role }),
      }));
    }),

  detail: permissionProcedure("approval:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const approval = await getApproval(input.id);
      return {
        ...approval,
        canDecide: canDecide(approval, { id: ctx.user.id, role: ctx.user.role }),
      };
    }),

  decide: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        approve: z.boolean(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      decideApproval({
        approvalId: input.id,
        approve: input.approve,
        note: input.note,
        decider: { id: ctx.user.id, role: ctx.user.role },
      }),
    ),
});
