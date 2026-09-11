import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { resetVectorStore } from "@/lib/ai/rag/vector-store";
import { invalidateCorpusStats } from "@/lib/ai/rag/corpus-stats";
import { agentRateLimiter } from "@/lib/rate-limit";
import { ingestDocument } from "@/lib/ai/rag/ingest";
import type { Role } from "@/generated/prisma/enums";

/**
 * Integration tests run against a real Postgres database — the same one the
 * app uses in development. Each suite creates the records it needs with a
 * unique prefix and removes them afterwards, so a developer's seeded demo data
 * survives a test run.
 */

let counter = 0;
export const testId = () => `t${Date.now().toString(36)}${(counter += 1)}`;

/**
 * Business references follow the product's own `PREFIX-<digits>` convention so
 * the agent's reference-extraction behaves exactly as it does in production.
 */
export const testReferenceNumber = () => 100_000 + ((Date.now() + (counter += 1)) % 800_000);

export interface TestWorld {
  prefix: string;
  userId: string;
  adminId: string;
  customerId: string;
  customerReference: string;
  orderId: string;
  orderReference: string;
  conversationId: string;
  documentId: string;
}

export const TEST_CUSTOMER_NAME = "Nadia Fernandes";

export async function createWorld(role: Role = "ADMIN"): Promise<TestWorld> {
  const prefix = testId();
  const customerNumber = testReferenceNumber();
  const orderNumber = testReferenceNumber();
  agentRateLimiter.reset();
  resetVectorStore();
  invalidateCorpusStats();

  const passwordHash = await hashPassword("TestPassword!1");

  const [user, admin] = await Promise.all([
    prisma.user.create({
      data: {
        email: `${prefix}.operator@test.local`,
        name: "Test Operator",
        passwordHash,
        role,
      },
    }),
    prisma.user.create({
      data: {
        email: `${prefix}.admin@test.local`,
        name: "Test Admin",
        passwordHash,
        role: "ADMIN",
      },
    }),
  ]);

  const customer = await prisma.customer.create({
    data: {
      reference: `CUST-${customerNumber}`,
      name: TEST_CUSTOMER_NAME,
      email: `${prefix}.customer@test.local`,
      company: "Testing Ltd",
      phone: "+91 9000000000",
    },
  });

  const order = await prisma.order.create({
    data: {
      reference: `ORD-${orderNumber}`,
      customerId: customer.id,
      status: "SHIPPED",
      paymentStatus: "PAID",
      deliveryStatus: "DELAYED",
      totalAmountMinor: 1_249_900,
      expectedDeliveryAt: new Date(Date.now() - 86_400_000),
      items: {
        create: [
          { sku: "AUD-NC700", name: "Aurora NC700 Headphones", quantity: 1, unitPriceMinor: 1_249_900 },
        ],
      },
    },
  });

  const conversation = await prisma.conversation.create({
    data: { userId: user.id, title: "Test conversation" },
  });

  const document = await prisma.knowledgeDocument.create({
    data: {
      title: `${prefix} Refund Policy`,
      filename: `${prefix}-refund-policy.md`,
      mimeType: "text/markdown",
      sizeBytes: 512,
      content: [
        "# Refund Policy",
        "",
        "Customers can request a refund within 30 days of delivery. The clock starts on the date the carrier marks the order as delivered.",
        "",
        "Orders that have not yet shipped can be cancelled and refunded at any time before dispatch, with a full refund including delivery charges.",
        "",
        "Refunds above twenty-five thousand rupees require a second approver from the finance team.",
      ].join("\n"),
      uploadedById: admin.id,
    },
  });
  await ingestDocument(document.id);
  invalidateCorpusStats();

  return {
    prefix,
    userId: user.id,
    adminId: admin.id,
    customerId: customer.id,
    customerReference: customer.reference,
    orderId: order.id,
    orderReference: order.reference,
    conversationId: conversation.id,
    documentId: document.id,
  };
}

export async function destroyWorld(world: TestWorld): Promise<void> {
  // Cascades remove messages, tool calls, approvals, items and events.
  await prisma.knowledgeDocument.deleteMany({ where: { id: world.documentId } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [world.userId, world.adminId] } } });
  await prisma.email.deleteMany({ where: { customerId: world.customerId } });
  await prisma.escalation.deleteMany({ where: { customerId: world.customerId } });
  await prisma.customer.deleteMany({ where: { id: world.customerId } });
  await prisma.user.deleteMany({ where: { id: { in: [world.userId, world.adminId] } } });
}
