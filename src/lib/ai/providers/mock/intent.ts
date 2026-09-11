/**
 * Deterministic planner behind `MockAIProvider`.
 *
 * This is a pure function of (user message, previous tool steps). It stands in
 * for an LLM's tool-selection step so the whole product — including the
 * approval and RAG flows — can be demonstrated with no API key. It never
 * touches the database: like a real model, it can only *ask* for tools to run.
 */

export interface MockStep {
  name: string;
  arguments: Record<string, unknown>;
  /** Parsed tool result envelope, if the step already executed. */
  result?: {
    ok: boolean;
    summary?: string;
    error?: string;
    data?: unknown;
    citations?: unknown[];
  };
}

export interface MockPlanInput {
  userMessage: string;
  steps: MockStep[];
}

export type MockPlan =
  | { kind: "tool"; name: string; arguments: Record<string, unknown> }
  | { kind: "answer"; content: string };

const ORDER_REF = /\bORD-\d{3,6}\b/i;
const TICKET_REF = /\bTKT-\d{3,6}\b/i;
const CUSTOMER_REF = /\bCUST-\d{3,6}\b/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const AMOUNT = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)|\b([\d,]{3,})\s*(?:rupees|inr)\b/i;

export function extractOrderRef(text: string): string | null {
  return text.match(ORDER_REF)?.[0]?.toUpperCase() ?? null;
}

export function extractTicketRef(text: string): string | null {
  return text.match(TICKET_REF)?.[0]?.toUpperCase() ?? null;
}

