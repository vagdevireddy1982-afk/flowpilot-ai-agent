import type { z } from "zod";
import type { Role } from "@/generated/prisma/enums";
import type { Permission } from "@/lib/auth/rbac";
import type { Citation, ToolResult } from "@/types/agent";

export interface ToolContext {
  userId: string;
  userName: string;
  userEmail: string;
  role: Role;
  conversationId: string;
}

export interface ToolPreviewFact {
  label: string;
  value: string;
}

/** Rendered on the approval card so a human sees real data before deciding. */
export interface ToolPreview {
  title: string;
  description: string;
  facts: ToolPreviewFact[];
}

export interface ToolDefinition<TSchema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: TSchema;
  /** Permission the *human on whose behalf the agent acts* must hold. */
  permission: Permission;
  execute(args: z.infer<TSchema>, context: ToolContext): Promise<ToolResult>;
  /** Optional richer confirmation card for approval-gated tools. */
  preview?(args: z.infer<TSchema>, context: ToolContext): Promise<ToolPreview>;
}

export function defineTool<TSchema extends z.ZodType>(
  definition: ToolDefinition<TSchema>,
): ToolDefinition<TSchema> {
  return definition;
}

export function ok<T>(summary: string, data: T, citations?: Citation[]): ToolResult<T> {
  return citations?.length ? { ok: true, summary, data, citations } : { ok: true, summary, data };
}

export function fail(code: string, error: string): ToolResult<never> {
  return { ok: false, code, error };
}
