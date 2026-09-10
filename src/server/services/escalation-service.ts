import type { EscalationStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";

export async function createEscalation(input: {
  conversationId?: string | null;
  customerIdOrReference?: string | null;
  reason: string;
  summary: string;
}) {
  let customerId: string | null = null;
  if (input.customerIdOrReference) {
    const customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { id: input.customerIdOrReference },
          { reference: input.customerIdOrReference.toUpperCase() },
          { email: input.customerIdOrReference.toLowerCase() },
        ],
      },
      select: { id: true },
    });
    customerId = customer?.id ?? null;
  }

  return prisma.escalation.create({
    data: {
      conversationId: input.conversationId ?? null,
      customerId,
      reason: input.reason,
      summary: input.summary,
    },
  });
}

export async function listEscalations(status?: EscalationStatus) {
  return prisma.escalation.findMany({
    where: { status },
    include: {
      customer: { select: { id: true, name: true, reference: true } },
      assignedTo: { select: { id: true, name: true } },
      conversation: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function updateEscalation(
  id: string,
  updates: { status?: EscalationStatus; assignedToId?: string | null },
) {
  const existing = await prisma.escalation.findUnique({ where: { id } });
  if (!existing) throw notFound("Escalation", id);

  return prisma.escalation.update({
    where: { id },
    data: {
      ...updates,
      resolvedAt: updates.status === "RESOLVED" ? new Date() : existing.resolvedAt,
    },
  });
}
