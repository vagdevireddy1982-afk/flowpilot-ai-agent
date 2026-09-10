import type { RiskLevel } from "@/generated/prisma/enums";

/**
 * Envelope returned by every tool. `summary` is a human-readable, factual
 * one-liner built from the tool's own database result — the mock provider uses
 * it verbatim, and a real LLM gets it alongside the structured `data`.
 */
export type ToolResult<T = unknown> =
  | { ok: true; summary: string; data: T; citations?: Citation[] }
  | { ok: false; error: string; code: string };

export interface Citation {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  page: number | null;
  snippet: string;
  score: number;
}

export interface RiskAssessment {
  level: RiskLevel;
  requiresApproval: boolean;
  reasons: string[];
}

/** Metadata persisted on assistant messages (Message.metadata). */
export interface AssistantMessageMetadata {
  citations?: Citation[];
  provider?: string;
  model?: string;
  latencyMs?: number;
  usedKnowledge?: boolean;
  escalated?: boolean;
  awaitingApprovalId?: string;
  error?: string;
}

export interface AgentTurnResult {
  conversationId: string;
  assistantMessageId: string;
  status: "completed" | "awaiting_approval" | "failed";
  content: string;
  citations: Citation[];
  toolCallIds: string[];
  awaitingApprovalId?: string;
  escalated: boolean;
  latencyMs: number;
}
