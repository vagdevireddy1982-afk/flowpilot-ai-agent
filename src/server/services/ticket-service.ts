import type { Prisma } from "@/generated/prisma/client";
import type {
  ActorType,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";
import { getCustomer } from "@/server/services/customer-service";

export const TICKET_INCLUDE = {
  customer: { select: { id: true, reference: true, name: true, email: true, company: true } },
  order: { select: { id: true, reference: true, status: true } },
  assignedTo: { select: { id: true, name: true, email: true, avatarColor: true } },
} satisfies Prisma.SupportTicketInclude;

export const OPEN_TICKET_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING"];

export interface TicketFilters {
  search?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  customerId?: string;
  assignedToId?: string;
  openOnly?: boolean;
  limit?: number;
  cursor?: string;
}

export async function listTickets(filters: TicketFilters) {
  const limit = Math.min(filters.limit ?? 20, 100);
  const where: Prisma.SupportTicketWhereInput = {
    status: filters.status ?? (filters.openOnly ? { in: OPEN_TICKET_STATUSES } : undefined),
    priority: filters.priority,
    category: filters.category,
    customerId: filters.customerId,
    assignedToId: filters.assignedToId,
    OR: filters.search
      ? [
          { reference: { contains: filters.search, mode: "insensitive" } },
          { subject: { contains: filters.search, mode: "insensitive" } },
          { description: { contains: filters.search, mode: "insensitive" } },
          { customer: { name: { contains: filters.search, mode: "insensitive" } } },
        ]
      : undefined,
  };

  const [rows, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      include: TICKET_INCLUDE,
      orderBy: [{ createdAt: "desc" }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    }),
    prisma.supportTicket.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    nextCursor: hasMore ? rows[limit - 1]!.id : null,
    total,
  };
}

export async function getTicket(idOrReference: string) {
  const ticket = await prisma.supportTicket.findFirst({
    where: { OR: [{ id: idOrReference }, { reference: idOrReference.toUpperCase() }] },
    include: TICKET_INCLUDE,
  });
  if (!ticket) throw notFound("Support ticket", idOrReference);
  return ticket;
}

export async function getCustomerTickets(customerIdOrReference: string, openOnly = false) {
  const customer = await getCustomer(customerIdOrReference);
  return prisma.supportTicket.findMany({
    where: {
      customerId: customer.id,
      ...(openOnly ? { status: { in: OPEN_TICKET_STATUSES } } : {}),
    },
    include: TICKET_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

async function nextTicketReference(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.supportTicket.count();
  return `TKT-${1000 + count + 1}`;
}

export interface CreateTicketInput {
  customerIdOrReference: string;
  subject: string;
  description: string;
  priority?: TicketPriority;
  category?: TicketCategory;
  orderIdOrReference?: string | null;
  assignedToId?: string | null;
  createdBy: ActorType;
}

export async function createTicket(input: CreateTicketInput) {
  const customer = await getCustomer(input.customerIdOrReference);

  let orderId: string | null = null;
  if (input.orderIdOrReference) {
    const order = await prisma.order.findFirst({
      where: {
        OR: [
          { id: input.orderIdOrReference },
          { reference: input.orderIdOrReference.toUpperCase() },
        ],
      },
      select: { id: true, customerId: true },
    });
    if (!order) throw notFound("Order", input.orderIdOrReference);
    orderId = order.id;
  }

  return prisma.$transaction(async (tx) => {
    const reference = await nextTicketReference(tx);
    return tx.supportTicket.create({
      data: {
        reference,
        customerId: customer.id,
        orderId,
        subject: input.subject,
        description: input.description,
        priority: input.priority ?? "MEDIUM",
        category: input.category ?? "OTHER",
        assignedToId: input.assignedToId ?? null,
        createdBy: input.createdBy,
      },
      include: TICKET_INCLUDE,
    });
  });
}

export interface UpdateTicketInput {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  assignedToId?: string | null;
  subject?: string;
  description?: string;
}

export async function updateTicket(idOrReference: string, updates: UpdateTicketInput) {
  const ticket = await getTicket(idOrReference);
  const resolving =
    updates.status && ["RESOLVED", "CLOSED"].includes(updates.status) && !ticket.resolvedAt;

  return prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      ...updates,
      resolvedAt: resolving ? new Date() : ticket.resolvedAt,
    },
    include: TICKET_INCLUDE,
  });
}

export async function ticketStatsByCategory() {
  const grouped = await prisma.supportTicket.groupBy({
    by: ["category"],
    _count: { _all: true },
  });
  return grouped.map((row) => ({ category: row.category, count: row._count._all }));
}
