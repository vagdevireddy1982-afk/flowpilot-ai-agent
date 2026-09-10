import type { Prisma } from "@/generated/prisma/client";
import type {
  ActorType,
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { conflict, notFound, validationError } from "@/lib/errors";

export const ORDER_INCLUDE = {
  items: true,
  customer: { select: { id: true, reference: true, name: true, email: true, company: true } },
} satisfies Prisma.OrderInclude;

export interface OrderFilters {
  search?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  deliveryStatus?: DeliveryStatus;
  customerId?: string;
  delayedOnly?: boolean;
  placedAfter?: Date;
  placedBefore?: Date;
  limit?: number;
  cursor?: string;
}

function buildWhere(filters: OrderFilters): Prisma.OrderWhereInput {
  // "Delayed" is a saved view rather than a raw column filter: it also hides
  // orders that are no longer actionable because they were cancelled/refunded.
  const status = filters.status
    ? filters.status
    : filters.delayedOnly
      ? { notIn: ["CANCELLED", "REFUNDED"] as OrderStatus[] }
      : undefined;

  return {
    status,
    paymentStatus: filters.paymentStatus,
    deliveryStatus: filters.delayedOnly ? "DELAYED" : filters.deliveryStatus,
    customerId: filters.customerId,
    placedAt:
      filters.placedAfter || filters.placedBefore
        ? { gte: filters.placedAfter ?? undefined, lte: filters.placedBefore ?? undefined }
        : undefined,
    OR: filters.search
      ? [
          { reference: { contains: filters.search, mode: "insensitive" } },
          { customer: { name: { contains: filters.search, mode: "insensitive" } } },
          { customer: { email: { contains: filters.search, mode: "insensitive" } } },
          { items: { some: { name: { contains: filters.search, mode: "insensitive" } } } },
        ]
      : undefined,
  };
}

export async function listOrders(filters: OrderFilters) {
  const limit = Math.min(filters.limit ?? 20, 100);
  const where = buildWhere(filters);

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { placedAt: "desc" },
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    }),
    prisma.order.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    nextCursor: hasMore ? rows[limit - 1]!.id : null,
    total,
  };
}

export async function getOrder(idOrReference: string) {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id: idOrReference }, { reference: idOrReference.toUpperCase() }] },
    include: ORDER_INCLUDE,
  });
  if (!order) throw notFound("Order", idOrReference);
  return order;
}

export async function getOrderHistory(idOrReference: string) {
  const order = await getOrder(idOrReference);
  const [events, refunds] = await Promise.all([
    prisma.orderEvent.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } }),
    prisma.refund.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } }),
  ]);
  return { order, events, refunds };
}

export async function getCustomerOrders(customerId: string, limit = 20) {
  return prisma.order.findMany({
    where: { customerId },
    include: ORDER_INCLUDE,
    orderBy: { placedAt: "desc" },
    take: Math.min(limit, 100),
  });
}

async function appendEvent(
  tx: Prisma.TransactionClient,
  orderId: string,
  type: string,
  description: string,
  actorType: ActorType,
  actorLabel?: string,
) {
  await tx.orderEvent.create({
    data: { orderId, type, description, actorType, actorLabel: actorLabel ?? null },
  });
}

export interface OrderActor {
  actorType: ActorType;
  actorLabel: string;
  userId?: string | null;
}

/** Statuses from which a cancellation is still meaningful. */
const CANCELLABLE: OrderStatus[] = ["PENDING", "PROCESSING", "SHIPPED"];

export async function cancelOrder(
  idOrReference: string,
  reason: string,
  actor: OrderActor,
) {
  const existing = await getOrder(idOrReference);

  if (existing.status === "CANCELLED") {
    throw conflict(`Order ${existing.reference} is already cancelled.`);
  }
  if (!CANCELLABLE.includes(existing.status)) {
    throw conflict(
      `Order ${existing.reference} is ${existing.status.toLowerCase()} and can no longer be cancelled. A refund may be appropriate instead.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.update({
      where: { id: existing.id },
      data: {
        status: "CANCELLED",
        deliveryStatus: existing.deliveryStatus === "DELIVERED" ? "DELIVERED" : "NOT_SHIPPED",
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
      include: ORDER_INCLUDE,
    });
    await appendEvent(
      tx,
      order.id,
      "ORDER_CANCELLED",
      `Order cancelled: ${reason}`,
      actor.actorType,
      actor.actorLabel,
    );
    return order;
  });
}

export async function createRefund(
  idOrReference: string,
  amountMinor: number | undefined,
  reason: string,
  actor: OrderActor,
) {
  const existing = await getOrder(idOrReference);

  if (existing.paymentStatus === "UNPAID" || existing.paymentStatus === "FAILED") {
    throw conflict(`Order ${existing.reference} was never paid, so there is nothing to refund.`);
  }

  const refundable = existing.totalAmountMinor - existing.refundedAmountMinor;
  if (refundable <= 0) {
    throw conflict(`Order ${existing.reference} has already been fully refunded.`);
  }

  const amount = amountMinor ?? refundable;
  if (amount <= 0) throw validationError("Refund amount must be greater than zero.");
  if (amount > refundable) {
    throw validationError(
      `Refund exceeds the refundable balance for ${existing.reference}. At most ${(refundable / 100).toFixed(2)} ${existing.currency} can be refunded.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const count = await tx.refund.count();
    const refund = await tx.refund.create({
      data: {
        reference: `REF-${1000 + count + 1}`,
        orderId: existing.id,
        amountMinor: amount,
        currency: existing.currency,
        status: "COMPLETED",
        reason,
        createdById: actor.userId ?? null,
        actorType: actor.actorType,
      },
    });

    const refundedTotal = existing.refundedAmountMinor + amount;
    const fullyRefunded = refundedTotal >= existing.totalAmountMinor;

    const order = await tx.order.update({
      where: { id: existing.id },
      data: {
        refundedAmountMinor: refundedTotal,
        paymentStatus: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
        status: fullyRefunded ? "REFUNDED" : existing.status,
      },
      include: ORDER_INCLUDE,
    });

    await appendEvent(
      tx,
      order.id,
      "REFUND_ISSUED",
      `Refund ${refund.reference} of ${(amount / 100).toFixed(2)} ${order.currency}: ${reason}`,
      actor.actorType,
      actor.actorLabel,
    );

    return { order, refund };
  });
}

export async function updateOrderStatus(
  idOrReference: string,
  updates: {
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    deliveryStatus?: DeliveryStatus;
  },
  actor: OrderActor,
) {
  const existing = await getOrder(idOrReference);

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.update({
      where: { id: existing.id },
      data: {
        ...updates,
        deliveredAt:
          updates.deliveryStatus === "DELIVERED" && !existing.deliveredAt
            ? new Date()
            : existing.deliveredAt,
      },
      include: ORDER_INCLUDE,
    });

    const changes = Object.entries(updates)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => `${key} → ${String(value)}`)
      .join(", ");

    await appendEvent(
      tx,
      order.id,
      "ORDER_UPDATED",
      `Order updated (${changes})`,
      actor.actorType,
      actor.actorLabel,
    );
    return order;
  });
}

export async function findDelayedOrders(limit = 20) {
  return prisma.order.findMany({
    where: {
      deliveryStatus: "DELAYED",
      status: { notIn: ["CANCELLED", "REFUNDED"] },
    },
    include: ORDER_INCLUDE,
    orderBy: { expectedDeliveryAt: "asc" },
    take: Math.min(limit, 50),
  });
}
