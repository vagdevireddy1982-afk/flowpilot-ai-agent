"use client";

import { Package } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
import { formatDate, formatMoney } from "@/lib/utils";
import { api } from "@/trpc/client";

const ORDER_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;
const DELIVERY_STATUSES = [
  "NOT_SHIPPED",
  "IN_TRANSIT",
  "DELAYED",
  "DELIVERED",
  "RETURNED",
] as const;

export function OrdersTable({ initialDelayed = false }: { initialDelayed?: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [deliveryStatus, setDeliveryStatus] = useState(initialDelayed ? "DELAYED" : "");
  const debouncedSearch = useDebouncedValue(search, 250);

  const orders = api.order.list.useQuery({
    search: debouncedSearch || undefined,
    status: (status || undefined) as (typeof ORDER_STATUSES)[number] | undefined,
    deliveryStatus: (deliveryStatus || undefined) as (typeof DELIVERY_STATUSES)[number] | undefined,
    limit: 50,
  });

  return (
    <div className="space-y-4">
      <DataToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by reference, customer or product…"
        filters={[
          { key: "status", label: "Status", value: status, options: ORDER_STATUSES, onChange: setStatus },
          {
            key: "delivery",
            label: "Delivery",
            value: deliveryStatus,
            options: DELIVERY_STATUSES,
            onChange: setDeliveryStatus,
          },
        ]}
      >
        <Button
          size="sm"
          variant={deliveryStatus === "DELAYED" ? "default" : "outline"}
          onClick={() => setDeliveryStatus(deliveryStatus === "DELAYED" ? "" : "DELAYED")}
        >
          Delayed only
        </Button>
      </DataToolbar>

      <Card className="overflow-hidden">
        {orders.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : orders.error ? (
          <ErrorState message={orders.error.message} onRetry={() => orders.refetch()} />
        ) : orders.data.items.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No orders match those filters"
            description="Try a different search term or clear the filters."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Placed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.data.items.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link href={`/orders/${order.id}`} className="block hover:underline">
                      <span className="font-medium">{order.reference}</span>
                      <span className="block max-w-[220px] truncate text-[12px] text-muted-foreground">
                        {order.items.map((item) => item.name).join(", ")}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/customers/${order.customer.id}`}
                      className="text-muted-foreground hover:underline"
                    >
                      {order.customer.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(order.totalAmountMinor, order.currency)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={order.status} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={order.paymentStatus} />
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

      {orders.data ? (
        <p className="text-[12px] text-muted-foreground">
          Showing {orders.data.items.length} of {orders.data.total} orders.
        </p>
      ) : null}
    </div>
  );
}
