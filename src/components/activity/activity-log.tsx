"use client";

import { Activity, Bot, ChevronDown, Mail, TriangleAlert, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { DataToolbar } from "@/components/shared/data-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { RiskBadge, StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { api } from "@/trpc/client";

const ALL = "__all__";

export function ActivityLog({ defaultTab = "audit" }: { defaultTab?: string }) {
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="audit">
          <Activity /> Audit trail
        </TabsTrigger>
        <TabsTrigger value="emails">
          <Mail /> Sent email
        </TabsTrigger>
        <TabsTrigger value="escalations">
          <TriangleAlert /> Escalations
        </TabsTrigger>
      </TabsList>

      <TabsContent value="audit">
        <AuditTab />
      </TabsContent>
      <TabsContent value="emails">
        <EmailTab />
      </TabsContent>
      <TabsContent value="escalations">
        <EscalationTab />
      </TabsContent>
    </Tabs>
  );
}

function AuditTab() {
  const [search, setSearch] = useState("");
  const [tool, setTool] = useState("");
  const [risk, setRisk] = useState("");
  const [actor, setActor] = useState("");
  const [outcome, setOutcome] = useState("");
  const [userId, setUserId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 250);

  const options = api.activity.filterOptions.useQuery();
  const logs = api.activity.logs.useQuery({
    search: debouncedSearch || undefined,
    tool: tool || undefined,
    riskLevel: (risk || undefined) as "LOW" | "MEDIUM" | "HIGH" | undefined,
    actorType: (actor || undefined) as "USER" | "AGENT" | "SYSTEM" | undefined,
    success: outcome === "" ? undefined : outcome === "success",
    userId: userId || undefined,
    limit: 50,
  });

  return (
    <div className="space-y-4">
      <DataToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by action, tool or record id…"
        filters={[
          {
            key: "tool",
            label: "Tool",
            value: tool,
            options: options.data?.tools ?? [],
            onChange: setTool,
          },
          {
            key: "risk",
            label: "Risk",
            value: risk,
            options: ["LOW", "MEDIUM", "HIGH"],
            onChange: setRisk,
          },
          {
            key: "actor",
            label: "Actor",
            value: actor,
            options: ["USER", "AGENT", "SYSTEM"],
            onChange: setActor,
          },
        ]}
      >
        <Select
          value={outcome === "" ? ALL : outcome}
          onValueChange={(value) => setOutcome(value === ALL ? "" : value)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Outcome" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any outcome</SelectItem>
            <SelectItem value="success">Succeeded</SelectItem>
            <SelectItem value="failure">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={userId === "" ? ALL : userId}
          onValueChange={(value) => setUserId(value === ALL ? "" : value)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="User" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All users</SelectItem>
            {(options.data?.users ?? []).map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DataToolbar>

      <Card>
        <CardContent className="p-0">
          {logs.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : logs.error ? (
            <ErrorState message={logs.error.message} onRetry={() => logs.refetch()} />
          ) : logs.data.items.length === 0 ? (
            <EmptyState icon={Activity} title="No audit entries match those filters" />
          ) : (
            <ul className="divide-y">
              {logs.data.items.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50"
                    onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  >
                    <Badge variant={entry.actorType === "AGENT" ? "default" : "neutral"}>
                      {entry.actorType === "AGENT" ? <Bot /> : <User />}
                      {entry.actorType}
                    </Badge>
                    <code className="font-mono text-[12px]">{entry.action}</code>
                    {entry.entityId ? (
                      <span className="text-[12px] text-muted-foreground">
                        {entry.entityType} {entry.entityId.slice(0, 10)}
                      </span>
                    ) : null}
                    <RiskBadge level={entry.riskLevel} />
                    {entry.approvalStatus ? <StatusBadge status={entry.approvalStatus} /> : null}
                    <Badge variant={entry.success ? "success" : "destructive"}>
                      {entry.success ? "Success" : "Failed"}
                    </Badge>
                    <span className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
                      {entry.user?.name ?? "System"} · {relativeTime(entry.createdAt)}
                      <ChevronDown
                        className={`size-3.5 transition-transform ${expanded === entry.id ? "rotate-180" : ""}`}
                      />
                    </span>
                  </button>

                  {expanded === entry.id ? (
                    <div className="grid gap-3 border-t bg-surface-muted/50 p-3 sm:grid-cols-2">
                      <Detail label="Input" value={entry.input} />
                      <Detail label="Output" value={entry.output} />
                      <div className="sm:col-span-2">
                        <p className="text-[12px] text-muted-foreground">
                          {formatDateTime(entry.createdAt)}
                          {entry.durationMs !== null ? ` · ${entry.durationMs} ms` : ""}
                          {entry.tool ? ` · tool ${entry.tool}` : ""}
                        </p>
                        {entry.errorMessage ? (
                          <p className="mt-1 text-[12px] text-destructive">{entry.errorMessage}</p>
                        ) : null}
                        {entry.conversationId ? (
                          <Link
                            href={`/agent?c=${entry.conversationId}`}
                            className="mt-1 inline-block text-[12px] text-primary hover:underline"
                          >
                            Open the conversation →
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <pre className="max-h-48 overflow-auto rounded-md border bg-surface p-2 font-mono text-[11px]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function EmailTab() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const emails = api.activity.emails.useQuery({ search: debouncedSearch || undefined, limit: 50 });

  return (
    <div className="space-y-4">
      <DataToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search subject, recipient or body…"
      />
      {emails.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : emails.error ? (
        <ErrorState message={emails.error.message} onRetry={() => emails.refetch()} />
      ) : emails.data.items.length === 0 ? (
        <Card>
          <EmptyState icon={Mail} title="No email sent yet" />
        </Card>
      ) : (
        <div className="space-y-3">
          {emails.data.items.map((email) => (
            <Card key={email.id}>
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium">{email.subject}</span>
                  <StatusBadge status={email.status} />
                  <Badge variant={email.actorType === "AGENT" ? "default" : "neutral"}>
                    {email.actorType === "AGENT" ? <Bot /> : <User />}
                    {email.actorType === "AGENT" ? "Agent" : "Operator"}
                  </Badge>
                  <span className="ml-auto text-[12px] text-muted-foreground">
                    {formatDateTime(email.sentAt ?? email.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  To {email.toEmail}
                  {email.customer ? ` (${email.customer.name})` : ""} · from {email.fromEmail} · via{" "}
                  {email.provider}
                </p>
                <p className="mt-2 rounded-lg border bg-surface-muted p-3 text-[13px] whitespace-pre-wrap">
                  {email.body}
                </p>
                {email.error ? (
                  <p className="mt-2 text-[12px] text-destructive">{email.error}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function EscalationTab() {
  const utils = api.useUtils();
  const escalations = api.activity.escalations.useQuery({});

  const update = api.activity.updateEscalation.useMutation({
    onSuccess: async () => {
      toast.success("Escalation updated");
      await utils.activity.escalations.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (escalations.isPending) return <Skeleton className="h-40 w-full" />;
  if (escalations.error) {
    return <ErrorState message={escalations.error.message} onRetry={() => escalations.refetch()} />;
  }
  if (escalations.data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={TriangleAlert}
          title="No escalations"
          description="The agent hands a conversation over here when it should not proceed alone."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {escalations.data.map((escalation) => (
        <Card key={escalation.id}>
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-medium">{escalation.reason}</span>
              <StatusBadge status={escalation.status} />
              <span className="ml-auto text-[12px] text-muted-foreground">
                {relativeTime(escalation.createdAt)}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] text-muted-foreground">{escalation.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {escalation.conversation ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/agent?c=${escalation.conversation.id}`}>Open conversation</Link>
                </Button>
              ) : null}
              {escalation.customer ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/customers/${escalation.customer.id}`}>
                    {escalation.customer.name}
                  </Link>
                </Button>
              ) : null}
              {escalation.status !== "RESOLVED" ? (
                <>
                  {escalation.status === "OPEN" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({ id: escalation.id, status: "ACKNOWLEDGED" })
                      }
                    >
                      Acknowledge
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: escalation.id, status: "RESOLVED" })}
                  >
                    Mark resolved
                  </Button>
                </>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
