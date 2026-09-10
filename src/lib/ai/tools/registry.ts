import { z } from "zod";
import type { ToolSpec } from "@/lib/ai/provider";
import {
  getCustomerOrderHistoryTool,
  getCustomerTool,
  searchCustomersTool,
  updateCustomerNotesTool,
} from "@/lib/ai/tools/customer-tools";
import {
  escalateToHumanTool,
  sendCustomerEmailTool,
} from "@/lib/ai/tools/communication-tools";
import { searchKnowledgeBaseTool } from "@/lib/ai/tools/knowledge-tools";
import {
  cancelOrderTool,
  createRefundTool,
  getOrderHistoryTool,
  getOrderTool,
  searchOrdersTool,
} from "@/lib/ai/tools/order-tools";
import {
  createSupportTicketTool,
  getCustomerTicketsTool,
  getTicketTool,
  updateSupportTicketTool,
} from "@/lib/ai/tools/ticket-tools";
import type { ToolDefinition } from "@/lib/ai/tools/types";
import { hasPermission } from "@/lib/auth/rbac";
import type { Role } from "@/generated/prisma/enums";

const ALL_TOOLS: ToolDefinition[] = [
  getCustomerTool,
  searchCustomersTool,
  getCustomerOrderHistoryTool,
  updateCustomerNotesTool,
  getOrderTool,
  searchOrdersTool,
  getOrderHistoryTool,
  cancelOrderTool,
  createRefundTool,
  getTicketTool,
  getCustomerTicketsTool,
  createSupportTicketTool,
  updateSupportTicketTool,
  searchKnowledgeBaseTool,
  sendCustomerEmailTool,
  escalateToHumanTool,
];

const TOOL_MAP = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_MAP.get(name);
}

export function listTools(): ToolDefinition[] {
  return ALL_TOOLS;
}

/** Only the tools the signed-in user is actually allowed to trigger. */
export function listToolsForRole(role: Role): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => hasPermission(role, tool.permission));
}

/**
 * Zod is the single source of truth for tool arguments: the same schema
 * produces the JSON Schema advertised to the model *and* validates whatever
 * the model sends back.
 */
export function toToolSpec(tool: ToolDefinition): ToolSpec {
  const parameters = z.toJSONSchema(tool.schema, { io: "input", target: "draft-7" }) as Record<
    string,
    unknown
  >;
  return {
    name: tool.name,
    description: tool.description,
    parameters,
  };
}

export function getToolSpecs(role: Role): ToolSpec[] {
  return listToolsForRole(role).map(toToolSpec);
}
