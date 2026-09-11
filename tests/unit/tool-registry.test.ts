import { describe, expect, it } from "vitest";
import { BASE_RISK } from "@/lib/ai/risk";
import { getTool, getToolSpecs, listTools, listToolsForRole } from "@/lib/ai/tools/registry";

describe("tool registry", () => {
  it("gives every tool a description, permission and risk level", () => {
    for (const tool of listTools()) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.permission).toMatch(/^[a-z]+:[a-z]+$/);
      expect(BASE_RISK[tool.name]).toBeDefined();
    }
  });

  it("exposes unique tool names", () => {
    const names = listTools().map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("produces JSON Schema the model can be given", () => {
    const specs = getToolSpecs("ADMIN");
    expect(specs.length).toBe(listTools().length);
    for (const spec of specs) {
      expect(spec.parameters).toHaveProperty("type", "object");
      expect(spec.parameters).toHaveProperty("properties");
    }
  });

  it("narrows the advertised tool list by role", () => {
    const admin = listToolsForRole("ADMIN").map((tool) => tool.name);
    const operator = listToolsForRole("AGENT").map((tool) => tool.name);
    const viewer = listToolsForRole("VIEWER").map((tool) => tool.name);

    expect(admin).toContain("createRefund");
    expect(operator).not.toContain("createRefund");
    expect(operator).toContain("createSupportTicket");
    expect(viewer).not.toContain("createSupportTicket");
    expect(viewer).toContain("getOrder");
  });
});

describe("tool argument validation", () => {
  it("rejects a missing required argument", () => {
    const result = getTool("getOrder")!.schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects arguments of the wrong type", () => {
    const result = getTool("createRefund")!.schema.safeParse({
      orderId: "ORD-1004",
      amountMinor: "one thousand",
      reason: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative refund", () => {
    const result = getTool("createRefund")!.schema.safeParse({
      orderId: "ORD-1004",
      amountMinor: -500,
      reason: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown enum value", () => {
    const result = getTool("createSupportTicket")!.schema.safeParse({
      customerId: "CUST-1001",
      subject: "Broken item",
      description: "The item arrived broken",
      priority: "CATASTROPHIC",
    });
    expect(result.success).toBe(false);
  });

  it("applies documented defaults", () => {
    const result = getTool("createSupportTicket")!.schema.safeParse({
      customerId: "CUST-1001",
      subject: "Broken item",
      description: "The item arrived broken",
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ priority: "MEDIUM", category: "OTHER" });
  });

  it("requires at least one field on a ticket update", () => {
    const empty = getTool("updateSupportTicket")!.schema.safeParse({ ticketId: "TKT-1001" });
    expect(empty.success).toBe(false);

    const valid = getTool("updateSupportTicket")!.schema.safeParse({
      ticketId: "TKT-1001",
      status: "RESOLVED",
    });
    expect(valid.success).toBe(true);
  });

  it("strips nothing surprising from a valid payload", () => {
    const result = getTool("searchOrders")!.schema.safeParse({ delayedOnly: true, limit: 5 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ delayedOnly: true, limit: 5 });
  });

  it("has no tool for raw SQL or shell access", () => {
    const names = listTools().map((tool) => tool.name.toLowerCase());
    expect(names.some((name) => /sql|query|exec|shell|eval/.test(name))).toBe(false);
  });
});
