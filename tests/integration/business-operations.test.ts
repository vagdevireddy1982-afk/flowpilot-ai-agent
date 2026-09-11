import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeToolCall } from "@/lib/ai/agent/executor";
import type { ToolContext } from "@/lib/ai/tools/types";
import { prisma } from "@/lib/db/prisma";
import { listAuditLogs } from "@/server/services/audit-service";
import { cancelOrder, createRefund } from "@/server/services/order-service";
import { createTicket, updateTicket } from "@/server/services/ticket-service";
import { sendCustomerEmail } from "@/server/services/email-service";
import { searchCustomers } from "@/server/services/customer-service";
import { createWorld, destroyWorld, TEST_CUSTOMER_NAME, type TestWorld } from "./helpers";

describe("business operations", () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createWorld("ADMIN");
  });

  afterAll(async () => {
    await destroyWorld(world);
  });

  const actor = { actorType: "USER" as const, actorLabel: "Test Admin" };

  it("finds a customer by name, email and reference", async () => {
    const byName = await searchCustomers(TEST_CUSTOMER_NAME);
    const byReference = await searchCustomers(world.customerReference);
    expect(byName[0]?.id).toBe(world.customerId);
    expect(byReference[0]?.id).toBe(world.customerId);
    expect(await searchCustomers("no such person at all")).toHaveLength(0);
  });

  it("creates a ticket with a sequential reference", async () => {
    const ticket = await createTicket({
      customerIdOrReference: world.customerReference,
      subject: "Delivery is late",
      description: "Customer called about the delay.",
      priority: "HIGH",
      category: "DELIVERY",
      orderIdOrReference: world.orderReference,
      createdBy: "USER",
    });

    expect(ticket.reference).toMatch(/^TKT-\d+$/);
    expect(ticket.customerId).toBe(world.customerId);
    expect(ticket.orderId).toBe(world.orderId);

    const resolved = await updateTicket(ticket.reference, { status: "RESOLVED" });
    expect(resolved.resolvedAt).not.toBeNull();

    await prisma.supportTicket.delete({ where: { id: ticket.id } });
  });

  it("rejects a refund larger than the outstanding balance", async () => {
    await expect(
      createRefund(world.orderReference, 99_999_900, "too much", actor),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("supports partial refunds and tracks the remaining balance", async () => {
    const first = await createRefund(world.orderReference, 200_000, "goodwill", actor);
    expect(first.order.paymentStatus).toBe("PARTIALLY_REFUNDED");
    expect(first.order.refundedAmountMinor).toBe(200_000);

    const second = await createRefund(world.orderReference, undefined, "remainder", actor);
    expect(second.order.paymentStatus).toBe("REFUNDED");
    expect(second.order.refundedAmountMinor).toBe(1_249_900);

    await expect(
      createRefund(world.orderReference, 100, "again", actor),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await prisma.refund.deleteMany({ where: { orderId: world.orderId } });
    await prisma.order.update({
      where: { id: world.orderId },
      data: { refundedAmountMinor: 0, paymentStatus: "PAID", status: "SHIPPED" },
    });
  });

  it("refuses to cancel an order that has already been delivered", async () => {
    await prisma.order.update({
      where: { id: world.orderId },
      data: { status: "DELIVERED", deliveryStatus: "DELIVERED" },
    });

    await expect(cancelOrder(world.orderReference, "changed mind", actor)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    await prisma.order.update({
      where: { id: world.orderId },
      data: { status: "SHIPPED", deliveryStatus: "DELAYED" },
    });
  });

  it("cancels a shipped order and records the reason on its timeline", async () => {
    const cancelled = await cancelOrder(world.orderReference, "Customer no longer needs it", actor);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancellationReason).toContain("no longer needs it");

    const events = await prisma.orderEvent.findMany({ where: { orderId: world.orderId } });
    expect(events.some((event) => event.type === "ORDER_CANCELLED")).toBe(true);

    await prisma.order.update({
      where: { id: world.orderId },
      data: { status: "SHIPPED", cancelledAt: null, cancellationReason: null },
    });
  });

  it("stores an outbound email and stamps the customer's last contact", async () => {
    const { email } = await sendCustomerEmail({
      customerIdOrReference: world.customerReference,
      subject: "Update on your order",
      body: "We are sorry about the delay.",
      actorType: "USER",
      sentById: world.adminId,
    });

    expect(email.status).toBe("SENT");
    expect(email.provider).toBe("mock");
    expect(email.sentAt).not.toBeNull();

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: world.customerId } });
    expect(customer.lastContactedAt).not.toBeNull();
  });
});

describe("tool executor guarantees", () => {
  let world: TestWorld;
  let context: ToolContext;

  beforeAll(async () => {
    world = await createWorld("AGENT");
    context = {
      userId: world.userId,
      userName: "Test Operator",
      userEmail: "operator@test.local",
      role: "AGENT",
      conversationId: world.conversationId,
    };
  });

  afterAll(async () => {
    await destroyWorld(world);
  });

  it("refuses an unknown tool without touching the database", async () => {
    const outcome = await executeToolCall({
      call: { id: "c1", name: "dropAllTables", arguments: { sql: "DROP TABLE users" } },
      context,
      autoApproveMediumRisk: true,
    });

    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") return;
    expect(outcome.result.ok).toBe(false);
    expect(outcome.result).toMatchObject({ code: "UNKNOWN_TOOL" });
  });

  it("refuses a tool the caller's role does not hold", async () => {
    const outcome = await executeToolCall({
      call: { id: "c2", name: "createRefund", arguments: { orderId: world.orderReference, reason: "x" } },
      context,
      autoApproveMediumRisk: true,
    });

    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") return;
    expect(outcome.result).toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.refund.count({ where: { orderId: world.orderId } })).toBe(0);
  });

  it("rejects arguments that fail the tool's schema", async () => {
    const outcome = await executeToolCall({
      call: { id: "c3", name: "createSupportTicket", arguments: { customerId: world.customerId } },
      context,
      autoApproveMediumRisk: true,
    });

    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") return;
    expect(outcome.result).toMatchObject({ code: "INVALID_ARGUMENTS" });
    if (outcome.result.ok) return;
    expect(outcome.result.error).toMatch(/subject/);
  });

  it("writes an audit record for a successful tool call", async () => {
    const outcome = await executeToolCall({
      call: { id: "c4", name: "getOrder", arguments: { orderId: world.orderReference } },
      context,
      autoApproveMediumRisk: true,
    });
    expect(outcome.kind).toBe("executed");

    const { items } = await listAuditLogs({ userId: world.userId, tool: "getOrder", limit: 5 });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toMatchObject({
      action: "agent.tool.getOrder",
      actorType: "AGENT",
      success: true,
      entityType: "Order",
    });
    expect(items[0]!.input).toMatchObject({ orderId: world.orderReference });
  });

  it("writes an audit record for a refused tool call", async () => {
    const { items } = await listAuditLogs({ userId: world.userId, success: false, limit: 10 });
    expect(items.some((entry) => entry.action === "agent.tool_rejected")).toBe(true);
  });

  it("redacts secret-looking fields from the audit trail", async () => {
    await executeToolCall({
      call: {
        id: "c5",
        name: "updateCustomerNotes",
        arguments: {
          customerId: world.customerId,
          notes: "Follow up next week",
          apiKey: "sk-should-never-be-stored",
        },
      },
      context,
      autoApproveMediumRisk: true,
    });

    const { items } = await listAuditLogs({ userId: world.userId, tool: "updateCustomerNotes" });
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain("sk-should-never-be-stored");
  });
});
