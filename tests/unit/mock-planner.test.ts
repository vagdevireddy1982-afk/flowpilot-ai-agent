import { describe, expect, it } from "vitest";
import {
  extractAmountMinor,
  extractCustomerQuery,
  extractOrderRef,
  planNextStep,
  type MockStep,
} from "@/lib/ai/providers/mock/intent";

const ok = (name: string, data: unknown, summary = "done"): MockStep => ({
  name,
  arguments: {},
  result: { ok: true, summary, data },
});

describe("entity extraction", () => {
  it("finds order references regardless of case", () => {
    expect(extractOrderRef("cancel ord-1004 please")).toBe("ORD-1004");
    expect(extractOrderRef("no reference here")).toBeNull();
  });

  it("parses amounts written the way operators write them", () => {
    expect(extractAmountMinor("refund ₹12,499 to the customer")).toBe(1_249_900);
    expect(extractAmountMinor("refund Rs. 500.50")).toBe(50_050);
    expect(extractAmountMinor("refund the order")).toBeNull();
  });

  it("pulls a person out of a possessive or a for-clause", () => {
    expect(extractCustomerQuery("What's the status of Priya Sharma's latest order?")).toBe(
      "Priya Sharma",
    );
    expect(extractCustomerQuery("Create a ticket for Arjun Nair because it is late")).toBe(
      "Arjun Nair",
    );
    expect(extractCustomerQuery("Find customer priya sharma")).toBe("priya sharma");
  });

  it("does not mistake question words or status words for names", () => {
    expect(extractCustomerQuery("What is the refund policy?")).toBeNull();
    expect(extractCustomerQuery("Find all delayed orders")).toBeNull();
  });

  it("prefers an explicit email address", () => {
    expect(extractCustomerQuery("look up priya.sharma@lumenretail.example")).toBe(
      "priya.sharma@lumenretail.example",
    );
  });
});

