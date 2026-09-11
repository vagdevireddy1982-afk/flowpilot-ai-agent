import { describe, expect, it } from "vitest";
import { listTools } from "@/lib/ai/tools/registry";
import { assertPermission, hasPermission, ROLE_PERMISSIONS } from "@/lib/auth/rbac";
import { canDecide } from "@/server/services/approval-service";
import { AppError } from "@/lib/errors";

describe("role-based access control", () => {
  it("gives viewers read access but no write or agent access", () => {
    expect(hasPermission("VIEWER", "customer:read")).toBe(true);
    expect(hasPermission("VIEWER", "order:read")).toBe(true);
    expect(hasPermission("VIEWER", "customer:write")).toBe(false);
    expect(hasPermission("VIEWER", "agent:use")).toBe(false);
  });

  it("lets operators use the agent but not move money", () => {
    expect(hasPermission("AGENT", "agent:use")).toBe(true);
    expect(hasPermission("AGENT", "ticket:write")).toBe(true);
    expect(hasPermission("AGENT", "order:refund")).toBe(false);
    expect(hasPermission("AGENT", "order:cancel")).toBe(false);
    expect(hasPermission("AGENT", "approval:decide")).toBe(false);
  });

  it("keeps each role a superset of the one below it", () => {
    for (const permission of ROLE_PERMISSIONS.VIEWER) {
      expect(ROLE_PERMISSIONS.AGENT).toContain(permission);
    }
    for (const permission of ROLE_PERMISSIONS.AGENT) {
      expect(ROLE_PERMISSIONS.ADMIN).toContain(permission);
    }
  });

  it("throws a user-safe error when a permission is missing", () => {
    expect(() => assertPermission("VIEWER", "order:refund")).toThrowError(AppError);
    try {
      assertPermission("VIEWER", "order:refund");
    } catch (error) {
      expect((error as AppError).code).toBe("FORBIDDEN");
      expect((error as AppError).userMessage).toMatch(/issue refunds/);
    }
  });

  it("only exposes tools the role can actually run", () => {
    for (const tool of listTools()) {
      const allowedForViewer = hasPermission("VIEWER", tool.permission);
      // A viewer must never be offered a tool that mutates state.
      if (allowedForViewer) {
        expect(tool.permission.endsWith(":read")).toBe(true);
      }
    }
  });
});

describe("approval decision authority", () => {
  const refundApproval = { requestedById: "user-1", toolName: "createRefund" };

  it("lets an admin decide anyone's request", () => {
    expect(canDecide(refundApproval, { id: "someone-else", role: "ADMIN" })).toBe(true);
  });

  it("stops an operator self-approving an action their role cannot perform", () => {
    expect(canDecide(refundApproval, { id: "user-1", role: "AGENT" })).toBe(false);
  });

  it("lets the requester decide when they hold the underlying permission", () => {
    const ticketApproval = { requestedById: "user-1", toolName: "createSupportTicket" };
    expect(canDecide(ticketApproval, { id: "user-1", role: "AGENT" })).toBe(true);
    expect(canDecide(ticketApproval, { id: "user-2", role: "AGENT" })).toBe(false);
  });

  it("refuses an approval for a tool that no longer exists", () => {
    expect(canDecide({ requestedById: "user-1", toolName: "removedTool" }, { id: "user-1", role: "AGENT" })).toBe(
      false,
    );
  });

  it("never lets a viewer decide anything", () => {
    expect(canDecide(refundApproval, { id: "user-1", role: "VIEWER" })).toBe(false);
  });
});
