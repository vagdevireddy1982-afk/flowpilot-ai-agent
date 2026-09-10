"use client";

import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CustomerCreateDialog } from "@/components/customers/customer-create-dialog";
import { DataToolbar } from "@/components/shared/data-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
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
import { formatDate } from "@/lib/utils";
import { api } from "@/trpc/client";

const STATUSES = ["ACTIVE", "PROSPECT", "INACTIVE", "CHURNED"] as const;

export function CustomersTable({ canWrite }: { canWrite: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 250);

  const customers = api.customer.list.useQuery({
    search: debouncedSearch || undefined,
    status: (status || undefined) as (typeof STATUSES)[number] | undefined,
    limit: 50,
  });

  return (
    <div className="space-y-4">
      <DataToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by name, email, company or reference…"
        filters={[
          {
            key: "status",
            label: "Status",
            value: status,
            options: STATUSES,
            onChange: setStatus,
          },
        ]}
      >
        {canWrite ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> New customer
          </Button>
        ) : null}
      </DataToolbar>

      <Card className="overflow-hidden">
        {customers.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : customers.error ? (
          <ErrorState message={customers.error.message} onRetry={() => customers.refetch()} />
        ) : customers.data.items.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No customers match those filters"
            description="Try a different search term or clear the filters."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
                <TableHead>Last contacted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.data.items.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <Link href={`/customers/${customer.id}`} className="block hover:underline">
                      <span className="font-medium">{customer.name}</span>
                      <span className="block text-[12px] text-muted-foreground">
                        {customer.reference} · {customer.email}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.company ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={customer.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {customer._count.orders}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {customer._count.tickets}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(customer.lastContactedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {customers.data ? (
        <p className="text-[12px] text-muted-foreground">
          Showing {customers.data.items.length} of {customers.data.total} customers.
        </p>
      ) : null}

      <CustomerCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
