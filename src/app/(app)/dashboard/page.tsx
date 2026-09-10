import {
  ArrowUpRight,
  Bot,
  Clock,
  LifeBuoy,
  Package,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ActionsOverTimeChart,
  HumanVsAiChart,
  TicketCategoryChart,
} from "@/components/dashboard/charts";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createServerCaller } from "@/server/api/root";
import { initials, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const caller = await createServerCaller();
  const { summary, actions, humanVsAi, categories } = await caller.analytics.dashboard();

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Operations overview"
        description="Live figures from the operational database — customers, orders, tickets and everything the agent has done."
        actions={
          <Button asChild size="sm">
            <Link href="/agent">
              <Bot /> Open agent
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Customers" value={summary.customers} icon={Users} href="/customers" />
        <StatCard
          label="Open orders"
          value={summary.openOrders}
          hint={`${summary.delayedOrders} running late`}
          icon={Package}
          href="/orders"
          tone={summary.delayedOrders > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Open tickets"
          value={summary.openTickets}
          icon={LifeBuoy}
          href="/tickets"
        />
        <StatCard
          label="Pending approvals"
          value={summary.pendingApprovals}
          hint="High-risk actions waiting on a human"
          icon={ShieldCheck}
          href="/approvals"
          tone={summary.pendingApprovals > 0 ? "warning" : "success"}
        />
        <StatCard
          label="AI actions"
          value={summary.agentActions}
          hint="Tool calls executed by the agent"
          icon={Bot}
          href="/activity"
        />
        <StatCard
          label="Human escalations"
          value={summary.escalations}
          icon={TriangleAlert}
          href="/activity?tab=escalations"
          tone={summary.escalations > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Agent runs (30d)"
          value={summary.agentRuns30d}
          icon={Bot}
          href="/analytics"
        />
        <StatCard
          label="Avg response time"
          value={summary.avgLatencyMs > 0 ? `${summary.avgLatencyMs} ms` : "—"}
          hint="Mean agent turn latency, last 30 days"
          icon={Clock}
          href="/analytics"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>AI actions over time</CardTitle>
            <CardDescription>Tool executions per day across the last 14 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionsOverTimeChart data={actions} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ticket categories</CardTitle>
            <CardDescription>Where support demand is concentrated.</CardDescription>
          </CardHeader>
          <CardContent>
            {categories.length > 0 ? (
              <TicketCategoryChart data={categories} />
            ) : (
              <EmptyState icon={LifeBuoy} title="No tickets yet" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Human vs AI</CardTitle>
            <CardDescription>Who created the work item.</CardDescription>
          </CardHeader>
          <CardContent>
            <HumanVsAiChart data={humanVsAi} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent agent activity</CardTitle>
              <CardDescription>Every tool call is written to the audit log.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/activity">
                View all <ArrowUpRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {summary.recentActivity.length === 0 ? (
              <EmptyState icon={Bot} title="No activity recorded yet" />
            ) : (
              summary.recentActivity.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60"
                >
                  <Badge variant={entry.success ? "neutral" : "destructive"} className="shrink-0">
                    {entry.actorType}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                    {entry.action}
                    {entry.entityId ? (
                      <span className="text-muted-foreground"> · {entry.entityId.slice(0, 12)}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {entry.user?.name ?? "System"} · {relativeTime(entry.createdAt)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Recent conversations</CardTitle>
            <CardDescription>The latest agent sessions across the team.</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/agent">
              Open agent <ArrowUpRight />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {summary.recentConversations.length === 0 ? (
            <EmptyState
              className="sm:col-span-2 lg:col-span-3"
              icon={Bot}
              title="No conversations yet"
              description="Start one from the AI Agent page."
            />
          ) : (
            summary.recentConversations.map((conversation) => (
              <div key={conversation.id} className="rounded-lg border p-3">
                <p className="line-clamp-2 text-[13px] font-medium">{conversation.title}</p>
                <div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Avatar className="size-5">
                    <AvatarFallback className="text-[9px]">
                      {initials(conversation.user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{conversation.user.name}</span>
                  <span className="ml-auto shrink-0">
                    {conversation._count.messages} msgs · {relativeTime(conversation.updatedAt)}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
