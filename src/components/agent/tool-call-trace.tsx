"use client";

import { AlertCircle, Check, ChevronRight, Clock, Loader2, Wrench } from "lucide-react";
import { useState } from "react";
import { RiskBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import type { ConversationToolCallView } from "@/server/services/conversation-service";

/**
 * Collapsed record of what the agent actually ran between two messages —
 * the tool, its validated arguments and the structured result.
 */
export function ToolCallTrace({ calls }: { calls: ConversationToolCallView[] }) {
  if (calls.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {calls.map((call) => (
        <ToolCallRow key={call.id} call={call} />
      ))}
    </div>
  );
}

function ToolCallRow({ call }: { call: ConversationToolCallView }) {
  const [open, setOpen] = useState(false);

  const icon =
    call.status === "SUCCESS" ? (
      <Check className="size-3.5 text-success" />
    ) : call.status === "FAILED" ? (
      <AlertCircle className="size-3.5 text-destructive" />
    ) : call.status === "AWAITING_APPROVAL" ? (
      <Clock className="size-3.5 text-warning" />
    ) : call.status === "RUNNING" ? (
      <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
    ) : (
      <Wrench className="size-3.5 text-muted-foreground" />
    );

  return (
    <div className="rounded-lg border bg-surface-muted/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        {icon}
        <code className="font-mono text-[12px]">{call.name}</code>
        {call.riskLevel !== "LOW" ? <RiskBadge level={call.riskLevel} /> : null}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {call.durationMs !== null ? `${call.durationMs} ms` : call.status.toLowerCase()}
        </span>
      </button>

      {open ? (
        <div className="space-y-2 border-t px-2.5 py-2">
          <TracePanel label="Arguments (validated)" value={call.args} />
          {call.result ? <TracePanel label="Result" value={call.result} /> : null}
          {call.error ? (
            <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-[12px] text-destructive">
              {call.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TracePanel({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <pre className="max-h-60 overflow-auto rounded-md bg-surface p-2 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
