import { z } from "zod";
import { defineTool, ok } from "@/lib/ai/tools/types";
import { titleCase } from "@/lib/utils";
import { getCustomer } from "@/server/services/customer-service";
import {
  createTicket,
  getCustomerTickets,
  getTicket,
  updateTicket,
} from "@/server/services/ticket-service";

const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const statusSchema = z.enum(["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]);
const categorySchema = z.enum(["BILLING", "DELIVERY", "PRODUCT", "ACCOUNT", "OTHER"]);

type Ticket = Awaited<ReturnType<typeof getTicket>>;

function ticketShape(ticket: Ticket) {
  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    customerId: ticket.customerId,
    customerName: ticket.customer.name,
    orderReference: ticket.order?.reference ?? null,
    assignedTo: ticket.assignedTo?.name ?? null,
    createdAt: ticket.createdAt.toISOString(),
  };
}

export const getTicketTool = defineTool({
  name: "getTicket",
  description: "Fetch a single support ticket by reference (TKT-1001) or id.",
  permission: "ticket:read",
  schema: z.object({ ticketId: z.string().min(2) }),
  async execute({ ticketId }) {
    const ticket = await getTicket(ticketId);
    return ok(
      `Ticket ${ticket.reference} — "${ticket.subject}" for ${ticket.customer.name}. Status ${titleCase(
        ticket.status,
      )}, priority ${titleCase(ticket.priority)}${ticket.assignedTo ? `, assigned to ${ticket.assignedTo.name}` : ", unassigned"}.`,
      ticketShape(ticket),
    );
  },
});

export const getCustomerTicketsTool = defineTool({
  name: "getCustomerTickets",
  description: "List support tickets belonging to a customer.",
  permission: "ticket:read",
  schema: z.object({
    customerId: z.string().min(2).describe("Customer id, reference or email"),
    openOnly: z.boolean().optional().default(false),
  }),
  async execute({ customerId, openOnly }) {
    const customer = await getCustomer(customerId);
    const tickets = await getCustomerTickets(customer.id, openOnly);

    if (tickets.length === 0) {
      return ok(`${customer.name} has no ${openOnly ? "open " : ""}support tickets.`, {
        customerId: customer.id,
        tickets: [],
      });
    }

    return ok(
      `${customer.name} has ${tickets.length} ${openOnly ? "open " : ""}ticket${tickets.length > 1 ? "s" : ""}: ${tickets
        .map((ticket) => `${ticket.reference} (${titleCase(ticket.status)}, ${titleCase(ticket.priority)}) — ${ticket.subject}`)
        .join("; ")}.`,
      { customerId: customer.id, tickets: tickets.map(ticketShape) },
    );
  },
});

export const createSupportTicketTool = defineTool({
  name: "createSupportTicket",
  description:
    "Open a new support ticket for a customer. Use when an issue needs tracking beyond this conversation.",
  permission: "ticket:write",
  schema: z.object({
    customerId: z.string().min(2).describe("Customer id, reference or email"),
    subject: z.string().min(3).max(160),
    description: z.string().min(3).max(4000),
    priority: prioritySchema.optional().default("MEDIUM"),
    category: categorySchema.optional().default("OTHER"),
    orderId: z.string().optional().describe("Related order reference, if any"),
  }),
  async execute(args) {
    const ticket = await createTicket({
      customerIdOrReference: args.customerId,
      subject: args.subject,
      description: args.description,
      priority: args.priority,
      category: args.category,
      orderIdOrReference: args.orderId ?? null,
      createdBy: "AGENT",
    });
    return ok(
      `Created ${titleCase(ticket.priority)}-priority ticket ${ticket.reference} for ${ticket.customer.name}: "${ticket.subject}".`,
      ticketShape(ticket),
    );
  },
  async preview(args) {
    const customer = await getCustomer(args.customerId);
    return {
      title: `Create ticket for ${customer.name}`,
      description: "A new support ticket will be opened and appear in the tickets queue.",
      facts: [
        { label: "Customer", value: `${customer.name} (${customer.reference})` },
        { label: "Subject", value: args.subject },
        { label: "Priority", value: titleCase(args.priority) },
        { label: "Category", value: titleCase(args.category) },
        ...(args.orderId ? [{ label: "Related order", value: args.orderId }] : []),
      ],
    };
  },
});

export const updateSupportTicketTool = defineTool({
  name: "updateSupportTicket",
  description: "Change the status, priority, category or assignee of an existing support ticket.",
  permission: "ticket:write",
  schema: z
    .object({
      ticketId: z.string().min(2),
      status: statusSchema.optional(),
      priority: prioritySchema.optional(),
      category: categorySchema.optional(),
    })
    .refine(
      (value) => Boolean(value.status || value.priority || value.category),
      "Provide at least one field to update",
    ),
  async execute(args) {
    const ticket = await updateTicket(args.ticketId, {
      status: args.status,
      priority: args.priority,
      category: args.category,
    });
    const changes = [
      args.status ? `status → ${titleCase(args.status)}` : null,
      args.priority ? `priority → ${titleCase(args.priority)}` : null,
      args.category ? `category → ${titleCase(args.category)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return ok(`Updated ticket ${ticket.reference} (${changes}).`, ticketShape(ticket));
  },
  async preview(args) {
    const ticket = await getTicket(args.ticketId);
    return {
      title: `Update ticket ${ticket.reference}`,
      description: `"${ticket.subject}" for ${ticket.customer.name} will be updated.`,
      facts: [
        { label: "Current status", value: titleCase(ticket.status) },
        ...(args.status ? [{ label: "New status", value: titleCase(args.status) }] : []),
        { label: "Current priority", value: titleCase(ticket.priority) },
        ...(args.priority ? [{ label: "New priority", value: titleCase(args.priority) }] : []),
      ],
    };
  },
});
