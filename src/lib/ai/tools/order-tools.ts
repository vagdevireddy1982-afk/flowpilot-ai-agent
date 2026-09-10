import { z } from "zod";
import { defineTool, ok } from "@/lib/ai/tools/types";
import { formatDate, formatMoney, titleCase } from "@/lib/utils";
import {
  cancelOrder,
  createRefund,
  findDelayedOrders,
  getOrder,
  getOrderHistory,
  listOrders,
} from "@/server/services/order-service";

type OrderWithCustomer = Awaited<ReturnType<typeof getOrder>>;

function orderShape(order: OrderWithCustomer) {
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryStatus: order.deliveryStatus,
    currency: order.currency,
    totalAmountMinor: order.totalAmountMinor,
    total: formatMoney(order.totalAmountMinor, order.currency),
    refunded: formatMoney(order.refundedAmountMinor, order.currency),
    placedAt: order.placedAt.toISOString(),
    expectedDeliveryAt: order.expectedDeliveryAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    customerId: order.customer.id,
    customerName: order.customer.name,
    customerEmail: order.customer.email,
    items: order.items.map((item) => ({
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: formatMoney(item.unitPriceMinor, order.currency),
    })),
  };
}

function describeOrder(order: OrderWithCustomer): string {
  const parts = [
    `Order ${order.reference} for ${order.customer.name}`,
    `${formatMoney(order.totalAmountMinor, order.currency)}`,
    `status ${titleCase(order.status)}`,
    `payment ${titleCase(order.paymentStatus)}`,
    `delivery ${titleCase(order.deliveryStatus)}`,
  ];
  if (order.deliveryStatus === "DELAYED" && order.expectedDeliveryAt) {
    parts.push(`expected ${formatDate(order.expectedDeliveryAt)}`);
  }
  if (order.refundedAmountMinor > 0) {
    parts.push(`${formatMoney(order.refundedAmountMinor, order.currency)} already refunded`);
  }
  return `${parts.join(" — ")}.`;
}

export const getOrderTool = defineTool({
  name: "getOrder",
  description:
    "Fetch a single order by reference (ORD-1004) or id, including items, amounts, payment and delivery status.",
  permission: "order:read",
  schema: z.object({
    orderId: z.string().min(2).describe("Order reference such as ORD-1004, or the order id"),
  }),
  async execute({ orderId }) {
    const order = await getOrder(orderId);
    return ok(describeOrder(order), orderShape(order));
  },
});

export const searchOrdersTool = defineTool({
  name: "searchOrders",
  description:
    "Search or filter orders — by free text, status, payment status, delivery status, or only those that are delayed.",
  permission: "order:read",
  schema: z.object({
    query: z.string().optional().describe("Free text: order reference, customer name or product"),
    status: z
      .enum(["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"])
      .optional(),
    paymentStatus: z
      .enum(["UNPAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"])
      .optional(),
    deliveryStatus: z
      .enum(["NOT_SHIPPED", "IN_TRANSIT", "DELAYED", "DELIVERED", "RETURNED"])
      .optional(),
    delayedOnly: z.boolean().optional().describe("Only orders currently running late"),
    limit: z.number().int().min(1).max(50).optional().default(10),
  }),
  async execute(args) {
    const orders = args.delayedOnly
      ? await findDelayedOrders(args.limit)
      : (
          await listOrders({
            search: args.query,
            status: args.status,
            paymentStatus: args.paymentStatus,
            deliveryStatus: args.deliveryStatus,
            limit: args.limit,
          })
        ).items;

    if (orders.length === 0) {
      return ok("No orders matched those filters.", { orders: [], count: 0 });
    }

    const label = args.delayedOnly ? "delayed order" : "order";
    return ok(
      `Found ${orders.length} ${label}${orders.length > 1 ? "s" : ""}: ${orders
        .map(
          (order) =>
            `${order.reference} (${order.customer.name}, ${formatMoney(order.totalAmountMinor, order.currency)})`,
        )
        .join("; ")}.`,
      {
        count: orders.length,
        orders: orders.map(orderShape),
      },
    );
  },
});

