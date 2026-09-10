import type { Prisma } from "@/generated/prisma/client";
import type {
  ActorType,
  ApprovalStatus,
  RiskLevel,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

export interface AuditEntry {
  action: string;
  actorType: ActorType;
  userId?: string | null;
  conversationId?: string | null;
  toolCallId?: string | null;
  tool?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  input?: unknown;
  output?: unknown;
  success?: boolean;
  riskLevel?: RiskLevel;
  approvalStatus?: ApprovalStatus | null;
  errorMessage?: string | null;
  durationMs?: number | null;
}

/** Values that must never be persisted into the audit trail. */
const REDACTED_KEYS = ["password", "passwordhash", "token", "secret", "apikey", "authorization"];

export function redact(value: unknown, depth = 0): Prisma.InputJsonValue {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return null as unknown as Prisma.InputJsonValue;
  if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.includes(key.toLowerCase()) ? "[redacted]" : redact(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Writes an immutable audit record. Audit failures must never break the
 * operation being audited, so this swallows and logs errors instead.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorType: entry.actorType,
        userId: entry.userId ?? null,
        conversationId: entry.conversationId ?? null,
        toolCallId: entry.toolCallId ?? null,
        tool: entry.tool ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        input: entry.input === undefined ? undefined : redact(entry.input),
        output: entry.output === undefined ? undefined : redact(entry.output),
        success: entry.success ?? true,
        riskLevel: entry.riskLevel ?? "LOW",
        approvalStatus: entry.approvalStatus ?? null,
        errorMessage: entry.errorMessage ?? null,
        durationMs: entry.durationMs ?? null,
      },
    });
  } catch (error) {
    logger.error("audit.write_failed", {
      action: entry.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface AuditFilters {
  userId?: string;
  tool?: string;
  action?: string;
  success?: boolean;
  riskLevel?: RiskLevel;
  actorType?: ActorType;
  from?: Date;
  to?: Date;
  search?: string;
  limit?: number;
  cursor?: string;
}

export async function listAuditLogs(filters: AuditFilters) {
  const limit = Math.min(filters.limit ?? 25, 100);
  const where: Prisma.AuditLogWhereInput = {
    userId: filters.userId,
    tool: filters.tool,
    action: filters.action,
    success: filters.success,
    riskLevel: filters.riskLevel,
    actorType: filters.actorType,
    createdAt:
      filters.from || filters.to
        ? { gte: filters.from ?? undefined, lte: filters.to ?? undefined }
        : undefined,
    OR: filters.search
      ? [
          { action: { contains: filters.search, mode: "insensitive" } },
          { tool: { contains: filters.search, mode: "insensitive" } },
          { entityId: { contains: filters.search, mode: "insensitive" } },
        ]
      : undefined,
  };

  const rows = await prisma.auditLog.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    nextCursor: hasMore ? rows[limit - 1]!.id : null,
  };
}

export async function auditFilterOptions() {
  const [tools, actions, users] = await Promise.all([
    prisma.auditLog.findMany({
      where: { tool: { not: null } },
      distinct: ["tool"],
      select: { tool: true },
      orderBy: { tool: "asc" },
    }),
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    tools: tools.map((row) => row.tool!).filter(Boolean),
    actions: actions.map((row) => row.action),
    users,
  };
}
