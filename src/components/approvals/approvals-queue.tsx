"use client";

import { Check, Loader2, MessageSquare, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { RiskBadge, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { api } from "@/trpc/client";

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export function ApprovalsQueue() {
  const utils = api.useUtils();
  const [status, setStatus] = useState<StatusFilter>("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);

  const approvals = api.approval.list.useQuery({ status, limit: 50 });

  const decide = api.approval.decide.useMutation({
    onSuccess: async (result) => {
      toast.success(
        result.status === "APPROVED"
          ? "Approved — the agent executed the action."
          : "Rejected — nothing was changed.",
      );
      setBusyId(null);
      await utils.approval.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
      setBusyId(null);
    },
  });

  return (
    <div className="space-y-4">
      <Tabs value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="PENDING">Pending</TabsTrigger>
          <TabsTrigger value="APPROVED">Approved</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
          <TabsTrigger value="EXPIRED">Expired</TabsTrigger>
        </TabsList>
      </Tabs>

      {approvals.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-32 w-full" />
          ))}
        </div>
      ) : approvals.error ? (
        <ErrorState message={approvals.error.message} onRetry={() => approvals.refetch()} />
      ) : approvals.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title={status === "PENDING" ? "Nothing waiting on a human" : "No approvals here"}
            description={
              status === "PENDING"
                ? "High-risk agent actions will appear here for confirmation."
                : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {approvals.data.map((approval) => (
            <Card key={approval.id}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
                    {approval.toolName}
                  </code>
                  <RiskBadge level={approval.riskLevel} />
                  <StatusBadge status={approval.status} />
                  <span className="ml-auto text-[12px] text-muted-foreground">
                    Requested by {approval.requestedBy.name} · {relativeTime(approval.createdAt)}
                  </span>
                </div>

                <p className="text-[14px] font-medium">{approval.summary}</p>

                <pre className="max-h-40 overflow-auto rounded-lg border bg-surface-muted p-2.5 font-mono text-[11px]">
                  {JSON.stringify(approval.args, null, 2)}
                </pre>

                {approval.status === "PENDING" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      disabled={!approval.canDecide || decide.isPending}
                      onClick={() => {
                        setBusyId(approval.id);
                        decide.mutate({ id: approval.id, approve: true });
                      }}
                    >
                      {busyId === approval.id && decide.isPending ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Check />
                      )}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!approval.canDecide || decide.isPending}
                      onClick={() => {
                        setBusyId(approval.id);
                        decide.mutate({ id: approval.id, approve: false });
                      }}
                    >
                      <X /> Reject
                    </Button>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/agent?c=${approval.conversationId}`}>
                        <MessageSquare /> Open conversation
                      </Link>
                    </Button>
                    {!approval.canDecide ? (
                      <span className="text-[12px] text-muted-foreground">
                        Your role cannot decide this action.
                      </span>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">
                        Expires {formatDateTime(approval.expiresAt)}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                    <span>
                      Decided by {approval.decidedBy?.name ?? "—"} ·{" "}
                      {approval.decidedAt ? formatDateTime(approval.decidedAt) : "—"}
                    </span>
                    {approval.decisionNote ? <span>· “{approval.decisionNote}”</span> : null}
                    <Button asChild size="sm" variant="ghost" className="ml-auto">
                      <Link href={`/agent?c=${approval.conversationId}`}>
                        <MessageSquare /> Open conversation
                      </Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
