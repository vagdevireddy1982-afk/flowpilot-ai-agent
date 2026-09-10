"use client";

import { LifeBuoy, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataToolbar } from "@/components/shared/data-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { TicketCreateDialog } from "@/components/tickets/ticket-create-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { relativeTime } from "@/lib/utils";
import { api } from "@/trpc/client";

const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"] as const;
const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;
const CATEGORIES = ["BILLING", "DELIVERY", "PRODUCT", "ACCOUNT", "OTHER"] as const;

export function TicketsTable({ canWrite }: { canWrite: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 250);

  const tickets = api.ticket.list.useQuery({
    search: debouncedSearch || undefined,
    status: (status || undefined) as (typeof STATUSES)[number] | undefined,
    priority: (priority || undefined) as (typeof PRIORITIES)[number] | undefined,
    category: (category || undefined) as (typeof CATEGORIES)[number] | undefined,
    limit: 50,
  });

  return (
    <div className="space-y-4">
      <DataToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by reference, subject or customer…"
        filters={[
          { key: "status", label: "Status", value: status, options: STATUSES, onChange: setStatus },
          {
            key: "priority",
            label: "Priority",
            value: priority,
            options: PRIORITIES,
            onChange: setPriority,
          },
          {
            key: "category",
            label: "Category",
            value: category,
            options: CATEGORIES,
            onChange: setCategory,
          },
        ]}
      >
        {canWrite ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> New ticket
          </Button>
        ) : null}
      </DataToolbar>

      <Card className="overflow-hidden">
        {tickets.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : tickets.error ? (
          <ErrorState message={tickets.error.message} onRetry={() => tickets.refetch()} />
        ) : tickets.data.items.length === 0 ? (
          <EmptyState
            icon={LifeBuoy}
            title="No tickets match those filters"
            description="Try a different search term or clear the filters."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Opened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.data.items.map((ticket) => (
                <TableRow key={ticket.id}>
                  <TableCell>
                    <Link href={`/tickets/${ticket.id}`} className="block hover:underline">
                      <span className="font-medium">{ticket.reference}</span>
                      <span className="block max-w-[280px] truncate text-[12px] text-muted-foreground">
                        {ticket.subject}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/customers/${ticket.customer.id}`}
                      className="text-muted-foreground hover:underline"
                    >
                      {ticket.customer.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={ticket.status} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={ticket.priority} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral">{ticket.category}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {ticket.assignedTo?.name ?? "Unassigned"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {relativeTime(ticket.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {tickets.data ? (
        <p className="text-[12px] text-muted-foreground">
          Showing {tickets.data.items.length} of {tickets.data.total} tickets.
        </p>
      ) : null}

      <TicketCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
