import { prisma } from "@/lib/db/prisma";
import { OPEN_TICKET_STATUSES } from "@/server/services/ticket-service";

function daysAgo(days: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Fills gaps so a chart never renders a misleading sparse series. */
function emptySeries(days: number): Map<string, { date: string; total: number; success: number; failed: number }> {
  const series = new Map<string, { date: string; total: number; success: number; failed: number }>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = daysAgo(i);
    series.set(dayKey(date), { date: dayKey(date), total: 0, success: 0, failed: 0 });
  }
  return series;
}

export async function getDashboardSummary() {
  const since = daysAgo(30);

  const [
    customers,
    openOrders,
    openTickets,
    pendingApprovals,
    agentActions,
    escalations,
    recentAudit,
    recentConversations,
    delayedOrders,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.order.count({ where: { status: { in: ["PENDING", "PROCESSING", "SHIPPED"] } } }),
    prisma.supportTicket.count({ where: { status: { in: OPEN_TICKET_STATUSES } } }),
    prisma.approval.count({ where: { status: "PENDING" } }),
    prisma.toolCall.count({ where: { status: { in: ["SUCCESS", "FAILED"] } } }),
    prisma.escalation.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { user: { select: { id: true, name: true, avatarColor: true } } },
    }),
    prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        user: { select: { name: true, avatarColor: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.order.count({
      where: { deliveryStatus: "DELAYED", status: { notIn: ["CANCELLED", "REFUNDED"] } },
    }),
  ]);

  const runsLast30 = await prisma.agentRun.findMany({
    where: { createdAt: { gte: since } },
    select: { latencyMs: true, status: true, escalated: true },
  });

  const avgLatency =
    runsLast30.length > 0
      ? Math.round(runsLast30.reduce((sum, run) => sum + run.latencyMs, 0) / runsLast30.length)
      : 0;

  return {
    customers,
    openOrders,
    openTickets,
    pendingApprovals,
    agentActions,
    escalations,
    delayedOrders,
    avgLatencyMs: avgLatency,
    agentRuns30d: runsLast30.length,
    recentActivity: recentAudit,
    recentConversations,
  };
}

export async function getActionsOverTime(days = 14) {
  const since = daysAgo(days - 1);
  const rows = await prisma.toolCall.findMany({
    where: { createdAt: { gte: since }, status: { in: ["SUCCESS", "FAILED"] } },
    select: { createdAt: true, status: true },
  });

  const series = emptySeries(days);
  for (const row of rows) {
    const key = dayKey(row.createdAt);
    const bucket = series.get(key);
    if (!bucket) continue;
    bucket.total += 1;
    if (row.status === "SUCCESS") bucket.success += 1;
    else bucket.failed += 1;
  }
  return [...series.values()];
}

export async function getHumanVsAiResolution() {
  const [aiTickets, humanTickets, aiEmails, humanEmails] = await Promise.all([
    prisma.supportTicket.count({ where: { createdBy: "AGENT" } }),
    prisma.supportTicket.count({ where: { createdBy: { in: ["USER", "SYSTEM"] } } }),
    prisma.email.count({ where: { actorType: "AGENT" } }),
    prisma.email.count({ where: { actorType: { in: ["USER", "SYSTEM"] } } }),
  ]);

  return [
    { channel: "Tickets", ai: aiTickets, human: humanTickets },
    { channel: "Emails", ai: aiEmails, human: humanEmails },
  ];
}

export async function getTicketCategories() {
  const grouped = await prisma.supportTicket.groupBy({
    by: ["category"],
    _count: { _all: true },
    orderBy: { _count: { category: "desc" } },
  });
  return grouped.map((row) => ({ category: row.category, count: row._count._all }));
}

export async function getToolUsage(limit = 8) {
  const grouped = await prisma.toolCall.groupBy({
    by: ["name", "status"],
    _count: { _all: true },
  });

  const byTool = new Map<string, { tool: string; success: number; failed: number; other: number }>();
  for (const row of grouped) {
    const entry = byTool.get(row.name) ?? { tool: row.name, success: 0, failed: 0, other: 0 };
    if (row.status === "SUCCESS") entry.success += row._count._all;
    else if (row.status === "FAILED") entry.failed += row._count._all;
    else entry.other += row._count._all;
    byTool.set(row.name, entry);
  }

  return [...byTool.values()]
    .sort((a, b) => b.success + b.failed - (a.success + a.failed))
    .slice(0, limit);
}

export async function getAgentPerformance(days = 30) {
  const since = daysAgo(days - 1);
  const [runs, toolCalls, approvals, escalations] = await Promise.all([
    prisma.agentRun.findMany({
      where: { createdAt: { gte: since } },
      select: {
        latencyMs: true,
        status: true,
        promptTokens: true,
        completionTokens: true,
        costUsdMicros: true,
        usedKnowledge: true,
        createdAt: true,
      },
    }),
    prisma.toolCall.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.approval.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.escalation.count({ where: { createdAt: { gte: since } } }),
  ]);

  const countFor = (
    rows: Array<{ status: string; _count: { _all: number } }>,
    status: string,
  ): number => rows.find((row) => row.status === status)?._count._all ?? 0;

  const successful = countFor(toolCalls, "SUCCESS");
  const failed = countFor(toolCalls, "FAILED");
  const rejected = countFor(toolCalls, "REJECTED");
  const awaiting = countFor(toolCalls, "AWAITING_APPROVAL");

  const approved = countFor(approvals, "APPROVED");
  const approvalRejected = countFor(approvals, "REJECTED");
  const approvalPending = countFor(approvals, "PENDING");
  const decided = approved + approvalRejected;

  const latencies = runs.map((run) => run.latencyMs).sort((a, b) => a - b);
  const p95 =
    latencies.length > 0
      ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]!
      : 0;

  const totalTokens = runs.reduce(
    (sum, run) => sum + run.promptTokens + run.completionTokens,
    0,
  );
  const costUsd = runs.reduce((sum, run) => sum + run.costUsdMicros, 0) / 1_000_000;

  return {
    totalRequests: runs.length,
    successfulActions: successful,
    failedActions: failed,
    rejectedActions: rejected,
    awaitingApproval: awaiting,
    escalations,
    approvalRate: decided > 0 ? approved / decided : 0,
    approvalPending,
    avgLatencyMs:
      runs.length > 0 ? Math.round(runs.reduce((sum, run) => sum + run.latencyMs, 0) / runs.length) : 0,
    p95LatencyMs: p95,
    knowledgeGroundedRate:
      runs.length > 0 ? runs.filter((run) => run.usedKnowledge).length / runs.length : 0,
    totalTokens,
    estimatedCostUsd: Number(costUsd.toFixed(4)),
  };
}

export async function getLatencyTrend(days = 14) {
  const since = daysAgo(days - 1);
  const runs = await prisma.agentRun.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, latencyMs: true },
  });

  const buckets = new Map<string, { date: string; total: number; count: number }>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dayKey(daysAgo(i));
    buckets.set(key, { date: key, total: 0, count: 0 });
  }
  for (const run of runs) {
    const bucket = buckets.get(dayKey(run.createdAt));
    if (!bucket) continue;
    bucket.total += run.latencyMs;
    bucket.count += 1;
  }

  return [...buckets.values()].map((bucket) => ({
    date: bucket.date,
    avgLatencyMs: bucket.count > 0 ? Math.round(bucket.total / bucket.count) : 0,
  }));
}
