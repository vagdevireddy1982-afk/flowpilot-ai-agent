import { z } from "zod";
import { defineTool, ok } from "@/lib/ai/tools/types";
import { formatMoney, titleCase } from "@/lib/utils";
import {
  buildCustomerSummary,
  getCustomer,
  searchCustomers,
  updateCustomer,
} from "@/server/services/customer-service";
import { getCustomerOrders } from "@/server/services/order-service";

const customerShape = (customer: {
  id: string;
  reference: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  status: string;
  lastContactedAt: Date | null;
}) => ({
  id: customer.id,
  reference: customer.reference,
  name: customer.name,
  email: customer.email,
  phone: customer.phone,
  company: customer.company,
  status: customer.status,
  lastContactedAt: customer.lastContactedAt?.toISOString() ?? null,
});

export const getCustomerTool = defineTool({
  name: "getCustomer",
  description:
    "Fetch one customer by their FlowPilot id, reference (CUST-1001) or email address, including order and ticket counts.",
  permission: "customer:read",
  schema: z.object({
    customerId: z
      .string()
      .min(2)
      .describe("Customer id, reference such as CUST-1004, or email address"),
  }),
  async execute({ customerId }) {
    const customer = await getCustomer(customerId);
    const summary = await buildCustomerSummary(customer.id);
    return ok(
      `${customer.name} (${customer.reference}) — ${titleCase(customer.status)} customer at ${
        customer.company ?? "no company on file"
      }, ${customer._count.orders} orders and ${summary.openTicketCount} open tickets. ${summary.highlights[0] ?? ""}`.trim(),
      {
        ...customerShape(customer),
        customerId: customer.id,
        orderCount: customer._count.orders,
        ticketCount: customer._count.tickets,
        openTicketCount: summary.openTicketCount,
        delayedOrderCount: summary.delayedOrderCount,
        lifetimeValue: formatMoney(summary.lifetimeValueMinor, summary.currency),
        highlights: summary.highlights,
      },
    );
  },
});

export const searchCustomersTool = defineTool({
  name: "searchCustomers",
  description:
    "Search customers by name, email, company or reference. Use this first when the user names a person instead of giving an id.",
  permission: "customer:read",
  schema: z.object({
    query: z.string().min(2).describe("Free-text search, e.g. a person's name or a company"),
    limit: z.number().int().min(1).max(25).optional().default(5),
  }),
  async execute({ query, limit }) {
    const customers = await searchCustomers(query, limit);

    if (customers.length === 0) {
      return ok(`No customer matched "${query}".`, { query, customers: [], customerId: null });
    }

    const first = customers[0]!;
    const summary =
      customers.length === 1
        ? `Found ${first.name} (${first.reference}, ${first.email}) with ${first._count.orders} orders and ${first._count.tickets} tickets.`
        : `Found ${customers.length} customers matching "${query}": ${customers
            .map((customer) => `${customer.name} (${customer.reference})`)
            .join(", ")}.`;

    return ok(summary, {
      query,
      // The first match is surfaced separately so follow-up steps can chain on it.
      customerId: customers.length === 1 ? first.id : null,
      customers: customers.map((customer) => ({
        ...customerShape(customer),
        orderCount: customer._count.orders,
        ticketCount: customer._count.tickets,
      })),
    });
  },
});

export const getCustomerOrderHistoryTool = defineTool({
  name: "getCustomerOrderHistory",
  description: "List a customer's most recent orders, newest first.",
  permission: "order:read",
  schema: z.object({
    customerId: z.string().min(2).describe("Customer id, reference or email"),
    limit: z.number().int().min(1).max(25).optional().default(5),
  }),
  async execute({ customerId, limit }) {
    const customer = await getCustomer(customerId);
    const orders = await getCustomerOrders(customer.id, limit);

    if (orders.length === 0) {
      return ok(`${customer.name} has no orders on record.`, {
        customerId: customer.id,
        customerName: customer.name,
        orders: [],
      });
    }

    const latest = orders[0]!;
    return ok(
      `${customer.name} has ${orders.length} recent order${orders.length > 1 ? "s" : ""}. The latest is ${latest.reference} for ${formatMoney(
        latest.totalAmountMinor,
        latest.currency,
      )} — ${titleCase(latest.status)}, delivery ${titleCase(latest.deliveryStatus)}.`,
      {
        customerId: customer.id,
        customerName: customer.name,
        orders: orders.map((order) => ({
          id: order.id,
          reference: order.reference,
          status: order.status,
          paymentStatus: order.paymentStatus,
          deliveryStatus: order.deliveryStatus,
          total: formatMoney(order.totalAmountMinor, order.currency),
          totalAmountMinor: order.totalAmountMinor,
          currency: order.currency,
          placedAt: order.placedAt.toISOString(),
          expectedDeliveryAt: order.expectedDeliveryAt?.toISOString() ?? null,
          customerId: order.customerId,
          customerName: customer.name,
        })),
      },
    );
  },
});

export const updateCustomerNotesTool = defineTool({
  name: "updateCustomerNotes",
  description:
    "Replace the internal account notes for a customer. Use for context an operator should see next time, never for promises made to the customer.",
  permission: "customer:write",
  schema: z.object({
    customerId: z.string().min(2),
    notes: z.string().min(3).max(2000),
  }),
  async execute({ customerId, notes }) {
    const customer = await updateCustomer(customerId, { notes });
    return ok(`Updated the internal notes on ${customer.name} (${customer.reference}).`, {
      customerId: customer.id,
      reference: customer.reference,
      notes: customer.notes,
    });
  },
  async preview({ customerId, notes }) {
    const customer = await getCustomer(customerId);
    return {
      title: `Update notes for ${customer.name}`,
      description: "Internal account notes will be replaced with the text below.",
      facts: [
        { label: "Customer", value: `${customer.name} (${customer.reference})` },
        { label: "Current notes", value: customer.notes ?? "—" },
        { label: "New notes", value: notes },
      ],
    };
  },
});