export const getOrderHistoryTool = defineTool({
  name: "getOrderHistory",
  description: "Return the full event timeline and refund history for one order.",
  permission: "order:read",
  schema: z.object({ orderId: z.string().min(2) }),
  async execute({ orderId }) {
    const { order, events, refunds } = await getOrderHistory(orderId);
    return ok(
      `Order ${order.reference} has ${events.length} recorded event${events.length === 1 ? "" : "s"}${
        refunds.length > 0 ? ` and ${refunds.length} refund${refunds.length === 1 ? "" : "s"}` : ""
      }. Latest: ${events[events.length - 1]?.description ?? "no events recorded"}.`,
      {
        reference: order.reference,
        customerId: order.customerId,
        events: events.map((event) => ({
          type: event.type,
          description: event.description,
          actor: event.actorLabel ?? event.actorType,
          at: event.createdAt.toISOString(),
        })),
        refunds: refunds.map((refund) => ({
          reference: refund.reference,
          amount: formatMoney(refund.amountMinor, refund.currency),
          status: refund.status,
          at: refund.createdAt.toISOString(),
        })),
      },
    );
  },
});

export const cancelOrderTool = defineTool({
  name: "cancelOrder",
  description:
    "Cancel an order that has not been delivered yet. High risk: always confirmed by a human first.",
  permission: "order:cancel",
  schema: z.object({
    orderId: z.string().min(2),
    reason: z.string().min(3).max(500).describe("Why the order is being cancelled"),
  }),
  async execute({ orderId, reason }, context) {
    const order = await cancelOrder(orderId, reason, {
      actorType: "AGENT",
      actorLabel: `FlowPilot agent on behalf of ${context.userName}`,
      userId: context.userId,
    });
    return ok(
      `Cancelled order ${order.reference} for ${order.customer.name} (${formatMoney(
        order.totalAmountMinor,
        order.currency,
      )}). Reason recorded: ${reason}`,
      orderShape(order),
    );
  },
  async preview({ orderId, reason }) {
    const order = await getOrder(orderId);
    return {
      title: `Cancel order ${order.reference}`,
      description:
        "The order will be marked cancelled and an event added to its timeline. This cannot be undone from FlowPilot.",
      facts: [
        { label: "Customer", value: `${order.customer.name} (${order.customer.email})` },
        { label: "Amount", value: formatMoney(order.totalAmountMinor, order.currency) },
        { label: "Current status", value: titleCase(order.status) },
        { label: "Delivery", value: titleCase(order.deliveryStatus) },
        { label: "Reason", value: reason },
      ],
    };
  },
});

export const createRefundTool = defineTool({
  name: "createRefund",
  description:
    "Refund money against a paid order, fully or partially. High risk: always confirmed by a human first.",
  permission: "order:refund",
  schema: z.object({
    orderId: z.string().min(2),
    amountMinor: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Refund amount in minor units (paise). Omit to refund the full outstanding amount."),
    reason: z.string().min(3).max(500),
  }),
  async execute({ orderId, amountMinor, reason }, context) {
    const { order, refund } = await createRefund(orderId, amountMinor, reason, {
      actorType: "AGENT",
      actorLabel: `FlowPilot agent on behalf of ${context.userName}`,
      userId: context.userId,
    });
    return ok(
      `Refunded ${formatMoney(refund.amountMinor, refund.currency)} on order ${order.reference} (refund ${refund.reference}). Payment status is now ${titleCase(
        order.paymentStatus,
      )}.`,
      {
        ...orderShape(order),
        refundReference: refund.reference,
        refundAmount: formatMoney(refund.amountMinor, refund.currency),
      },
    );
  },
  async preview({ orderId, amountMinor, reason }) {
    const order = await getOrder(orderId);
    const refundable = order.totalAmountMinor - order.refundedAmountMinor;
    return {
      title: `Refund order ${order.reference}`,
      description: `A refund of ${formatMoney(amountMinor ?? refundable, order.currency)} will be initiated against this order.`,
      facts: [
        { label: "Customer", value: `${order.customer.name} (${order.customer.email})` },
        { label: "Order total", value: formatMoney(order.totalAmountMinor, order.currency) },
        { label: "Already refunded", value: formatMoney(order.refundedAmountMinor, order.currency) },
        { label: "Refund amount", value: formatMoney(amountMinor ?? refundable, order.currency) },
        { label: "Order status", value: titleCase(order.status) },
        { label: "Reason", value: reason },
      ],
    };
  },
});