export function extractAmountMinor(text: string): number | null {
  const match = text.match(AMOUNT);
  if (!match) return null;
  const raw = (match[1] ?? match[2] ?? "").replace(/,/g, "");
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

const COMMAND_PREFIXES =
  /^(?:can you\s+|please\s+|hey\s+|hi\s+|could you\s+|i want to\s+|i need to\s+)+/i;
const LOOKUP_VERBS =
  /^(?:find|search(?:\s+for)?|look\s*up|get|show(?:\s+me)?|pull\s*up|fetch|who\s+is|tell me about)\s+/i;
const NOISE_WORDS =
  /^(?:the\s+|a\s+|an\s+|our\s+|my\s+|customer\s+|client\s+|account\s+|user\s+|contact\s+)+/i;

/** Best-effort customer identifier: an email, a CUST- reference, or a name. */
export function extractCustomerQuery(text: string): string | null {
  const email = text.match(EMAIL)?.[0];
  if (email) return email;
  const reference = text.match(CUSTOMER_REF)?.[0];
  if (reference) return reference.toUpperCase();

  for (const match of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)['’]s\b/g)) {
    if (isPlausibleName(match[1]!)) return match[1]!;
  }

  for (const match of text.matchAll(
    /\b(?:for|about|of|to)\s+(?:customer\s+|client\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
  )) {
    if (isPlausibleName(match[1]!)) return match[1]!;
  }

  let cleaned = text.trim().replace(COMMAND_PREFIXES, "");
  if (LOOKUP_VERBS.test(cleaned)) {
    cleaned = cleaned.replace(LOOKUP_VERBS, "").replace(NOISE_WORDS, "");
    cleaned = cleaned.replace(/[?.!]+$/, "").trim();
    // Strip trailing intent words so "find priya sharma's orders" → "priya sharma"
    cleaned = cleaned.replace(
      /\b(?:'s)?\s*(orders?|tickets?|details?|profile|account|record|information|info|history)\b.*$/i,
      "",
    );
    cleaned = cleaned.replace(/[’']s\b/, "").trim();
    if (cleaned.length >= 2 && cleaned.split(/\s+/).length <= 4 && isPlausibleName(cleaned)) {
      return cleaned;
    }
  }

  for (const match of text.matchAll(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g)) {
    if (isPlausibleName(match[1]!)) return match[1]!;
  }
  return null;
}

/**
 * Filters out phrases that look like names to a regex but obviously are not —
 * question words, filler and status vocabulary ("What's", "all delayed").
 */
const NOT_A_NAME = new Set([
  "what", "who", "where", "when", "why", "how", "which", "that", "this", "these", "those",
  "it", "its", "the", "there", "here", "let", "please", "show", "find", "all", "every",
  "any", "some", "open", "pending", "recent", "latest", "last", "delayed", "late", "order",
  "orders", "ticket", "tickets", "customer", "customers", "email", "emails", "today",
  "yesterday", "status", "refund", "refunds", "them", "him", "her", "his", "their", "our",
]);

export function isPlausibleName(candidate: string): boolean {
  const words = candidate.trim().split(/\s+/);
  if (words.length === 0 || words.length > 4) return false;
  return words.every((word) => !NOT_A_NAME.has(word.toLowerCase().replace(/[^a-z]/g, "")));
}

function has(text: string, ...patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function stepFor(steps: MockStep[], name: string): MockStep | undefined {
  return steps.find((step) => step.name === name);
}

function customerIdFromSteps(steps: MockStep[]): string | null {
  for (const step of [...steps].reverse()) {
    const data = step.result?.data as
      | { customerId?: string; customers?: Array<{ id?: string }>; customer?: { id?: string }; id?: string }
      | undefined;
    if (!data) continue;
    if (typeof data.customerId === "string") return data.customerId;
    if (data.customer?.id) return data.customer.id;
    if (Array.isArray(data.customers) && data.customers[0]?.id) return data.customers[0]!.id!;
    if (step.name === "getCustomer" && typeof data.id === "string") return data.id;
  }
  return null;
}

function orderRefFromSteps(steps: MockStep[]): string | null {
  for (const step of [...steps].reverse()) {
    const data = step.result?.data as
      | { orders?: Array<{ reference?: string }>; reference?: string }
      | undefined;
    if (!data) continue;
    if (Array.isArray(data.orders) && data.orders[0]?.reference) return data.orders[0]!.reference!;
    if (typeof data.reference === "string" && data.reference.startsWith("ORD-")) {
      return data.reference;
    }
  }
  return null;
}

/** Tools that change state; reaching one of these ends the planning loop. */
const WRITE_TOOLS = new Set([
  "createSupportTicket",
  "updateSupportTicket",
  "updateCustomerNotes",
  "createRefund",
  "cancelOrder",
  "escalateToHuman",
]);

const CAPABILITIES = [
  "look up customers, orders and support tickets",
  "search the knowledge base and answer with citations",
  "create and update support tickets",
  "cancel orders, issue refunds and email customers (with your approval)",
];

/**
 * Decides the next action. Called once per agent-loop iteration with the tool
 * results gathered so far.
 */
export function planNextStep(input: MockPlanInput): MockPlan {
  const text = input.userMessage.trim();
  const lower = text.toLowerCase();
  const steps = input.steps;
  const lastStep = steps[steps.length - 1];

  // A failed step always ends the turn — the orchestrator surfaces the error.
  if (lastStep?.result && lastStep.result.ok === false) {
    return { kind: "answer", content: "" };
  }

  // Once a write action has landed, stop: further lookups would be noise and
  // would burn the loop budget that produces the final answer.
  if (steps.some((step) => WRITE_TOOLS.has(step.name) && step.result?.ok)) {
    return { kind: "answer", content: "" };
  }

  const wantsEmail = has(
    lower,
    /\b(send|draft|write|compose)\b.*\b(e-?mail|message|follow.?up|note|apolog)/,
    /\bfollow.?up\b.*\bemail\b/,
    /\bemail\b.*\bcustomers?\b/,
  );
  const wantsRefund = has(lower, /\brefund(ed|ing)?\b/, /\bmoney back\b/, /\breimburse/);
  const wantsCancel = has(lower, /\bcancel\b/);
  const wantsTicketCreate = has(
    lower,
    /\b(create|raise|open|log|file)\b.*\b(ticket|case|issue|complaint)\b/,
    /\bticket\b.*\b(because|for)\b/,
  );
  const wantsTicketUpdate = has(
    lower,
    /\b(update|close|resolve|reopen|escalate|set|change)\b.*\bticket\b/,
    /\bticket\b.*\b(to|as)\b.*\b(resolved|closed|urgent|high|low|medium|in progress|waiting)\b/,
  );
  const explicitPolicy = has(
    lower,
    /\b(policy|policies|sla|warranty|guideline|procedure|documentation|handbook|knowledge base|playbook|standard)\b/,
    /\baccording to (?:our|the)\b/,
  );
  // A general question about how the business operates, with no specific record
  // attached, is a knowledge-base question rather than a database lookup.
  const isQuestion = /^(what|how|when|can|are|is|do|does|should|who|whose|may)\b/.test(lower) || lower.endsWith("?");
  const policyTopic = has(
    lower,
    /\b(deliver\w*|dispatch\w*|ship\w*|return\w*|refund\w*|warrant\w*|escalat\w*|cancel\w*|privacy|retention|compensat\w*|priority|response time|working days|eligib\w*)\b/,
  );
  const wantsKnowledge =
    explicitPolicy ||
    (isQuestion && policyTopic && !ORDER_REF.test(text) && !TICKET_REF.test(text));
  const wantsDelayed = has(lower, /\bdelay(ed|s)?\b/, /\blate\b/, /\boverdue\b/, /\bbehind schedule\b/);
  const wantsHuman = has(
    lower,
    /\b(talk|speak|transfer|connect|put me)\b.*\b(human|person|manager|supervisor|someone)\b/,
    /\b(human|person|manager|supervisor|real person)\b.*\b(talk|speak|escalate|transfer|hand)/,
    /\b(escalate|hand off|handoff)\b/,
    /\b(legal|lawyer|attorney|solicitor|lawsuit|sue|suing|consumer court|defamation|ombudsman)\b/,
  );
  const wantsHistory = has(lower, /\b(history|timeline|what happened|events)\b/);

  const explicitOrderRef = extractOrderRef(text);
  // Only action chains (refund/cancel) may adopt a reference discovered by an
  // earlier step; plain lookups stay anchored to what the user actually typed.
  const orderRef = explicitOrderRef ?? orderRefFromSteps(steps);
  const ticketRef = extractTicketRef(text);
  const customerQuery = extractCustomerQuery(text);
  const knownCustomerId = customerIdFromSteps(steps);

  // ---- Escalation -------------------------------------------------------
  if (wantsHuman && !stepFor(steps, "escalateToHuman")) {
    return {
      kind: "tool",
      name: "escalateToHuman",
      arguments: {
        reason: /legal|lawyer|attorney|solicitor|lawsuit|sue|suing|consumer court|ombudsman/.test(
          lower,
        )
          ? "Potential legal exposure raised by the customer"
          : "Customer explicitly asked for a human operator",
        summary: text.slice(0, 400),
      },
    };
  }

  // ---- Knowledge base ---------------------------------------------------
  if (wantsKnowledge && !stepFor(steps, "searchKnowledgeBase")) {
    return {
      kind: "tool",
      name: "searchKnowledgeBase",
      arguments: { query: text.replace(/[?]/g, "").trim(), limit: 4 },
    };
  }

  // ---- Refund -----------------------------------------------------------
  if (wantsRefund && orderRef) {
    if (!stepFor(steps, "getOrder")) {
      return { kind: "tool", name: "getOrder", arguments: { orderId: orderRef } };
    }
    if (!stepFor(steps, "createRefund")) {
      const amountMinor = extractAmountMinor(text);
      return {
        kind: "tool",
        name: "createRefund",
        arguments: {
          orderId: orderRef,
          ...(amountMinor ? { amountMinor } : {}),
          reason: "Refund requested by the operations team via FlowPilot",
        },
      };
    }
  }

  // ---- Cancellation -----------------------------------------------------
  if (wantsCancel && orderRef) {
    if (!stepFor(steps, "getOrder")) {
      return { kind: "tool", name: "getOrder", arguments: { orderId: orderRef } };
    }
    if (!stepFor(steps, "cancelOrder")) {
      return {
        kind: "tool",
        name: "cancelOrder",
        arguments: {
          orderId: orderRef,
          reason: "Cancellation requested by the operations team via FlowPilot",
        },
      };
    }
  }

  // ---- Delayed orders (optionally followed by outreach) ------------------
  // "…because her order is delayed" is context for a ticket, not a request for
  // the delayed-orders report, so a stronger intent always wins.
  const delayedIsTheRequest =
    wantsDelayed && !wantsTicketCreate && !wantsTicketUpdate && !wantsRefund && !wantsCancel;
  if (delayedIsTheRequest && !stepFor(steps, "searchOrders")) {
    return {
      kind: "tool",
      name: "searchOrders",
      arguments: { delayedOnly: true, limit: 10 },
    };
  }

  if (wantsEmail) {
    const delayedStep = stepFor(steps, "searchOrders");
    const emailed = steps.filter((step) => step.name === "sendCustomerEmail").length;
    const found =
      (delayedStep?.result?.data as { orders?: Array<Record<string, unknown>> } | undefined)
        ?.orders ?? [];
    // An order named in the request pins the email to that order. Without this,
    // "email Priya about ORD-1004" writes to her about whichever order the
    // delayed-orders report happened to list first. Only an explicit reference
    // pins it: `orderRef` also picks one up from earlier steps, which would
    // reduce "email every delayed customer" to a single message.
    const targets = explicitOrderRef
      ? found.filter((order) => (order as { reference?: string }).reference === explicitOrderRef)
      : found;

    if (targets.length > 0 && emailed < Math.min(targets.length, 3)) {
      const target = targets[emailed] as {
        customerId?: string;
        customerName?: string;
        reference?: string;
        expectedDeliveryAt?: string | null;
      };
      return {
        kind: "tool",
        name: "sendCustomerEmail",
        arguments: {
          customerId: target.customerId,
          subject: `Update on your order ${target.reference ?? ""}`.trim(),
          body: buildDelayEmail(target.customerName ?? "there", target.reference ?? "your order"),
        },
      };
    }

    if (targets.length === 0 && (knownCustomerId || customerQuery)) {
      if (!knownCustomerId && customerQuery && !stepFor(steps, "searchCustomers")) {
        return { kind: "tool", name: "searchCustomers", arguments: { query: customerQuery } };
      }
      if (knownCustomerId && emailed === 0) {
        return {
          kind: "tool",
          name: "sendCustomerEmail",
          arguments: {
            customerId: knownCustomerId,
            subject: orderRef
              ? `Update on your order ${orderRef}`
              : "An update from our operations team",
            body: buildDelayEmail("there", orderRef ?? "your recent order"),
          },
        };
      }
    }
  }

  // ---- Ticket creation ---------------------------------------------------
  if (wantsTicketCreate && !stepFor(steps, "createSupportTicket")) {
    if (!knownCustomerId && customerQuery && !stepFor(steps, "searchCustomers")) {
      return { kind: "tool", name: "searchCustomers", arguments: { query: customerQuery } };
    }
    if (knownCustomerId) {
      return {
        kind: "tool",
        name: "createSupportTicket",
        arguments: {
          customerId: knownCustomerId,
          subject: deriveTicketSubject(text, orderRef),
          description: text,
          priority: derivePriority(lower),
          category: deriveCategory(lower),
          ...(orderRef ? { orderId: orderRef } : {}),
        },
      };
    }
  }

  // ---- Ticket update -----------------------------------------------------
  if (wantsTicketUpdate && ticketRef && !stepFor(steps, "updateSupportTicket")) {
    const status = deriveTicketStatus(lower);
    const priority = /\b(urgent|high|medium|low)\b/.test(lower) ? derivePriority(lower) : undefined;
    return {
      kind: "tool",
      name: "updateSupportTicket",
      arguments: { ticketId: ticketRef, ...(status ? { status } : {}), ...(priority ? { priority } : {}) },
    };
  }

  if (ticketRef && !stepFor(steps, "getCustomerTickets") && !wantsTicketUpdate) {
    return { kind: "tool", name: "getTicket", arguments: { ticketId: ticketRef } };
  }

  if (has(lower, /\btickets?\b/) && (knownCustomerId || customerQuery)) {
    if (!knownCustomerId && customerQuery && !stepFor(steps, "searchCustomers")) {
      return { kind: "tool", name: "searchCustomers", arguments: { query: customerQuery } };
    }
    if (knownCustomerId && !stepFor(steps, "getCustomerTickets")) {
      return { kind: "tool", name: "getCustomerTickets", arguments: { customerId: knownCustomerId } };
    }
  }

  // ---- Order lookups -----------------------------------------------------
  if (explicitOrderRef && wantsHistory && !stepFor(steps, "getOrderHistory")) {
    return { kind: "tool", name: "getOrderHistory", arguments: { orderId: explicitOrderRef } };
  }
  if (explicitOrderRef && !stepFor(steps, "getOrder")) {
    return { kind: "tool", name: "getOrder", arguments: { orderId: explicitOrderRef } };
  }
  // A specific order was asked for and fetched — that is the whole answer.
  if (explicitOrderRef && stepFor(steps, "getOrder")) {
    return { kind: "answer", content: "" };
  }

  const wantsOrders = has(lower, /\border(s|ed)?\b/, /\bpurchase(s)?\b/, /\bbought\b/);
  if (wantsOrders && (knownCustomerId || customerQuery)) {
    if (!knownCustomerId && customerQuery && !stepFor(steps, "searchCustomers")) {
      return { kind: "tool", name: "searchCustomers", arguments: { query: customerQuery } };
    }
    if (knownCustomerId && !stepFor(steps, "getCustomerOrderHistory")) {
      return {
        kind: "tool",
        name: "getCustomerOrderHistory",
        arguments: { customerId: knownCustomerId, limit: 5 },
      };
    }
  }

  // ---- Customer lookup ---------------------------------------------------
  // Only as an opening move: once any tool has run, a trailing name-ish phrase
  // is far more likely to be noise than a second request.
  if (steps.length === 0 && customerQuery) {
    return { kind: "tool", name: "searchCustomers", arguments: { query: customerQuery } };
  }

  if (steps.length === 0) {
    return {
      kind: "answer",
      content: `I can ${CAPABILITIES.join(", ")}.\n\nTry asking me something like "Show me order ORD-1004", "Find customer Priya Sharma", or "According to our refund policy, can a delivered order be refunded?".`,
    };
  }

  return { kind: "answer", content: "" };
}

function buildDelayEmail(name: string, reference: string): string {
  return [
    `Hi ${name},`,
    "",
    `We're writing about your order ${reference}. It is running behind our original delivery estimate, and we're sorry for the delay.`,
    "",
    "Our operations team is tracking the shipment and we will confirm a revised delivery date within 24 hours. If you would prefer to cancel or need anything else, just reply to this email and we'll take care of it right away.",
    "",
    "Thank you for your patience,",
    "FlowPilot Operations",
  ].join("\n");
}

function deriveTicketSubject(text: string, orderRef: string | null): string {
  const because = text.match(/\b(?:because|as|since|due to)\s+(.{5,90})/i)?.[1];
  if (because) {
    const cleaned = because.replace(/[.?!]+$/, "").trim();
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return orderRef ? `Issue with order ${orderRef}` : "Customer issue raised via FlowPilot";
}

function derivePriority(lower: string): "LOW" | "MEDIUM" | "HIGH" | "URGENT" {
  if (/\burgent|critical|immediately|asap\b/.test(lower)) return "URGENT";
  if (/\bhigh[- ]?priority|high\b/.test(lower)) return "HIGH";
  if (/\blow[- ]?priority|low\b/.test(lower)) return "LOW";
  return "MEDIUM";
}

function deriveCategory(lower: string): "BILLING" | "DELIVERY" | "PRODUCT" | "ACCOUNT" | "OTHER" {
  // Prefixes rather than whole words: "delayed", "shipping" and "refunded" all
  // need to land on the same category as their stems.
  if (/\b(refund\w*|payment\w*|invoice\w*|charge\w*|billing|money)\b/.test(lower)) return "BILLING";
  if (/\b(deliver\w*|ship\w*|courier|dispatch\w*|delay\w*|late|tracking)\b/.test(lower)) {
    return "DELIVERY";
  }
  if (/\b(defect\w*|broken|damaged?|faulty|quality|product\w*)\b/.test(lower)) return "PRODUCT";
  if (/\b(login|account|password|profile|address)\b/.test(lower)) return "ACCOUNT";
  return "OTHER";
}

function deriveTicketStatus(
  lower: string,
): "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED" | undefined {
  if (/\bresolved?\b/.test(lower)) return "RESOLVED";
  if (/\bclose(d)?\b/.test(lower)) return "CLOSED";
  if (/\bin[- ]progress|working on\b/.test(lower)) return "IN_PROGRESS";
  if (/\bwaiting|on hold|pending customer\b/.test(lower)) return "WAITING";
  if (/\breopen|open\b/.test(lower)) return "OPEN";
  return undefined;
}
