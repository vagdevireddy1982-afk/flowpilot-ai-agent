import { z } from "zod";
import { permissionProcedure, router } from "@/server/api/trpc";
import { recordAudit } from "@/server/services/audit-service";
import {
  cancelOrder,
  createRefund,
  getOrderHistory,
  listOrders,
  updateOrderStatus,
} from "@/server/services/order-service";

const orderStatus = z.enum([
  "PENDING",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);
const paymentStatus = z.enum(["UNPAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"]);
const deliveryStatus = z.enum(["NOT_SHIPPED", "IN_TRANSIT", "DELAYED", "DELIVERED", "RETURNED"]);

export const orderRouter = router({
  list: permissionProcedure("order:read")
    .input(
      z.object({
        search: z.string().trim().optional(),
        status: orderStatus.optional(),
        paymentStatus: paymentStatus.optional(),
        deliveryStatus: deliveryStatus.optional(),
        delayedOnly: z.boolean().optional(),
        customerId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
    )
    .query(({ input }) => listOrders(input)),

  detail: permissionProcedure("order:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input }) => getOrderHistory(input.id)),

  updateStatus: permissionProcedure("order:write")
    .input(
      z.object({
        id: z.string().min(1),
        status: orderStatus.optional(),
        paymentStatus: paymentStatus.optional(),
        deliveryStatus: deliveryStatus.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input;
      const order = await updateOrderStatus(id, updates, {
        actorType: "USER",
        actorLabel: ctx.user.name,
        userId: ctx.user.id,
      });
      await recordAudit({
        action: "order.updated",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "Order",
        entityId: order.id,
        input: updates,
        output: { status: order.status },
        riskLevel: "MEDIUM",
      });
      return order;
    }),

  cancel: permissionProcedure("order:cancel")
    .input(z.object({ id: z.string().min(1), reason: z.string().trim().min(3).max(500) }))
    .mutation(async ({ input, ctx }) => {
      const order = await cancelOrder(input.id, input.reason, {
        actorType: "USER",
        actorLabel: ctx.user.name,
        userId: ctx.user.id,
      });
      await recordAudit({
        action: "order.cancelled",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "Order",
        entityId: order.id,
        input,
        output: { status: order.status },
        riskLevel: "HIGH",
        approvalStatus: "APPROVED",
      });
      return order;
    }),

  refund: permissionProcedure("order:refund")
    .input(
      z.object({
        id: z.string().min(1),
        amountMinor: z.number().int().positive().optional(),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { order, refund } = await createRefund(input.id, input.amountMinor, input.reason, {
        actorType: "USER",
        actorLabel: ctx.user.name,
        userId: ctx.user.id,
      });
      await recordAudit({
        action: "order.refunded",
        actorType: "USER",
        userId: ctx.user.id,
        entityType: "Order",
        entityId: order.id,
        input,
        output: { refund: refund.reference, amountMinor: refund.amountMinor },
        riskLevel: "HIGH",
        approvalStatus: "APPROVED",
      });
      return { order, refund };
    }),
});
