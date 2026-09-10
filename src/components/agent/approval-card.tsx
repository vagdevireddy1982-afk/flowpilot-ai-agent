"use client";

import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RiskBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/trpc/client";

export interface ApprovalCardData {
  id: string;
  toolName: string;
  summary: string;
  riskLevel: string;
  status: string;
  canDecide: boolean;
  decisionNote: string | null;
  decidedByName: string | null;
}

/**
 * The human-in-the-loop control. Rendered under the assistant message that
 * proposed a high-risk action; the action only runs when Approve is pressed.
 */
export function ApprovalCard({
  approval,
  onDecided,
}: {
  approval: ApprovalCardData;
  onDecided: () => void;
}) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);

  const decide = api.approval.decide.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.status === "APPROVED"
          ? "Approved — the agent executed the action."
          : "Rejected — nothing was changed.",
      );
      setPending(null);
      onDecided();
    },
    onError: (error) => {
      toast.error(error.message);
      setPending(null);
    },
  });

  if (approval.status !== "PENDING") {
    const approved = approval.status === "APPROVED";
    return (
      <div
        className={`mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${
          approved ? "border-success/40 bg-success/10" : "border-border bg-muted/60"
        }`}
      >
        {approved ? (
          <Check className="size-3.5 text-success" />
        ) : (
          <X className="size-3.5 text-muted-foreground" />
        )}
        <span className="font-medium">
          {approved ? "Approved" : approval.status === "REJECTED" ? "Rejected" : "Expired"}
        </span>
        {approval.decidedByName ? (
          <span className="text-muted-foreground">by {approval.decidedByName}</span>
        ) : null}
        {approval.decisionNote ? (
          <span className="text-muted-foreground">· {approval.decisionNote}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-warning/40 bg-warning/8 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert className="size-4 text-warning" />
        <span className="text-[13px] font-medium">Approval required</span>
        <RiskBadge level={approval.riskLevel} />
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
          {approval.toolName}
        </code>
      </div>

      {approval.canDecide ? (
        <>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note for the audit trail…"
            className="mt-3 h-8 text-[13px]"
          />
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="success"
              disabled={decide.isPending}
              onClick={() => {
                setPending("approve");
                decide.mutate({ id: approval.id, approve: true, note: note || undefined });
              }}
            >
              {pending === "approve" ? <Loader2 className="animate-spin" /> : <Check />}
              Approve and run
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decide.isPending}
              onClick={() => {
                setPending("reject");
                decide.mutate({ id: approval.id, approve: false, note: note || undefined });
              }}
            >
              {pending === "reject" ? <Loader2 className="animate-spin" /> : <X />}
              Reject
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Your role cannot approve this action. An administrator can decide it from the Approvals
          queue.
        </p>
      )}
    </div>
  );
}