describe("planNextStep", () => {
  it("looks up an order that is named directly", () => {
    const plan = planNextStep({ userMessage: "Show me order ORD-1004.", steps: [] });
    expect(plan).toEqual({ kind: "tool", name: "getOrder", arguments: { orderId: "ORD-1004" } });
  });

  it("stops once the named order has been fetched", () => {
    const plan = planNextStep({
      userMessage: "Show me order ORD-1004.",
      steps: [ok("getOrder", { reference: "ORD-1004" })],
    });
    expect(plan.kind).toBe("answer");
  });

  it("reads the order before proposing a refund on it", () => {
    const first = planNextStep({ userMessage: "Refund order ORD-1004.", steps: [] });
    expect(first).toMatchObject({ name: "getOrder" });

    const second = planNextStep({
      userMessage: "Refund order ORD-1004.",
      steps: [ok("getOrder", { reference: "ORD-1004" })],
    });
    expect(second).toMatchObject({ kind: "tool", name: "createRefund" });
    expect(second).toMatchObject({ arguments: { orderId: "ORD-1004" } });
  });

  it("carries an explicit amount into the refund arguments", () => {
    const plan = planNextStep({
      userMessage: "Refund ₹500 on ORD-1004.",
      steps: [ok("getOrder", { reference: "ORD-1004" })],
    });
    expect(plan).toMatchObject({ name: "createRefund", arguments: { amountMinor: 50_000 } });
  });

  it("routes policy questions to the knowledge base", () => {
    const plan = planNextStep({
      userMessage: "According to our refund policy, can a delivered order be refunded?",
      steps: [],
    });
    expect(plan).toMatchObject({ kind: "tool", name: "searchKnowledgeBase" });
  });

  it("treats a general how-long question as a knowledge question", () => {
    const plan = planNextStep({
      userMessage: "How long does an express delivery to a metro city take?",
      steps: [],
    });
    expect(plan).toMatchObject({ name: "searchKnowledgeBase" });
  });

  it("does not send a specific order lookup to the knowledge base", () => {
    const plan = planNextStep({ userMessage: "Can I cancel ORD-1004?", steps: [] });
    expect(plan).toMatchObject({ name: "getOrder" });
  });

  it("resolves the customer before creating a ticket for them", () => {
    const first = planNextStep({
      userMessage: "Create a high priority ticket for Priya Sharma because her order is delayed.",
      steps: [],
    });
    expect(first).toMatchObject({ name: "searchCustomers", arguments: { query: "Priya Sharma" } });

    const second = planNextStep({
      userMessage: "Create a high priority ticket for Priya Sharma because her order is delayed.",
      steps: [first as never, ok("searchCustomers", { customerId: "cus_1" })],
    });
    expect(second).toMatchObject({
      name: "createSupportTicket",
      arguments: { customerId: "cus_1", priority: "HIGH", category: "DELIVERY" },
    });
  });

  it("ends the turn after a write action succeeds", () => {
    const plan = planNextStep({
      userMessage: "Create a ticket for Priya Sharma because her order is delayed.",
      steps: [ok("searchCustomers", { customerId: "cus_1" }), ok("createSupportTicket", {})],
    });
    expect(plan.kind).toBe("answer");
  });

  it("finds delayed orders, then emails the affected customers one at a time", () => {
    const question = "Draft a follow-up email to customers whose orders are delayed.";
    const first = planNextStep({ userMessage: question, steps: [] });
    expect(first).toMatchObject({ name: "searchOrders", arguments: { delayedOnly: true } });

    const orders = [
      { customerId: "cus_1", customerName: "Priya Sharma", reference: "ORD-1004" },
      { customerId: "cus_2", customerName: "Arjun Nair", reference: "ORD-1005" },
    ];
    const second = planNextStep({
      userMessage: question,
      steps: [ok("searchOrders", { orders })],
    });
    expect(second).toMatchObject({ name: "sendCustomerEmail", arguments: { customerId: "cus_1" } });

    const third = planNextStep({
      userMessage: question,
      steps: [ok("searchOrders", { orders }), ok("sendCustomerEmail", {})],
    });
    expect(third).toMatchObject({ name: "sendCustomerEmail", arguments: { customerId: "cus_2" } });
  });

  it("emails about the order the request named, not the first delayed one", () => {
    const question =
      "Send a follow-up email to Priya Sharma apologising that order ORD-1005 is delayed.";
    const orders = [
      { customerId: "cus_1", customerName: "Priya Sharma", reference: "ORD-1004" },
      { customerId: "cus_2", customerName: "Priya Sharma", reference: "ORD-1005" },
    ];

    const plan = planNextStep({
      userMessage: question,
      steps: [ok("getOrder", { reference: "ORD-1005" }), ok("searchOrders", { orders })],
    });

    expect(plan).toMatchObject({ name: "sendCustomerEmail", arguments: { customerId: "cus_2" } });
    if (plan.kind !== "tool") throw new Error("expected a tool call");
    expect(String(plan.arguments.subject)).toContain("ORD-1005");
    expect(String(plan.arguments.body)).not.toContain("ORD-1004");
  });

  it("escalates legal threats and explicit requests for a person", () => {
    expect(
      planNextStep({ userMessage: "My lawyer will be in touch about this.", steps: [] }),
    ).toMatchObject({ name: "escalateToHuman" });

    expect(
      planNextStep({ userMessage: "I want to speak to a human about this.", steps: [] }),
    ).toMatchObject({ name: "escalateToHuman" });
  });

  it("stops immediately when a step failed", () => {
    const plan = planNextStep({
      userMessage: "Refund order ORD-9999.",
      steps: [{ name: "getOrder", arguments: {}, result: { ok: false, error: "not found" } }],
    });
    expect(plan.kind).toBe("answer");
  });

  it("offers help instead of guessing when nothing matches", () => {
    const plan = planNextStep({ userMessage: "hello there", steps: [] });
    expect(plan.kind).toBe("answer");
    expect(plan).toMatchObject({ kind: "answer" });
    if (plan.kind !== "answer") return;
    expect(plan.content).toMatch(/look up customers/i);
  });
});
