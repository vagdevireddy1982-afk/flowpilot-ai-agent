import type { RiskLevel } from "@/generated/prisma/enums";
import type { RiskAssessment } from "@/types/agent";

/**
 * Action-risk classification.
 *
 * Risk is a property of the *action*, not of the model that proposed it, so it
 * is evaluated server-side after argument validation and before execution.
 * Base levels come from the tool catalogue; escalation rules can raise (never
 * lower) a level based on the concrete arguments.
 */

export const BASE_RISK: Record<string, RiskLevel> = {
  // Read-only
  getCustomer: "LOW",
  searchCustomers: "LOW",
  getOrder: "LOW",
  searchOrders: "LOW",
  getOrderHistory: "LOW",
  getCustomerOrderHistory: "LOW",
  getTicket: "LOW",
  getCustomerTickets: "LOW",
  searchKnowledgeBase: "LOW",
  // Internal writes
  createSupportTicket: "MEDIUM",
  updateSupportTicket: "MEDIUM",
  updateCustomerNotes: "MEDIUM",
  escalateToHuman: "MEDIUM",
  // Irreversible or externally visible
  cancelOrder: "HIGH",
  createRefund: "HIGH",
  sendCustomerEmail: "HIGH",
};

const ORDER: RiskLevel[] = ["LOW", "MEDIUM", "HIGH"];

function max(a: RiskLevel, b: RiskLevel): RiskLevel {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

interface EscalationRule {
  tool: string;
  level: RiskLevel;
  reason: string;
  applies(args: Record<string, unknown>): boolean;
}

/** ₹25,000 — above this a refund is reviewed even by an operator who could otherwise self-approve. */
const LARGE_REFUND_MINOR = 25_000_00;

const ESCALATIONS: EscalationRule[] = [
  {
    tool: "createRefund",
    level: "HIGH",
    reason: `Refund amount is above ₹${(LARGE_REFUND_MINOR / 100).toLocaleString("en-IN")}`,
    applies: (args) => typeof args.amountMinor === "number" && args.amountMinor >= LARGE_REFUND_MINOR,
  },
  {
    tool: "updateSupportTicket",
    level: "MEDIUM",
    reason: "Closing a ticket ends the customer's active support thread",
    applies: (args) => args.status === "CLOSED" || args.status === "RESOLVED",
  },
  {
    tool: "sendCustomerEmail",
    level: "HIGH",
    reason: "Message body mentions a refund or compensation commitment",
    applies: (args) =>
      typeof args.body === "string" && /refund|compensat|credit note|goodwill/i.test(args.body),
  },
];

const REASONS: Record<RiskLevel, string> = {
  LOW: "Read-only lookup with no side effects",
  MEDIUM: "Changes internal records",
  HIGH: "Irreversible or visible outside the company",
};

export interface RiskOptions {
  /** When false, MEDIUM-risk actions also stop for confirmation. */
  autoApproveMediumRisk?: boolean;
}

export function classifyRisk(
  toolName: string,
  args: Record<string, unknown>,
  options: RiskOptions = {},
): RiskAssessment {
  // Unknown tools are treated as high risk: fail closed, never open.
  const base = BASE_RISK[toolName] ?? "HIGH";
  const reasons = [BASE_RISK[toolName] ? REASONS[base] : "Unrecognised tool — defaulting to the safest classification"];

  let level = base;
  for (const rule of ESCALATIONS) {
    if (rule.tool !== toolName) continue;
    if (!rule.applies(args)) continue;
    reasons.push(rule.reason);
    level = max(level, rule.level);
  }

  const autoApproveMedium = options.autoApproveMediumRisk ?? true;
  const requiresApproval = level === "HIGH" || (level === "MEDIUM" && !autoApproveMedium);

  return { level, requiresApproval, reasons };
}

export function isHighRisk(toolName: string): boolean {
  return (BASE_RISK[toolName] ?? "HIGH") === "HIGH";
}
