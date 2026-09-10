import { z } from "zod";
import { defineTool, ok } from "@/lib/ai/tools/types";
import { truncate } from "@/lib/utils";
import { getCustomer } from "@/server/services/customer-service";
import { sendCustomerEmail } from "@/server/services/email-service";
import { createEscalation } from "@/server/services/escalation-service";

export const sendCustomerEmailTool = defineTool({
  name: "sendCustomerEmail",
  description:
    "Send an email to a customer from the operations mailbox. High risk: this leaves the company, so it is always confirmed by a human first.",
  permission: "email:send",
  schema: z.object({
    customerId: z.string().min(2).describe("Customer id, reference or email"),
    subject: z.string().min(3).max(200),
    body: z.string().min(10).max(5000),
  }),
  async execute(args, context) {
    const { email, customer } = await sendCustomerEmail({
      customerIdOrReference: args.customerId,
      subject: args.subject,
      body: args.body,
      conversationId: context.conversationId,
      actorType: "AGENT",
      sentById: context.userId,
    });
    return ok(
      `Sent "${email.subject}" to ${customer.name} at ${email.toEmail} via the ${email.provider} provider.`,
      {
        emailId: email.id,
        customerId: customer.id,
        customerName: customer.name,
        to: email.toEmail,
        subject: email.subject,
        provider: email.provider,
        status: email.status,
      },
    );
  },
  async preview(args) {
    const customer = await getCustomer(args.customerId);
    return {
      title: `Email ${customer.name}`,
      description: "This message will be delivered to the customer's inbox.",
      facts: [
        { label: "To", value: `${customer.name} <${customer.email}>` },
        { label: "Subject", value: args.subject },
        { label: "Body", value: truncate(args.body, 900) },
      ],
    };
  },
});

export const escalateToHumanTool = defineTool({
  name: "escalateToHuman",
  description:
    "Hand the conversation to a human specialist. Use when the request is outside the agent's remit, legally sensitive, or the customer explicitly asks for a person.",
  permission: "agent:use",
  schema: z.object({
    reason: z.string().min(3).max(300).describe("Why a human is needed"),
    summary: z.string().min(3).max(2000).describe("What the human needs to know to take over"),
    customerId: z.string().optional(),
  }),
  async execute(args, context) {
    const escalation = await createEscalation({
      conversationId: context.conversationId,
      customerIdOrReference: args.customerId ?? null,
      reason: args.reason,
      summary: args.summary,
    });
    return ok(
      `Escalated to a human specialist (${escalation.reason}). The conversation is now in the escalation queue and someone will pick it up.`,
      { escalationId: escalation.id, status: escalation.status, reason: escalation.reason },
    );
  },
});
