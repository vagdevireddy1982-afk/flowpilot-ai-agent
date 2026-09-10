import {
  Activity,
  CircleDollarSign,
  Clock,
  ShieldCheck,
  TriangleAlert,
  Wrench,
  XCircle,
} from "lucide-react";
import type { Metadata } from "next";
import {
  ActionsOverTimeChart,
  HumanVsAiChart,
  LatencyTrendChart,
  TicketCategoryChart,
  ToolUsageChart,
} from "@/components/dashboard/charts";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createServerCaller } from "@/server/api/root";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const caller = await createServerCaller();
  const { performance, actions, toolUsage, latency, categories, humanVsAi } =
    await caller.analytics.overview({ days: 30 });

  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Analytics"
        description="Agent performance over the last 30 days, computed from tool calls, approvals and run records."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Agent requests"
          value={performance.totalRequests}
          hint="Turns processed end to end"
          icon={Activity}
        />
        <StatCard
          label="Successful actions"
          value={performance.successfulActions}
          hint={`${performance.rejectedActions} rejected by a human`}
          icon={Wrench}
          tone="success"
        />
        <StatCard
          label="Failed actions"
          value={performance.failedActions}
          hint="Validation, permission or business-rule failures"
          icon={XCircle}
          tone={performance.failedActions > 0 ? "destructive" : "default"}
        />
        <StatCard
          label="Escalations"
          value={performance.escalations}
          hint="Handed to a human specialist"
          icon={TriangleAlert}
          tone={performance.escalations > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Approval rate"
          value={percent(performance.approvalRate)}
          hint={`${performance.approvalPending} still pending`}
          icon={ShieldCheck}
        />
        <StatCard
          label="Avg response"
          value={`${performance.avgLatencyMs} ms`}
          hint={`p95 ${performance.p95LatencyMs} ms`}
          icon={Clock}
        />
        <StatCard
          label="Knowledge-grounded"
          value={percent(performance.knowledgeGroundedRate)}
          hint="Turns that retrieved from the knowledge base"
          icon={Activity}
        />
        <StatCard
          label="Estimated AI cost"
          value={`$${performance.estimatedCostUsd.toFixed(4)}`}
          hint={`${performance.totalTokens.toLocaleString()} tokens`}
          icon={CircleDollarSign}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Actions over time</CardTitle>
            <CardDescription>Successful and failed tool executions per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionsOverTimeChart data={actions} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Average response time</CardTitle>
            <CardDescription>Mean agent turn latency per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <LatencyTrendChart data={latency} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tool usage</CardTitle>
            <CardDescription>Which capabilities the agent actually reaches for.</CardDescription>
          </CardHeader>
          <CardContent>
            {toolUsage.length > 0 ? (
              <ToolUsageChart data={toolUsage} />
            ) : (
              <EmptyState icon={Wrench} title="No tool calls recorded yet" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ticket categories</CardTitle>
            <CardDescription>Support demand by type.</CardDescription>
          </CardHeader>
          <CardContent>
            {categories.length > 0 ? (
              <TicketCategoryChart data={categories} />
            ) : (
              <EmptyState icon={Wrench} title="No tickets yet" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Human vs AI resolution</CardTitle>
          <CardDescription>
            Who created each work item. A healthy deployment shifts routine work to the agent while
            humans keep the judgement calls.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HumanVsAiChart data={humanVsAi} />
        </CardContent>
      </Card>

      <p className="text-[12px] text-muted-foreground">
        Cost is an estimate: token counts are multiplied by a configured blended rate. With the mock
        provider, tokens are estimated from message length rather than a tokenizer.
      </p>
    </div>
  );
}
