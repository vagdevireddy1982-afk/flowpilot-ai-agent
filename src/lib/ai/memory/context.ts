import type { ChatMessage } from "@/lib/ai/provider";
import { estimateTokens } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";

export interface ContextBudget {
  /** Number of recent turns replayed verbatim. */
  maxMessages: number;
  /** Hard ceiling on replayed characters, oldest dropped first. */
  maxChars: number;
}

export const DEFAULT_BUDGET: ContextBudget = { maxMessages: 12, maxChars: 12_000 };

export interface ConversationContext {
  messages: ChatMessage[];
  /** Non-null when older turns were compacted into a recap. */
  recap: string | null;
  droppedMessages: number;
  estimatedTokens: number;
}

const ENTITY_PATTERN = /\b(ORD|TKT|CUST|REF)-\d{3,6}\b/gi;

/**
 * Builds the replayed conversation window.
 *
 * Only USER and ASSISTANT turns are replayed. Tool call/result pairs are
 * deliberately left out of history: they are large, they are already
 * summarised in the assistant's answer, and replaying a partial pair would
 * produce an invalid message sequence for OpenAI-style APIs. The live turn
 * still gets its own tool messages in full.
 */
export async function buildConversationContext(
  conversationId: string,
  budget: ContextBudget = DEFAULT_BUDGET,
): Promise<ConversationContext> {
  const rows = await prisma.message.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  const recent: typeof rows = [];
  let chars = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (!row.content.trim()) continue;
    if (recent.length >= budget.maxMessages || chars + row.content.length > budget.maxChars) break;
    chars += row.content.length;
    recent.unshift(row);
  }

  const dropped = rows.length - recent.length;
  const recap = dropped > 0 ? buildRecap(rows.slice(0, dropped)) : null;

  const messages: ChatMessage[] = [];
  if (recap) messages.push({ role: "system", content: recap });
  for (const row of recent) {
    messages.push({
      role: row.role === "USER" ? "user" : "assistant",
      content: row.content,
    });
  }

  return {
    messages,
    recap,
    droppedMessages: dropped,
    estimatedTokens: messages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
  };
}

/**
 * Deterministic recap of the turns that fell outside the window: the opening
 * request plus every business reference mentioned. No extra LLM call, so it
 * costs nothing and cannot drift from what was actually said.
 */
export function buildRecap(older: Array<{ role: string; content: string }>): string {
  const firstUser = older.find((message) => message.role === "USER")?.content ?? "";
  const entities = new Set<string>();
  for (const message of older) {
    for (const match of message.content.matchAll(ENTITY_PATTERN)) {
      entities.add(match[0].toUpperCase());
    }
  }

  const lines = [
    `Earlier in this conversation (${older.length} older message(s), summarised to save context):`,
    firstUser ? `- The user's opening request was: "${firstUser.slice(0, 300)}"` : null,
    entities.size > 0 ? `- Records already discussed: ${[...entities].join(", ")}` : null,
    "- Ask the user to restate details if you need anything from before this point.",
  ].filter(Boolean);

  return lines.join("\n");
}
