import { describe, expect, it } from "vitest";
import { BASE_RISK, classifyRisk, isHighRisk } from "@/lib/ai/risk";

describe("risk engine", () => {
  it("classifies read-only tools as low risk with no approval", () => {
    const assessment = classifyRisk("getOrder", { orderId: "ORD-1004" });
    expect(assessment.level).toBe("LOW");
    expect(assessment.requiresApproval).toBe(false);
  });

  it("requires approval for every high-risk tool", () => {
    for (const [tool, level] of Object.entries(BASE_RISK)) {
      if (level !== "HIGH") continue;
      expect(classifyRisk(tool, {}).requiresApproval).toBe(true);
    }
  });

  it("auto-approves medium risk by default but stops when disabled", () => {
    const args = { customerId: "CUST-1001", subject: "x", description: "y" };
    expect(classifyRisk("createSupportTicket", args).requiresApproval).toBe(false);
    expect(
      classifyRisk("createSupportTicket", args, { autoApproveMediumRisk: false }).requiresApproval,
    ).toBe(true);
  });

  it("fails closed for an unrecognised tool", () => {
    const assessment = classifyRisk("dropAllTables", { sql: "DROP TABLE users" });
    expect(assessment.level).toBe("HIGH");
    expect(assessment.requiresApproval).toBe(true);
    expect(assessment.reasons.join(" ")).toMatch(/unrecognised/i);
  });

  it("adds an escalation reason for a large refund", () => {
    const small = classifyRisk("createRefund", { orderId: "ORD-1", amountMinor: 100_00 });
    const large = classifyRisk("createRefund", { orderId: "ORD-1", amountMinor: 30_000_00 });

    expect(small.level).toBe("HIGH");
    expect(large.level).toBe("HIGH");
    expect(large.reasons.length).toBeGreaterThan(small.reasons.length);
    expect(large.reasons.join(" ")).toMatch(/above/i);
  });

  it("raises email risk when the body promises a refund", () => {
    const plain = classifyRisk("sendCustomerEmail", { body: "Your order is on its way." });
    const promise = classifyRisk("sendCustomerEmail", {
      body: "We will issue a full refund today.",
    });
    expect(promise.reasons.length).toBeGreaterThan(plain.reasons.length);
  });

  it("treats resolving a ticket as a reportable change", () => {
    const opened = classifyRisk("updateSupportTicket", { ticketId: "TKT-1", priority: "HIGH" });
    const closed = classifyRisk("updateSupportTicket", { ticketId: "TKT-1", status: "CLOSED" });
    expect(closed.reasons.length).toBeGreaterThan(opened.reasons.length);
  });

  it("exposes a stable high-risk predicate for the UI", () => {
    expect(isHighRisk("createRefund")).toBe(true);
    expect(isHighRisk("cancelOrder")).toBe(true);
    expect(isHighRisk("sendCustomerEmail")).toBe(true);
    expect(isHighRisk("getCustomer")).toBe(false);
  });
});
