import { ArrowLeft, Bot, Sparkles, User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TicketControls } from "@/components/tickets/ticket-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { formatDateTime } from "@/lib/utils";
import { createServerCaller } from "@/server/api/root";

export const metadata: Metadata = { title: "Ticket" };
export const dynamic = "force-dynamic";

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await createServerCaller();
  const session = await auth();

  const ticket = await caller.ticket.detail({ id }).catch(() => null);
  if (!ticket) notFound();

  const canWrite = session?.user ? hasPermission(session.user.role, "ticket:write") : false;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/tickets">
          <ArrowLeft /> All tickets
        </Link>
      </Button>

      <PageHeader
        title={ticket.subject}
        description={`${ticket.reference} · opened ${formatDateTime(ticket.createdAt)}`}
        actions={
          <>
            <Badge variant={ticket.createdBy === "AGENT" ? "default" : "neutral"}>
              {ticket.createdBy === "AGENT" ? <Bot /> : <User />}
              {ticket.createdBy === "AGENT" ? "Created by agent" : "Created by operator"}
            </Badge>
            <Button asChild size="sm" variant="outline">
              <Link
                href={`/agent?q=${encodeURIComponent(`Show me ticket ${ticket.reference}`)}`}
              >
                <Sparkles /> Ask the agent
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] whitespace-pre-wrap">{ticket.description}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Customer</span>
              <Link href={`/customers/${ticket.customer.id}`} className="hover:underline">
                {ticket.customer.name}
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Order</span>
              {ticket.order ? (
                <Link href={`/orders/${ticket.order.id}`} className="hover:underline">
                  {ticket.order.reference}
                </Link>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Category</span>
              <Badge variant="neutral">{ticket.category}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge status={ticket.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Priority</span>
              <StatusBadge status={ticket.priority} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Resolved</span>
              <span>{ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : "—"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Triage</CardTitle>
          <CardDescription>
            {canWrite
              ? "Every change here is written to the audit log."
              : "Your role has read-only access to tickets."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TicketControls
            ticketId={ticket.id}
            status={ticket.status}
            priority={ticket.priority}
            assignedToId={ticket.assignedToId}
            canWrite={canWrite}
          />
        </CardContent>
      </Card>
    </div>
  );
}
