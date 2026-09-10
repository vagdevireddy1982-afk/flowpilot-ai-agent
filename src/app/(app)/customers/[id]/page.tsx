import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Mail,
  Phone,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerNotesEditor } from "@/components/customers/customer-notes-editor";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils";
import { createServerCaller } from "@/server/api/root";

export const metadata: Metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const caller = await createServerCaller();
  const session = await auth();

  const detail = await caller.customer.detail({ id }).catch(() => null);
  if (!detail) notFound();

  const summary = await caller.customer.summary({ id });
  const { customer, orders, tickets, emails, escalations } = detail;
  const canWrite = session?.user ? hasPermission(session.user.role, "customer:write") : false;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/customers">
          <ArrowLeft /> All customers
        </Link>
      </Button>

      <PageHeader
        title={customer.name}
        description={`${customer.reference} · joined ${formatDate(customer.createdAt)}`}
        actions={
          <>
            <StatusBadge status={customer.status} />
            <Button asChild size="sm" variant="outline">
              <Link href={`/agent?q=${encodeURIComponent(`Show me ${customer.name}'s orders`)}`}>
                <Sparkles /> Ask the agent
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Account summary</CardTitle>
            <CardDescription>
              Generated from this customer&apos;s live records — no model call, so it is always
              accurate.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5">
              {summary.highlights.map((highlight) => (
                <li key={highlight} className="flex gap-2 text-[13px]">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" />
                  {highlight}
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4">
              <Metric label="Orders" value={String(summary.orderCount)} />
              <Metric label="Open tickets" value={String(summary.openTicketCount)} />
              <Metric label="Delayed" value={String(summary.delayedOrderCount)} />
              <Metric
                label="Lifetime value"
                value={formatMoney(summary.lifetimeValueMinor, summary.currency)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-[13px]">
            <p className="flex items-center gap-2">
              <Mail className="size-3.5 text-muted-foreground" />
              <a className="hover:underline" href={`mailto:${customer.email}`}>
                {customer.email}
              </a>
            </p>
            <p className="flex items-center gap-2">
              <Phone className="size-3.5 text-muted-foreground" />
              {customer.phone ?? "No phone on file"}
            </p>
            <p className="flex items-center gap-2">
              <Building2 className="size-3.5 text-muted-foreground" />
              {customer.company ?? "No company on file"}
            </p>
            <p className="flex items-center gap-2">
              <CalendarDays className="size-3.5 text-muted-foreground" />
              Last contacted {formatDate(customer.lastContactedAt)}
            </p>
          </CardContent>
        </Card>
      </div>

      <CustomerNotesEditor
        customerId={customer.id}
        notes={customer.notes ?? ""}
        canWrite={canWrite}
      />

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Orders ({orders.length})</TabsTrigger>
          <TabsTrigger value="tickets">Tickets ({tickets.length})</TabsTrigger>
          <TabsTrigger value="emails">Email ({emails.length})</TabsTrigger>
          <TabsTrigger value="escalations">Escalations ({escalations.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <Card className="overflow-hidden">
            {orders.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No orders yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Placed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Link href={`/orders/${order.id}`} className="font-medium hover:underline">
                          {order.reference}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-muted-foreground">
                        {order.items.map((item) => item.name).join(", ")}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatMoney(order.totalAmountMinor, order.currency)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.deliveryStatus} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(order.placedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="tickets">
          <Card className="overflow-hidden">
            {tickets.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No support tickets" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell>
                        <Link
                          href={`/tickets/${ticket.id}`}
                          className="font-medium hover:underline"
                        >
                          {ticket.reference}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate">{ticket.subject}</TableCell>
                      <TableCell>
                        <StatusBadge status={ticket.status} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={ticket.priority} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {ticket.assignedTo?.name ?? "Unassigned"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(ticket.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="emails">
          <Card>
            <CardContent className="space-y-3 pt-5">
              {emails.length === 0 ? (
                <EmptyState icon={Mail} title="No email sent to this customer" />
              ) : (
                emails.map((email) => (
                  <div key={email.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">{email.subject}</span>
                      <StatusBadge status={email.status} />
                      <span className="ml-auto text-[12px] text-muted-foreground">
                        {email.actorType === "AGENT" ? "Sent by agent" : "Sent by operator"} ·{" "}
                        {formatDateTime(email.sentAt ?? email.createdAt)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-[13px] whitespace-pre-wrap text-muted-foreground">
                      {email.body}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="escalations">
          <Card>
            <CardContent className="space-y-3 pt-5">
              {escalations.length === 0 ? (
                <EmptyState icon={TriangleAlert} title="No escalations for this customer" />
              ) : (
                escalations.map((escalation) => (
                  <div key={escalation.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">{escalation.reason}</span>
                      <StatusBadge status={escalation.status} />
                      <span className="ml-auto text-[12px] text-muted-foreground">
                        {formatDateTime(escalation.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] text-muted-foreground">{escalation.summary}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
