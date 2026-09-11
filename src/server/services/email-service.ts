import type { ActorType } from "@/generated/prisma/enums";
import { getEmailProvider } from "@/lib/email/provider";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { getCustomer } from "@/server/services/customer-service";

export interface SendCustomerEmailInput {
  customerIdOrReference: string;
  subject: string;
  body: string;
  conversationId?: string | null;
  actorType: ActorType;
  sentById?: string | null;
}

/**
 * Persists the message first, then attempts delivery, so a provider outage
 * still leaves an auditable record of what the agent tried to send.
 */
export async function sendCustomerEmail(input: SendCustomerEmailInput) {
  const customer = await getCustomer(input.customerIdOrReference);
  const provider = getEmailProvider();

  const email = await prisma.email.create({
    data: {
      customerId: customer.id,
      conversationId: input.conversationId ?? null,
      toEmail: customer.email,
      fromEmail: env.EMAIL_FROM,
      subject: input.subject,
      body: input.body,
      status: "QUEUED",
      provider: provider.name,
      actorType: input.actorType,
      sentById: input.sentById ?? null,
    },
  });

  try {
    const result = await provider.send({
      to: customer.email,
      from: env.EMAIL_FROM,
      subject: input.subject,
      body: input.body,
    });

    // Sequential on purpose: the driver adapter serialises queries on a single
    // connection, and a write pair like this is not worth a second one.
    const sent = await prisma.email.update({
      where: { id: email.id },
      data: { status: "SENT", sentAt: result.deliveredAt },
    });
    await prisma.customer.update({
      where: { id: customer.id },
      data: { lastContactedAt: result.deliveredAt },
    });
    return { email: sent, customer };
  } catch (error) {
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Unknown provider error",
      },
    });
    throw error;
  }
}

export async function listEmails(filters: {
  search?: string;
  customerId?: string;
  limit?: number;
  cursor?: string;
}) {
  const limit = Math.min(filters.limit ?? 25, 100);
  const rows = await prisma.email.findMany({
    where: {
      customerId: filters.customerId,
      OR: filters.search
        ? [
            { subject: { contains: filters.search, mode: "insensitive" } },
            { toEmail: { contains: filters.search, mode: "insensitive" } },
            { body: { contains: filters.search, mode: "insensitive" } },
          ]
        : undefined,
    },
    include: {
      customer: { select: { id: true, name: true, reference: true } },
      sentBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    nextCursor: hasMore ? rows[limit - 1]!.id : null,
  };
}
