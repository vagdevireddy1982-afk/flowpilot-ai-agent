import type { Prisma } from "@/generated/prisma/client";
import type { CustomerStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { conflict, notFound } from "@/lib/errors";

export const CUSTOMER_LIST_INCLUDE = {
  _count: { select: { orders: true, tickets: true } },
} satisfies Prisma.CustomerInclude;

export interface CustomerFilters {
  search?: string;
  status?: CustomerStatus;
  limit?: number;
  cursor?: string;
}

export async function listCustomers(filters: CustomerFilters) {
  const limit = Math.min(filters.limit ?? 20, 100);
  const where: Prisma.CustomerWhereInput = {
    status: filters.status,
    OR: filters.search
      ? [
          { name: { contains: filters.search, mode: "insensitive" } },
          { email: { contains: filters.search, mode: "insensitive" } },
          { company: { contains: filters.search, mode: "insensitive" } },
          { reference: { contains: filters.search, mode: "insensitive" } },
          { phone: { contains: filters.search, mode: "insensitive" } },
        ]
      : undefined,
  };

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: CUSTOMER_LIST_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    }),
    prisma.customer.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    nextCursor: hasMore ? rows[limit - 1]!.id : null,
    total,
  };
}

/** Accepts either the cuid primary key or the human reference (CUST-1001). */
export async function getCustomer(idOrReference: string) {
  const customer = await prisma.customer.findFirst({
    where: { OR: [{ id: idOrReference }, { reference: idOrReference.toUpperCase() }] },
    include: CUSTOMER_LIST_INCLUDE,
  });
  if (!customer) throw notFound("Customer", idOrReference);
  return customer;
}

export async function getCustomerDetail(idOrReference: string) {
  const customer = await getCustomer(idOrReference);
  const [orders, tickets, emails, escalations] = await Promise.all([
    prisma.order.findMany({
      where: { customerId: customer.id },
      orderBy: { placedAt: "desc" },
      include: { items: true },
    }),
    prisma.supportTicket.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      include: { assignedTo: { select: { id: true, name: true } } },
    }),
    prisma.email.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.escalation.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return { customer, orders, tickets, emails, escalations };
}

export async function searchCustomers(query: string, limit = 5) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return prisma.customer.findMany({
    where: {
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { email: { contains: trimmed, mode: "insensitive" } },
        { company: { contains: trimmed, mode: "insensitive" } },
        { reference: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    include: CUSTOMER_LIST_INCLUDE,
    orderBy: { name: "asc" },
    take: Math.min(limit, 25),
  });
}

export interface CustomerUpdateInput {
  name?: string;
  email?: string;
  phone?: string | null;
  company?: string | null;
  status?: CustomerStatus;
  notes?: string | null;
}

export async function updateCustomer(idOrReference: string, input: CustomerUpdateInput) {
  const customer = await getCustomer(idOrReference);

  if (input.email && input.email.toLowerCase() !== customer.email) {
    const existing = await prisma.customer.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (existing) throw conflict(`Another customer already uses ${input.email}.`);
  }

  return prisma.customer.update({
    where: { id: customer.id },
    data: {
      ...input,
      email: input.email?.toLowerCase(),
    },
    include: CUSTOMER_LIST_INCLUDE,
  });
}

export async function nextCustomerReference(): Promise<string> {
  const latest = await prisma.customer.findFirst({
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  const current = latest ? Number.parseInt(latest.reference.replace("CUST-", ""), 10) : 1000;
  return `CUST-${current + 1}`;
}

export async function createCustomer(input: {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
  status?: CustomerStatus;
}) {
  const existing = await prisma.customer.findUnique({
    where: { email: input.email.toLowerCase() },
  });
  if (existing) throw conflict(`A customer with ${input.email} already exists.`);

  return prisma.customer.create({
    data: {
      reference: await nextCustomerReference(),
      name: input.name,
      email: input.email.toLowerCase(),
      phone: input.phone ?? null,
      company: input.company ?? null,
      notes: input.notes ?? null,
      status: input.status ?? "ACTIVE",
    },
    include: CUSTOMER_LIST_INCLUDE,
  });
}

/**
 * Deterministic account summary used on the customer detail page. It is built
 * from database facts rather than an LLM call so it is always accurate and
 * costs nothing; the agent can still be asked for a richer narrative.
 */
export async function buildCustomerSummary(idOrReference: string) {
  const { customer, orders, tickets } = await getCustomerDetail(idOrReference);

  const lifetimeMinor = orders
    .filter((order) => order.status !== "CANCELLED")
    .reduce((sum, order) => sum + order.totalAmountMinor - order.refundedAmountMinor, 0);
  const delayed = orders.filter(
    (order) => order.deliveryStatus === "DELAYED" && order.status !== "CANCELLED",
  );
  const openTickets = tickets.filter((ticket) =>
    ["OPEN", "IN_PROGRESS", "WAITING"].includes(ticket.status),
  );
  const lastOrder = orders[0];

  const highlights: string[] = [];
  if (lastOrder) {
    highlights.push(
      `Most recent order ${lastOrder.reference} is ${lastOrder.status.toLowerCase()} (${lastOrder.deliveryStatus.toLowerCase().replace("_", " ")}).`,
    );
  }
  if (delayed.length > 0) {
    highlights.push(
      `${delayed.length} order${delayed.length > 1 ? "s are" : " is"} currently delayed: ${delayed
        .map((order) => order.reference)
        .join(", ")}.`,
    );
  }
  if (openTickets.length > 0) {
    highlights.push(
      `${openTickets.length} open support ticket${openTickets.length > 1 ? "s" : ""}, highest priority ${
        openTickets.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority))[0]!
          .priority
      }.`,
    );
  }
  if (highlights.length === 0) highlights.push("No open issues on this account.");

  return {
    customerId: customer.id,
    reference: customer.reference,
    orderCount: orders.length,
    openTicketCount: openTickets.length,
    delayedOrderCount: delayed.length,
    lifetimeValueMinor: lifetimeMinor,
    currency: lastOrder?.currency ?? "INR",
    highlights,
  };
}

function priorityWeight(priority: string): number {
  return { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 }[priority] ?? 0;
}
